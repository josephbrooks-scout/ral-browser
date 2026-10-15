/* Builds the ODX-browser-like service tree and request/response parameter rows from RAL data. */
(function () {
  const R = window.RAL;
  const { big, hex } = R;

  const SESSION_IDS = { Default: 0x01, Programming: 0x02, Extended: 0x03, Safety: 0x04 };
  const SUBFUNCS = [
    ['start', 0x01, 'Start'],
    ['stop', 0x02, 'Stop'],
    ['request_results', 0x03, 'Request Results'],
  ];
  const NRC = {
    generalReject: 0x10, serviceNotSupported: 0x11, subFunctionNotSupported: 0x12,
    incorrectMessageLengthOrInvalidFormat: 0x13, responseTooLong: 0x14, busyRepeatRequest: 0x21,
    conditionsNotCorrect: 0x22, requestSequenceError: 0x24, noResponseFromSubnetComponent: 0x25,
    failurePreventsExecutionOfRequestedAction: 0x26, requestOutOfRange: 0x31, securityAccessDenied: 0x33,
    invalidKey: 0x35, exceedNumberOfAttempts: 0x36, requiredTimeDelayNotExpired: 0x37,
    uploadDownloadNotAccepted: 0x70, transferDataSuspended: 0x71, generalProgrammingFailure: 0x72,
    wrongBlockSequenceCounter: 0x73, requestCorrectlyReceivedResponsePending: 0x78,
    subFunctionNotSupportedInActiveSession: 0x7e, serviceNotSupportedInActiveSession: 0x7f,
    rpmTooHigh: 0x81, rpmTooLow: 0x82, engineIsRunning: 0x83, engineIsNotRunning: 0x84,
    temperatureTooHigh: 0x86, temperatureTooLow: 0x87, vehicleSpeedTooHigh: 0x88, vehicleSpeedTooLow: 0x89,
    voltageTooHigh: 0x92, voltageTooLow: 0x93,
  };
  const SIDS = {
    DiagnosticSessionControl: 0x10, ECUReset: 0x11, ClearDiagnosticInformation: 0x14, ReadDTCInformation: 0x19,
    ReadDataByIdentifier: 0x22, SecurityAccess: 0x27, CommunicationControl: 0x28, WriteDataByIdentifier: 0x2e,
    InputOutputControlByIdentifier: 0x2f, RoutineControl: 0x31, RequestDownload: 0x34, TransferData: 0x36,
    RequestTransferExit: 0x37, TesterPresent: 0x3e, ControlDTCSetting: 0x85,
  };
  const DTC_STATUS_BITS = [
    'warningIndicatorRequested', 'testNotCompletedThisOperationCycle', 'testFailedSinceLastClear',
    'testNotCompletedSinceLastClear', 'confirmedDTC', 'pendingDTC', 'testFailedThisOperationCycle', 'testFailed',
  ];
  const ACRONYMS = new Set(['vw', 'ecu', 'id', 'vin', 'led', 'pwm', 'hw', 'sw', 'nfc', 'dtc', 'ptc', 'fpga', 'can',
    'bap', 'obd', 'obdii', 'asam', 'odx', 'hwid', 'pss', 'vkms', 'ler', 'acc', 'swa', 'uds', 'bcm', 'pso', 'rvt', 'sdv']);

  const human = (s) => {
    let t = String(s).replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
    if (t === t.toUpperCase()) t = t.toLowerCase();
    return t.split(' ').map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1))).join(' ');
  };

  const toEnumList = (obj) =>
    Object.entries(obj || {}).map(([text, v]) => ({ text, value: big(v) })).sort((a, b) => (a.value < b.value ? -1 : a.value > b.value ? 1 : 0));

  /* ---------- row factories ---------- */
  const P = (name, o = {}) => Object.assign({
    name, kind: 'info', paramType: '', dataType: '', bits: 0, raw: 0n, unit: '', scaling: '',
    icon: 'param', children: null, open: true, checked: false, negated: false,
  }, o);

  const constRow = (name, value, bits, extra) =>
    P(name, Object.assign({ kind: 'const', paramType: 'CODED-CONST', dataType: 'UINT', bits, raw: big(value) }, extra));
  const matchRow = (name, src, extra) =>
    P(name, Object.assign({ kind: 'match', paramType: 'MATCHING-REQUEST-PARAM', dataType: 'UINT', bits: src.bits, src }, extra));
  const enumRow = (name, map, bits, def) => {
    const enumList = toEnumList(map);
    return P(name, { kind: 'enum', paramType: 'TEXTTABLE', dataType: 'STRING', bits, enumList, raw: big(def ?? enumList[0].value), icon: 'param enum' });
  };
  const infoRow = (name, value, paramType = 'PROPERTY') =>
    P(name, {
      kind: 'info', paramType,
      dataType: typeof value === 'boolean' ? 'BOOLEAN' : typeof value === 'number' ? 'UINT' : 'STRING', value,
    });
  const struct = (name, children, paramType = 'STRUCTURE') => P(name, { kind: 'struct', paramType, children, icon: 'param' });
  const root = (name, icon, children, message = true) => P(name, { kind: 'root', icon, children, message });
  const group = (name, children) => P(name, { kind: 'root', icon: 'grp', children, message: false });

  function scalingText(f, scale, offset) {
    const parts = [];
    if (scale !== 1 || offset !== 0) {
      let s = `x·${scale}`;
      if (offset) s += offset < 0 ? ` − ${Math.abs(offset)}` : ` + ${offset}`;
      parts.push(s);
    }
    if (f.min !== undefined || f.max !== undefined) parts.push(`[${f.min ?? ''}..${f.max ?? ''}]`);
    return parts.join(' ');
  }

  /* Older RAL nests items under `did:` / `routine:`; schema 1.15+ puts the fields directly on the item. */
  const didOf = (x) => (x && x.did) || x || {};
  const routineOf = (x) => (x && x.routine) || x || {};

  /* ASCII defaults may be given as the big-endian integer of the bytes. */
  function asciiDefault(d, bits) {
    if (d === undefined || d === null) return '';
    const s = String(d);
    if (!/^\d+$/.test(s)) return s;
    const v = BigInt(s);
    let t = '';
    for (let i = Math.ceil(bits / 8) - 1; i >= 0; i--) t += String.fromCharCode(Number((v >> BigInt(i * 8)) & 0xffn));
    return t.replace(/\0+$/, '');
  }

  function arrayRow(f) {
    const children = (f.elements || []).map(fieldRow);
    const fixed = f.size_type === 'fixed_size';
    const repeat = fixed ? Number(f.count ?? 1) : Math.max(1, Number(f.min ?? 0));
    const paramType = fixed ? 'STATIC-FIELD'
      : f.length_by_param ? 'DYNAMIC-LENGTH-FIELD'
      : f.termination_type === 'end_of_pdu' ? 'END-OF-PDU-FIELD' : 'DYNAMIC-FIELD';
    const scaling = fixed
      ? `${repeat} item${repeat === 1 ? '' : 's'}`
      : `${f.min ?? 0}..${f.max ?? '∞'} items` +
        (f.length_by_param ? `, count in ${f.length_by_param}` : f.termination_type === 'end_of_pdu' ? ', to end of PDU' : '') +
        `; PDU shows ${repeat}`;
    return P(f.name, { kind: 'struct', paramType, children, repeat, scaling, spec: f, icon: 'param' });
  }

  function fieldRow(f) {
    if (f.type === 'field') return arrayRow(f);
    const bits = Number(f.bit_length) || 8;
    const signed = f.type === 'sint';
    const enumList = f.enum && Object.keys(f.enum).length ? toEnumList(f.enum) : null;
    const scale = f.scale ?? 1, offset = f.offset ?? 0;
    const numeric = f.min !== undefined || f.max !== undefined || f.scale !== undefined || f.unit !== undefined;
    const base = {
      spec: f, bits, endianness: f.endianness || 'big', unit: f.unit || '', enumList,
      min: f.min, max: f.max, scale, offset, signed,
    };
    const defRaw = f.default !== undefined && f.type !== 'string' ? big(f.default)
      : enumList && !numeric ? (enumList.some((e) => e.value === 0n) ? 0n : enumList[0].value)
      : big(f.min !== undefined && f.min > 0 ? f.min : 0);
    base.raw = base.defRaw = defRaw;

    if (f.type === 'string' && f.user_codec === 'hexstring') {
      return P(f.name, { ...base, kind: 'bytes', paramType: 'IDENTICAL', dataType: 'BYTEFIELD', scaling: 'hexstring' });
    }
    if (f.type === 'string') {
      const text = asciiDefault(f.default, bits);
      return P(f.name, { ...base, kind: 'string', paramType: 'IDENTICAL', dataType: 'ASCIISTRING', text, scaling: f.user_codec || 'ascii' });
    }
    if (/^reserved/i.test(f.name) && !enumList) return P(f.name, { ...base, kind: 'reserved', paramType: 'RESERVED', raw: 0n });
    if (enumList && !numeric) return P(f.name, { ...base, kind: 'enum', paramType: 'TEXTTABLE', dataType: 'STRING', icon: 'param enum' });
    if (!enumList && !numeric && bits > 32) return P(f.name, { ...base, kind: 'bytes', paramType: 'IDENTICAL', dataType: 'BYTEFIELD' });
    const linear = scale !== 1 || offset !== 0;
    return P(f.name, {
      ...base, kind: 'num',
      paramType: linear ? 'LINEAR' : 'IDENTICAL',
      dataType: linear && !Number.isInteger(scale) ? 'FLOAT' : signed || (linear && offset < 0) ? 'INT' : 'UINT',
      scaling: scalingText(f, scale, offset),
      icon: enumList ? 'param enum' : 'param',
    });
  }

  function negativeRoots(serviceName, reqSidRow) {
    const nrc = enumRow('Negative Response Code', NRC, 8, NRC.conditionsNotCorrect);
    const nrc2 = enumRow('Negative Response Code', NRC, 8, NRC.conditionsNotCorrect);
    const reqSid = enumRow('Request Service Identifier', SIDS, 8, reqSidRow.raw);
    return [
      root(`${serviceName} Negative Response`, 'neg', [
        constRow('Negative Response Service Identifier', 0x7f, 8),
        matchRow('Request Service Identifier', reqSidRow),
        nrc,
        matchRow('Negative Response Code Value', nrc, { paramType: 'IDENTICAL', noPdu: true }),
      ]),
      root('UDS on CAN', 'neg-gen', [
        constRow('Negative Response Service Identifier', 0x7f, 8),
        reqSid,
        nrc2,
        matchRow('Negative Response Code Value', nrc2, { paramType: 'IDENTICAL', noPdu: true }),
        matchRow('Matching Request Service Identifier', reqSidRow, { noPdu: true }),
      ]),
    ];
  }

  const sessionsText = (x) => (x && x.session_types && x.session_types.length ? x.session_types.join(', ') : '—');
  const securityText = (x) => (x && x.security_levels && x.security_levels.length ? x.security_levels.join(', ') : 'none');
  const accessText = (x) => {
    const a = x && x.sfd_access;
    if (!a) return '—';
    const roles = a.pvd_roles && a.pvd_roles.length ? ` (${a.pvd_roles.join(', ')})` : '';
    return `${a.access_protection ?? '—'}${roles}, E2E ${a.e2e_security ?? '—'}`;
  };

  const SAE = [['P', 'Powertrain'], ['C', 'Chassis'], ['B', 'Body'], ['U', 'Network']];
  const saeType = (code) => SAE[(Number(code) >> 22) & 3];

  /* ---------- service builders ---------- */
  function buildRdbi(name, did) {
    const sid = constRow('Service Identifier', 0x22, 8);
    const id = constRow('Data Identifier', did.id, 16);
    return {
      title: `Read Data By Identifier / ${human(name)}`,
      request: [root(`Read Data By Identifier / ${human(name)}`, 'req', [sid, id])],
      responses: [
        root('Read Data By Identifier Positive Response', 'pos', [
          constRow('Response Service Identifier', 0x62, 8),
          matchRow('Data Identifier', id),
          struct(name, (did.values || []).map(fieldRow)),
        ]),
        ...negativeRoots('Read Data By Identifier', sid),
      ],
      info: {
        Service: '0x22 Read Data By Identifier', 'Short name': name, 'Data Identifier': hex(did.id, 16),
        Sessions: sessionsText(did.RDBI), 'Security levels': securityText(did.RDBI),
        Writable: did.WDBI ? `yes (${sessionsText(did.WDBI)})` : 'no', Access: accessText(did.RDBI),
        'Text ID': did.textidentifier ?? '', Description: did.description || '',
      },
    };
  }

  /* RAL `dids` entry without an identifier (e.g. an extended-data measurement template). */
  function buildRecord(name, did) {
    return {
      title: `Data Record / ${human(name)}`,
      request: [],
      emptyRequest: 'No request: this RAL entry has no Data Identifier (id: null) and no RDBI/WDBI configuration.',
      responses: [group('Data Record Layout', [struct(name, (did.values || []).map(fieldRow))])],
      info: { Type: 'Data record without DID', 'Short name': name, 'Text ID': did.textidentifier ?? '', Description: did.description || '' },
    };
  }

  function buildWdbi(name, did) {
    const sid = constRow('Service Identifier', 0x2e, 8);
    const id = constRow('Data Identifier', did.id, 16);
    return {
      title: `Write Data By Identifier / ${human(name)}`,
      request: [root(`Write Data By Identifier / ${human(name)}`, 'req', [sid, id, struct(name, (did.values || []).map(fieldRow))])],
      responses: [
        root('Write Data By Identifier Positive Response', 'pos', [
          constRow('Response Service Identifier', 0x6e, 8),
          matchRow('Data Identifier', id),
        ]),
        ...negativeRoots('Write Data By Identifier', sid),
      ],
      info: {
        Service: '0x2E Write Data By Identifier', 'Short name': name, 'Data Identifier': hex(did.id, 16),
        Sessions: sessionsText(did.WDBI), 'Security levels': securityText(did.WDBI), Access: accessText(did.WDBI),
        'Text ID': did.textidentifier ?? '', Description: did.description || '',
      },
    };
  }

  function buildRoutine(name, rt, key, sub, label) {
    const part = rt[key] || {};
    const sid = constRow('Service Identifier', 0x31, 8);
    const subRow = constRow('Routine Control Type', sub, 8);
    const rid = constRow('Routine Identifier', rt.id, 16);
    const inputs = (part.inputs || []).map(fieldRow);
    const outputs = (part.outputs || []).map(fieldRow);
    const reqChildren = [sid, subRow, rid];
    if (inputs.length) reqChildren.push(struct('Routine Control Option Record', inputs));
    const posChildren = [constRow('Response Service Identifier', 0x71, 8), matchRow('Routine Control Type', subRow), matchRow('Routine Identifier', rid)];
    if (outputs.length) posChildren.push(struct('Routine Status Record', outputs));
    return {
      title: `Routine Control / ${human(name)} / ${label}`,
      request: [root(`Routine Control / ${human(name)} / ${label}`, 'req', reqChildren)],
      responses: [root('Routine Control Positive Response', 'pos', posChildren), ...negativeRoots('Routine Control', sid)],
      info: {
        Service: `0x31 Routine Control (${hex(sub)} ${label})`, 'Short name': name, 'Routine Identifier': hex(rt.id, 16),
        Sessions: sessionsText(rt), 'Security levels': securityText(rt), Access: accessText(rt),
        'Sub-functions': SUBFUNCS.filter(([k]) => rt[k]).map(([, , l]) => l).join(', '),
        'Text ID': rt.textidentifier ?? '', Description: rt.description || '',
      },
    };
  }

  function metadataRows(dtc) {
    const md = (dtc && dtc.metadata) || {};
    const rows = [];
    if (dtc && dtc.domain !== undefined) rows.push(infoRow('domain', dtc.domain));
    for (const [k, v] of Object.entries(md)) {
      if (v && typeof v === 'object') { rows.push(struct(k, Object.entries(v).map(([k2, v2]) => infoRow(k2, v2)))); continue; }
      const r = infoRow(k, k === 'code' ? hex(v, 24) : v);
      if (k === 'code') r.dataType = 'UINT';
      rows.push(r);
    }
    return rows;
  }

  function buildDtc(name, dtc) {
    const code = (dtc.metadata || {}).code ?? 0;
    const sid = constRow('Service Identifier', 0x19, 8);
    const rt = constRow('Report Type', 0x06, 8, { scaling: 'reportDTCExtDataRecordByDTCNumber' });
    const mask = constRow('DTC Mask Record', code, 24);
    const recNo = fieldRow({ name: 'DTC Extended Data Record Number', type: 'uint', bit_length: 8, default: 0xff, min: 0, enum: { allRecords: 0xff } });
    const status = struct('Status Of DTC', DTC_STATUS_BITS.map((b) => enumRow(b, { false: 0, true: 1 }, 1, 0)));
    return {
      title: `Read DTC Information / ${human(name)}`,
      request: [root(`Read DTC Information / ${human(name)}`, 'req', [sid, rt, mask, recNo])],
      responses: [
        root('Read DTC Information Positive Response', 'pos', [
          constRow('Response Service Identifier', 0x59, 8), matchRow('Report Type', rt), matchRow('DTC Record', mask),
          status, matchRow('DTC Extended Data Record Number', recNo),
        ]),
        ...negativeRoots('Read DTC Information', sid),
        group('DTC Configuration', metadataRows(dtc)),
      ],
      info: {
        Service: '0x19 Read DTC Information', 'Short name': name, 'DTC code': hex(code, 24),
        'Code type': saeType(code).join(' – '), Domain: dtc.domain ?? '— (not in RAL)',
        Enabled: String((dtc.metadata || {}).enabled ?? ''), 'Enable criteria': (dtc.metadata || {}).enable_criteria ?? '',
        'Text ID': (dtc.metadata || {}).textidentifier ?? '', Description: (dtc.metadata || {}).description ?? '',
      },
    };
  }

  function buildMonitor(name, m, dtcByCode) {
    const cfg = [];
    for (const [k, v] of Object.entries(m)) {
      if (k === 'monitor' || k === 'dtc') continue;
      if (v && typeof v === 'object') cfg.push(struct(k, Object.entries(v).map(([k2, v2]) => infoRow(k2, v2)), 'STRUCTURE'));
      else cfg.push(infoRow(k, v));
    }
    const code = m.dtc && m.dtc.metadata ? m.dtc.metadata.code : undefined;
    const linked = code !== undefined ? dtcByCode.get(code) : undefined;
    return {
      title: `Monitor / ${human(name)}`,
      request: [],
      emptyRequest: 'Monitors have no UDS request. See configuration below.',
      responses: [group('Monitor Configuration', cfg), group('Linked DTC', metadataRows(m.dtc))],
      info: {
        Monitor: name, 'DTC code': code !== undefined ? hex(code, 24) : '—', 'Linked DTC': linked || '—',
        'Task rate': m.task_rate ?? '—', 'Operation cycle': m.operation_cycle ?? '—',
      },
    };
  }

  function buildSession(sess, avail) {
    const id = SESSION_IDS[sess] ?? 0;
    const sid = constRow('Service Identifier', 0x10, 8);
    const st = constRow('Diagnostic Session Type', id, 8);
    return {
      title: `Diagnostic Session Control / ${sess} Session`,
      request: [root(`Diagnostic Session Control / ${sess} Session`, 'req', [sid, st])],
      responses: [
        root('Diagnostic Session Control Positive Response', 'pos', [
          constRow('Response Service Identifier', 0x50, 8), matchRow('Diagnostic Session Type', st),
          fieldRow({ name: 'P2 Server Max', type: 'uint', bit_length: 16, endianness: 'big', unit: 'ms', default: 50 }),
          fieldRow({ name: 'P2* Server Max', type: 'uint', bit_length: 16, endianness: 'big', scale: 10, unit: 'ms', default: 500 }),
        ]),
        ...negativeRoots('Diagnostic Session Control', sid),
        group(`Available in ${sess} Session`, [
          infoRow('Read Data By Identifier (DIDs)', avail.rdbi),
          infoRow('Write Data By Identifier (DIDs)', avail.wdbi),
          infoRow('Routine Control (routines)', avail.routines),
        ]),
      ],
      info: { Service: '0x10 Diagnostic Session Control', Session: `${sess} (${hex(id)})` },
    };
  }

  function buildSecurity(level, seed, items) {
    const sub = seed ? level * 2 - 1 : level * 2;
    const label = seed ? `Request Seed Level ${level}` : `Send Key Level ${level}`;
    const sid = constRow('Service Identifier', 0x27, 8);
    const sf = constRow('Security Access Type', sub, 8);
    const req = [sid, sf];
    if (!seed) req.push(fieldRow({ name: 'Security Key', type: 'bitfield', bit_length: 32 }));
    const pos = [constRow('Response Service Identifier', 0x67, 8), matchRow('Security Access Type', sf)];
    if (seed) pos.push(fieldRow({ name: 'Security Seed', type: 'bitfield', bit_length: 32 }));
    return {
      title: `Security Access / ${label}`,
      request: [root(`Security Access / ${label}`, 'req', req)],
      responses: [
        root('Security Access Positive Response', 'pos', pos),
        ...negativeRoots('Security Access', sid),
        group(`Protected by Level ${level}`, items.map((i) => infoRow(i.name, i.what, 'SERVICE'))),
      ],
      info: { Service: '0x27 Security Access', 'Sub-function': `${hex(sub)} ${label}`, 'Protected items': items.length },
    };
  }

  /* ---------- tree ---------- */
  const leaf = (key, label, short, build, id = '', sortName = label) => ({
    key, build, icon: 'svc',
    sortName: sortName.toLowerCase(),
    label: id ? `${label} (${id})` : label,
    short: id ? `${short} (${id})` : short,
    search: `${label} ${short} ${id}`.toLowerCase(),
  });
  const byLabel = (a, b) => (a.sortName ?? a.label.toLowerCase()).localeCompare(b.sortName ?? b.label.toLowerCase(), undefined, { numeric: true });
  const folder = (key, label, children, icon = 'folder') => ({
    key, label, short: label, icon, search: label.toLowerCase(), children: [...children].sort(byLabel),
  });

  function buildEcu(ecuName, ecu) {
    const d = (ecu && ecu.diagnostics) || {};
    const routines = d.routine_controls || {};
    const dids = d.dids || {};
    const dtcs = d.dtcs || {};
    const monitors = d.monitors || {};
    const byName = (o) => Object.keys(o).sort((a, b) => human(a).localeCompare(human(b)));
    const k = (s) => `${ecuName}:${s}`;

    const sessions = new Map();
    const touch = (s) => { if (!sessions.has(s)) sessions.set(s, { rdbi: 0, wdbi: 0, routines: 0 }); return sessions.get(s); };
    const security = new Map();
    const secure = (lvls, item) => (lvls || []).map(Number).forEach((l) => { if (!security.has(l)) security.set(l, []); security.get(l).push(item); });

    for (const n of Object.keys(dids)) {
      const did = didOf(dids[n]);
      (did.RDBI?.session_types || []).forEach((s) => touch(s).rdbi++);
      (did.WDBI?.session_types || []).forEach((s) => touch(s).wdbi++);
      secure(did.RDBI?.security_levels, { name: n, what: `RDBI ${hex(did.id, 16)}` });
      secure(did.WDBI?.security_levels, { name: n, what: `WDBI ${hex(did.id, 16)}` });
    }
    for (const n of Object.keys(routines)) {
      const rt = routineOf(routines[n]);
      (rt.session_types || []).forEach((s) => touch(s).routines++);
      secure(rt.security_levels, { name: n, what: `Routine ${hex(rt.id, 16)}` });
    }
    const dtcByCode = new Map();
    for (const n of Object.keys(dtcs)) {
      const c = dtcs[n]?.metadata?.code;
      if (c !== undefined) dtcByCode.set(c, n);
    }

    const sessionLeaves = [...sessions.keys()]
      .sort((a, b) => (SESSION_IDS[a] ?? 99) - (SESSION_IDS[b] ?? 99) || a.localeCompare(b))
      .map((s) => leaf(k(`10:${s}`), `Diagnostic Session Control / ${s} Session`, `DSC_${s}`, () => buildSession(s, sessions.get(s)), hex(SESSION_IDS[s] ?? 0)));

    const dtcLeaves = byName(dtcs).map((n) => {
      const c = dtcs[n]?.metadata?.code ?? 0;
      return leaf(k(`19:${n}`), `Read DTC Information / ${human(n)}`, n, () => buildDtc(n, dtcs[n]), hex(c, 24));
    });

    const rdbiLeaves = [], wdbiLeaves = [], recordLeaves = [];
    for (const n of byName(dids)) {
      const did = didOf(dids[n]);
      const idh = hex(did.id, 16);
      if (did.id === null || did.id === undefined) {
        recordLeaves.push(leaf(k(`rec:${n}`), `Data Record / ${human(n)}`, n, () => buildRecord(n, did), 'no DID'));
        continue;
      }
      if (did.RDBI || !did.WDBI) rdbiLeaves.push(leaf(k(`22:${n}`), `Read Data By Identifier / ${human(n)}`, n, () => buildRdbi(n, did), idh));
      if (did.WDBI) wdbiLeaves.push(leaf(k(`2E:${n}`), `Write Data By Identifier / ${human(n)}`, n, () => buildWdbi(n, did), idh));
    }

    const secLeaves = [...security.keys()].sort((a, b) => a - b).flatMap((l) => [
      leaf(k(`27:${l}:seed`), `Security Access / Request Seed Level ${l}`, `SA_RequestSeed_${l}`, () => buildSecurity(l, true, security.get(l)), hex(l * 2 - 1), `Security Access / Level ${l}`),
      leaf(k(`27:${l}:key`), `Security Access / Send Key Level ${l}`, `SA_SendKey_${l}`, () => buildSecurity(l, false, security.get(l)), hex(l * 2), `Security Access / Level ${l}`),
    ]);

    const routineLeaves = byName(routines).flatMap((n) => {
      const rt = routineOf(routines[n]);
      return SUBFUNCS.filter(([key]) => rt[key]).map(([key, sub, label]) =>
        leaf(k(`31:${n}:${key}`), `Routine Control / ${human(n)} / ${label}`, `${n}_${label.replace(/ /g, '')}`, () => buildRoutine(n, rt, key, sub, label), hex(rt.id, 16), `Routine Control / ${human(n)}`));
    });

    const services = [
      folder(k('f10'), '0x10: Diagnostic Session Control', sessionLeaves),
      folder(k('f19'), '0x19: Read DTC Information', dtcLeaves),
      folder(k('f22'), '0x22: Read Data By Identifier', rdbiLeaves),
      folder(k('f27'), '0x27: Security Access', secLeaves),
      folder(k('f2E'), '0x2E: Write Data By Identifier', wdbiLeaves),
      folder(k('f31'), '0x31: Routine Control', routineLeaves),
    ].filter((f) => f.children.length);

    const monLeaves = byName(monitors).map((n) => {
      const c = monitors[n]?.dtc?.metadata?.code;
      return leaf(k(`mon:${n}`), `Monitor / ${human(n)}`, n, () => buildMonitor(n, monitors[n], dtcByCode), c !== undefined ? hex(c, 24) : '');
    });
    // Group by RAL `domain` when the file provides it; otherwise by the DTC code type (P/C/B/U from the top 2 bits).
    const hasDomain = Object.values(dtcs).some((x) => x && x.domain);
    const groups = new Map();
    for (const n of byName(dtcs)) {
      const c = dtcs[n]?.metadata?.code ?? 0;
      const [letter, kind] = saeType(c);
      const [gk, gl] = hasDomain
        ? [dtcs[n].domain || 'none', dtcs[n].domain ? human(dtcs[n].domain) : 'No Domain']
        : [letter, `${letter} – ${kind}`];
      if (!groups.has(gk)) groups.set(gk, { label: gl, items: [] });
      groups.get(gk).items.push(leaf(k(`dtc:${n}`), human(n), n, () => buildDtc(n, dtcs[n]), hex(c, 24)));
    }
    const groupFolders = [...groups.entries()]
      .sort(([a], [b]) => (hasDomain ? a.localeCompare(b) : 'PCBU'.indexOf(a) - 'PCBU'.indexOf(b)))
      .map(([gk, g]) => folder(k(`dom:${gk}`), g.label, g.items));
    const subComponents = [
      folder(k('mon'), 'Monitors', monLeaves),
      folder(k('dtcdom'), hasDomain ? 'DTCs by Domain' : 'DTCs by Code Type', groupFolders),
      folder(k('rec'), 'Data Records (no DID)', recordLeaves),
    ].filter((f) => f.children.length);

    const summary = {
      ECU: ecuName, Routines: Object.keys(routines).length, DIDs: Object.keys(dids).length,
      'Readable DIDs': rdbiLeaves.length, 'Writable DIDs': wdbiLeaves.length, DTCs: Object.keys(dtcs).length,
      Monitors: Object.keys(monitors).length, Sessions: [...sessions.keys()].join(', ') || '—',
      'Security levels': [...security.keys()].sort((a, b) => a - b).join(', ') || 'none',
    };
    return { services, subComponents, summary };
  }

  function buildEcuSummaryService(summary) {
    return {
      title: `ECU ${summary.ECU}`,
      request: [],
      emptyRequest: 'Select a service from the Services tab.',
      responses: [group('ECU Summary', Object.entries(summary).map(([k, v]) => infoRow(k, v)))],
      info: summary,
    };
  }

  Object.assign(R, { human, buildEcu, buildEcuSummaryService, fieldRow });
})();
