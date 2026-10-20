/* AUTOSAR indexes retain source definitions; conflicting paths are never resolved by file order. */
(function () {
  const R = window.RAL;
  const nameOf = (node) => [...node.children].find((child) => child.localName === 'SHORT-NAME')?.textContent.trim();
  const sort = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
  const friendly = (text) => text.toLowerCase().split('-').map((word) =>
    ['ecu', 'pdu', 'ipdu', 'can', 'xml', 'uuid', 'nm', 'tp', 'ip', 'swc', 'e2e'].includes(word)
      ? word.toUpperCase() : word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  const categoryName = (type) => {
    if (/ECU-INSTANCE|CLUSTER|PHYSICAL-CHANNEL|CONNECTOR|TRIGGERING|TP-CONFIG|SOCKET|NETWORK-ENDPOINT/.test(type)) return 'Networks & ECUs';
    if (/PDU|FRAME|GATEWAY/.test(type)) return 'PDUs & Frames';
    if (/SIGNAL/.test(type)) return 'Signals & Signal Groups';
    if (/DATA-TYPE|BASE-TYPE/.test(type)) return 'Data Types';
    if (/COMPU|CONSTR|UNIT|DIMENSION/.test(type)) return 'Scaling, Units & Constraints';
    if (/COMPONENT|INTERFACE|PORT|RUNNABLE|BEHAVIOR/.test(type)) return 'Software & Interfaces';
    if (/SECUR|TRANSFORMATION|E2E/.test(type)) return 'Security & Transformations';
    if (type === 'AR-PACKAGE') return 'Packages';
    return 'Other Definitions';
  };

  function properties(record, structural = false) {
    const rows = [];
    function walk(node, path) {
      if (node !== record.element && nameOf(node)) return;
      if (structural) {
        rows.push({ name: `${path}/#element`, value: node.namespaceURI || '' });
        rows.push({ name: `${path}/#children`,
          value: JSON.stringify([...node.children].filter((child) => !nameOf(child)).map((child) => child.localName)) });
      }
      for (const attr of [...node.attributes].sort((a, b) =>
        `${a.namespaceURI || ''}:${a.localName}`.localeCompare(`${b.namespaceURI || ''}:${b.localName}`))) {
        if (attr.namespaceURI === 'http://www.w3.org/2000/xmlns/') continue;
        rows.push({ name: `${path}/@${attr.namespaceURI ? `{${attr.namespaceURI}}` : ''}${attr.localName}`, value: attr.value });
      }
      if (!node.children.length) {
        if (!structural || node.textContent.trim() !== '') {
          rows.push({ name: path, value: structural ? node.textContent : node.textContent.trim(),
            ref: /(?:REF|TREF)$/.test(node.localName), dest: node.getAttribute('DEST') });
        }
      } else {
        const counts = new Map(), positions = new Map();
        const textNodes = [...node.childNodes].filter((child) => (child.nodeType === 3 || child.nodeType === 4) && child.textContent.trim() !== '');
        if (textNodes.length) {
          if (structural) rows.push({ name: `${path}/#content`, value: JSON.stringify([...node.childNodes].flatMap((child) =>
            child.nodeType === 1 ? nameOf(child) ? [] : [{ element: child.localName }]
              : (child.nodeType === 3 || child.nodeType === 4) && child.textContent.trim() !== '' ? [{ text: child.textContent }] : [])) });
          textNodes.forEach((child, index) => rows.push({ name: `${path}/#text[${index + 1}]`, value: child.textContent }));
        }
        for (const child of node.children) counts.set(child.localName, (counts.get(child.localName) || 0) + 1);
        for (const child of node.children) {
          const tag = child.localName, index = (positions.get(tag) || 0) + 1;
          positions.set(tag, index);
          walk(child, `${path}/${tag}${counts.get(tag) > 1 ? `[${index}]` : ''}`);
        }
      }
    }
    walk(record.element, record.type);
    return rows;
  }
  const signature = (record) => JSON.stringify(properties(record, true).map(({ name, value }) => [name, value]));
  const resolveReference = (paths, path, dest, namespace) => {
    const target = paths.get(path);
    const status = !target ? 'missing' : target.conflict ? 'conflict'
      : target.element.namespaceURI !== namespace ? 'namespace mismatch'
      : dest && dest !== target.type ? 'type mismatch' : 'resolved';
    return { target: status === 'resolved' ? target : null, status };
  };
  R.arxmlReference = resolveReference;

  function index(records, files) {
    const paths = new Map(), types = new Map(), roots = [], references = [], outgoing = new Map(), incoming = new Map();
    for (const record of records) {
      paths.set(record.path, record);
      if (!types.has(record.type)) types.set(record.type, []);
      types.get(record.type).push(record);
      record.children = [];
    }
    for (const record of records) {
      record.parent = paths.get(record.path.slice(0, record.path.lastIndexOf('/'))) || null;
      if (record.parent) record.parent.children.push(record); else roots.push(record);
      const refs = [];
      for (const definition of record.definitions) {
        for (const row of properties(definition)) {
          if (!row.ref || !row.value.startsWith('/')) continue;
          const ref = { source: record, path: row.value, field: row.name, dest: row.dest,
            file: definition.file, ...resolveReference(paths, row.value, row.dest, definition.element.namespaceURI) };
          refs.push(ref); references.push(ref);
          if (ref.target) {
            if (!incoming.has(ref.path)) incoming.set(ref.path, []);
            incoming.get(ref.path).push(ref);
          }
        }
      }
      outgoing.set(record.path, refs);
    }
    roots.sort(sort);
    for (const record of records) record.children.sort(sort);
    for (const items of types.values()) items.sort(sort);
    const grouped = new Map();
    for (const [type, children] of types) {
      const category = categoryName(type);
      if (!grouped.has(category)) grouped.set(category, []);
      grouped.get(category).push({ name: friendly(type), type, children, isType: true });
    }
    const categories = [...grouped].map(([name, children]) => ({
      name, children: children.sort(sort), isType: true,
      type: `${children.reduce((sum, group) => sum + group.children.length, 0).toLocaleString()} objects`,
    })).sort(sort);
    for (const category of categories) for (const type of category.children) type.parent = category;
    return { xml: files[0].xml, files, records, paths, types, roots, references, incoming, outgoing, categories,
      missingReferences: references.filter((ref) => ref.status !== 'resolved').length,
      conflicts: records.filter((record) => record.conflict) };
  }

  R.parseArxml = (text, file = 'document.arxml') => {
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('ARXML with DTD/entity declarations is not supported.');
    const xml = new DOMParser().parseFromString(text, 'application/xml');
    const error = xml.getElementsByTagName('parsererror')[0];
    if (error) throw new Error(`Invalid XML: ${error.textContent.slice(0, 300)}`);
    if (xml.documentElement.localName !== 'AUTOSAR' ||
        !/^https?:\/\/autosar\.org\/schema\//.test(xml.documentElement.namespaceURI || '')) {
      throw new Error('Expected an AUTOSAR document with an AUTOSAR schema namespace.');
    }
    const records = [], paths = new Set();
    function visit(node, parent) {
      const name = nameOf(node);
      if (name) {
        const path = `${parent ? parent.path : ''}/${name}`;
        if (paths.has(path)) throw new Error(`Duplicate AUTOSAR object path: ${path}`);
        paths.add(path);
        const record = { name, path, type: node.localName, element: node, file };
        record.definitions = [{ ...record }];
        records.push(record);
        parent = record;
      }
      for (const child of node.children) visit(child, parent);
    }
    visit(xml.documentElement, null);
    return index(records, [{ name: file, xml, count: records.length,
      metadata: properties({ type: 'AUTOSAR', element: xml.documentElement }).filter((row) => !row.name.includes('/AR-PACKAGES')),
      namespace: xml.documentElement.namespaceURI,
      schema: xml.documentElement.getAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'schemaLocation') || 'not specified' }]);
  };

  R.parseArxmlWorkspace = (sources) => {
    if (!sources.size) throw new Error('Select at least one ARXML file.');
    const files = [], byPath = new Map();
    for (const [name, text] of sources) {
      let parsed;
      try { parsed = R.parseArxml(text, name); }
      catch (error) { throw new Error(`${name}: ${error.message}`); }
      files.push(...parsed.files);
      for (const record of parsed.records) {
        if (!byPath.has(record.path)) byPath.set(record.path, { ...record, definitions: [] });
        byPath.get(record.path).definitions.push(...record.definitions);
      }
    }
    for (const record of byPath.values()) {
      const definitions = record.definitions;
      record.conflict = definitions.some((item) => item.type !== record.type || item.element.namespaceURI !== record.element.namespaceURI) ||
        (record.type !== 'AR-PACKAGE' && definitions.length > 1 &&
          new Set(definitions.map(signature)).size > 1);
    }
    return index([...byPath.values()], files);
  };

  R.compareArxml = (baseline, candidate) => {
    const changes = [], counts = { added: 0, removed: 0, changed: 0, unchanged: 0 };
    const paths = new Set([...baseline.paths.keys(), ...candidate.paths.keys()]);
    for (const path of [...paths].sort()) {
      const before = baseline.paths.get(path), after = candidate.paths.get(path);
      const status = !before ? 'added' : !after ? 'removed'
        : signature(before) !== signature(after) ? 'changed' : 'unchanged';
      counts[status]++;
      if (status !== 'unchanged') changes.push({ path, before, after, status, name: path,
        type: (after || before).type, children: [] });
    }
    return { baseline, candidate, changes, counts };
  };
  R.arxmlPropertyDiff = (before, after) => {
    const left = new Map(before ? properties(before, true).map((row) => [row.name, row.value]) : []);
    const right = new Map(after ? properties(after, true).map((row) => [row.name, row.value]) : []);
    return [...new Set([...left.keys(), ...right.keys()])].filter((key) => left.get(key) !== right.get(key))
      .map((name) => ({ name, before: left.get(name), after: right.get(name) }));
  };
  R.arxmlProperties = properties;
  R.arxmlLabel = friendly;

  const communicationGroup = (type) => {
    if (type === 'ECU-INSTANCE') return 'ECUs';
    if (/(?:CLUSTER|PHYSICAL-CHANNEL)$/.test(type)) return 'Networks & Channels';
    if (/(?:COMMUNICATION-(?:CONNECTOR|CONTROLLER)|FRAME-PORT|I-PDU-PORT|I-SIGNAL-PORT)$/.test(type)) return 'Connectors, Controllers & Ports';
    if (/FRAME/.test(type)) return 'Frames & Frame Mappings';
    if (/PDU/.test(type)) return 'PDUs & PDU Mappings';
    if (/SIGNAL/.test(type)) return 'Signals & Signal Groups';
    return null;
  };
  R.arxmlCommunicationGroups = (model) => {
    const groups = new Map();
    for (const record of model.records) {
      const name = communicationGroup(record.type);
      if (!name) continue;
      if (!groups.has(name)) groups.set(name, { name, isType: true, type: '', children: [] });
      groups.get(name).children.push(record);
    }
    return ['ECUs', 'Networks & Channels', 'Frames & Frame Mappings', 'PDUs & PDU Mappings',
      'Signals & Signal Groups', 'Connectors, Controllers & Ports'].filter((name) => groups.has(name)).map((name) => {
      const group = groups.get(name);
      group.children.sort(sort);
      group.type = `${group.children.length.toLocaleString()} ${group.children.length === 1 ? 'object' : 'objects'}`;
      return group;
    });
  };
  R.arxmlRelationships = (model, record) => {
    const links = [];
    const addRefs = (owner) => {
      for (const ref of model.outgoing.get(owner.path) || []) links.push({
        record: ref.target, path: ref.path, relation: `Reference from ${owner.path}`,
        field: ref.field, status: ref.status, file: ref.file,
      });
      for (const ref of model.incoming.get(owner.path) || []) links.push({
        record: ref.source, path: ref.source.path, relation: `References ${owner.path}`,
        field: ref.field, status: ref.source.conflict ? 'conflict' : 'resolved', file: ref.file,
      });
    };
    addRefs(record);
    if (record.parent && record.parent.type !== 'AR-PACKAGE') links.push({
      record: record.parent, path: record.parent.path, relation: 'Contained in', status: 'resolved', field: '', file: record.parent.file,
    });
    for (const child of record.children) {
      links.push({ record: child, path: child.path, relation: 'Contains', status: child.conflict ? 'conflict' : 'resolved', field: '', file: child.file });
      if (/MAPPING|CONNECTOR/.test(child.type)) addRefs(child);
    }
    return links;
  };
  R.arxmlSignalDetails = (model, record) => {
    const details = [], visited = new Set();
    const tags = /\/(?:LENGTH|FRAME-LENGTH|START-POSITION|PACKING-BYTE-ORDER|UPDATE-INDICATION-BIT-POSITION|IDENTIFIER|CAN-ADDRESSING-MODE|COMMUNICATION-DIRECTION|BASE-TYPE-SIZE|BASE-TYPE-ENCODING|CATEGORY|LOWER-LIMIT|UPPER-LIMIT|V|VT|FACTOR-SI-TO-UNIT|OFFSET-SI-TO-UNIT|DISPLAY-NAME|TRANSFER-PROPERTY)(?:\[\d+\])?$/;
    function visit(owner, depth) {
      if (visited.has(owner.path) || owner.conflict) return;
      visited.add(owner.path);
      for (const row of properties(owner)) if (tags.test(row.name)) details.push({ ...row, owner });
      if (depth === 4) return;
      for (const ref of model.outgoing.get(owner.path) || []) {
        if (ref.target && /^(?:SYSTEM-SIGNAL|COMPU-METHOD|UNIT|SW-BASE-TYPE|PHYSICAL-DIMENSION|DATA-CONSTR)$/.test(ref.target.type)) visit(ref.target, depth + 1);
      }
    }
    visit(record, 0);
    return details;
  };
  R.arxmlMappings = (model, record) => {
    const mappings = /MAPPING$/.test(record.type) ? [record] : record.children.filter((child) => /MAPPING$/.test(child.type));
    return mappings.flatMap((mapping) => {
      if (mapping.conflict) return [{ mapping, conflict: true }];
      const rows = properties(mapping);
      const value = (tag) => rows.find((row) => row.name.endsWith(`/${tag}`))?.value;
      const refs = model.outgoing.get(mapping.path) || [];
      return (refs.length ? refs : [{ path: '(no absolute target reference declared)', status: 'not declared', file: mapping.file }]).map((ref) => ({
        mapping, ref, position: value('START-POSITION'), order: value('PACKING-BYTE-ORDER'),
        transfer: value('TRANSFER-PROPERTY'),
        length: ref.target ? properties(ref.target).find((row) => row.name.endsWith('/LENGTH'))?.value : undefined,
      }));
    });
  };
})();
