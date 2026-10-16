/* RAL Browser – UI controller. */
(function () {
  const R = window.RAL;
  const DEFAULT_RAL = 'data/tsg_bfs.yaml';
  const COLS = ['Name', 'ParamType', 'DataType', 'Value', 'PDU', 'Unit', 'Scaling'];
  const LAYOUT_KEY = 'ralBrowser.layout.v2';

  const $ = (id) => document.getElementById(id);
  const treeEl = $('tree'), gridReq = $('grid-req'), gridResp = $('grid-resp'), infoEl = $('info');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const state = {
    doc: null, file: '', ecus: [], ecu: null, model: null,
    tab: 'services', open: new Set(), selKey: null, svc: null, filter: '',
    longNames: true, showInfo: true, cache: new Map(), index: new Map(), visible: [],
    routineOperations: new Map(),
    cols: [320, 190, 100, 260, 150, 70, 170], selRow: null,
  };

  /* ---------- status ---------- */
  let msgTimer;
  function msg(text, isErr = false) {
    const el = $('status-msg');
    el.textContent = text;
    el.hidden = !text;
    el.classList.toggle('err', isErr);
    clearTimeout(msgTimer);
    if (!isErr) msgTimer = setTimeout(() => {
      if (el.textContent === text) { el.textContent = ''; el.hidden = true; }
    }, 6000);
  }

  /* ---------- loading ---------- */
  function loadText(text, name, sources = new Map([[name, text]])) {
    let doc;
    try { doc = R.parseRal(text, name, sources); } catch (e) { return msg(`Could not load ${name}: ${e.message}`, true); }
    if (!doc || typeof doc !== 'object' || !doc.ecus || typeof doc.ecus !== 'object' ||
        Array.isArray(doc.ecus) || !Object.keys(doc.ecus).length) {
      return msg('Not a RAL file: expected a non-empty top-level "ecus" mapping', true);
    }
    Object.assign(state, { doc, file: name, text, sources, ecus: Object.keys(doc.ecus), selKey: null, svc: null, selRow: null });
    state.cache.clear();
    state.routineOperations.clear();
    state.open.clear();
    selectEcu(state.ecus[0]);
    state.open.add('loc:file');
    state.ecus.forEach((e) => state.open.add(`loc:ecu:${e}`));
    document.title = `${name} - RAL Browser`;
    renderAll();
    const s = state.model.summary;
    const loaded = `Loaded ${name}: ${state.ecus.length} ECU(s), ${s.DIDs} DIDs, ${s.Routines} routines, ${s.DTCs} DTCs, ${s.Monitors} monitors`;
    const warnings = doc.importWarnings || [];
    msg(warnings.length ? `${loaded}. Import warnings: ${warnings.join(' ')}` : loaded, warnings.length > 0);
  }

  async function loadDefault() {
    if (window.RAL_STANDALONE) {
      if (state.text) return loadText(state.text, state.file, state.sources);
      renderAll();
      msg('Open a RAL file: File ▸ Open, the Open button, or drag & drop a .ral / .yaml file onto this window.');
      return;
    }
    try {
      const res = await fetch(DEFAULT_RAL, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      loadText(await res.text(), DEFAULT_RAL.split('/').pop());
    } catch (e) {
      renderAll();
      msg(`Could not load ${DEFAULT_RAL} (${e.message}). Use File ▸ Open or drag & drop a RAL YAML file.`, true);
    }
  }

  async function loadFiles(files) {
    if (!files.length) return;
    try {
      const sources = new Map();
      for (const file of files) {
        if (sources.has(file.name)) throw new Error(`Duplicate filename "${file.name}". Select files with unique names.`);
        sources.set(file.name, await file.text());
      }
      const name = R.ralRootName(sources);
      loadText(sources.get(name), name, sources);
    } catch (e) {
      msg(`Could not open RAL files: ${e.message}`, true);
    }
  }

  function selectEcu(name) {
    state.ecu = name;
    state.model = R.buildEcu(name, state.doc.ecus[name]);
    state.svc = R.buildEcuSummaryService(state.model.summary);
    state.index.clear();
    const idx = (nodes) => nodes.forEach((n) => { state.index.set(n.key, n); if (n.children) idx(n.children); });
    idx(locationNodes());
    idx(state.model.services);
    idx(state.model.subComponents);
    const f22 = state.model.services.find((f) => f.label.startsWith('0x22'));
    if (f22) state.open.add(f22.key);
  }

  /* ---------- tree ---------- */
  function locationNodes() {
    if (!state.doc) return [];
    return [{
      key: 'loc:file', label: state.file, short: state.file, icon: 'file', search: state.file.toLowerCase(),
      children: state.ecus.map((e) => ({
        key: `loc:ecu:${e}`, label: `${R.human(e)} (${e})`, short: e, icon: 'ecu-b', ecu: e, search: e.toLowerCase(),
        children: [{ key: `loc:var:${e}`, label: `${e} RAL Variant`, short: e, icon: 'ecu-e', ecu: e, search: e.toLowerCase() }],
      })),
    }];
  }

  function tabNodes() {
    if (!state.model) return [];
    if (state.tab === 'location') return locationNodes();
    return state.tab === 'services' ? state.model.services : state.model.subComponents;
  }

  function renderTree() {
    const nodes = tabNodes();
    const f = state.filter.trim().toLowerCase();
    treeEl.innerHTML = '';
    state.visible = [];
    if (!nodes.length) {
      treeEl.innerHTML = `<div class="empty">${state.doc ? 'Nothing here.' : 'Open a RAL YAML file via File ▸ Open, or drag & drop it here.'}</div>`;
      return;
    }
    const memo = new Map();
    const matches = (n) => {
      if (!f) return true;
      if (memo.has(n)) return memo.get(n);
      const m = n.search.includes(f) || (!!n.children && n.children.some(matches));
      memo.set(n, m);
      return m;
    };
    const frag = document.createDocumentFragment();
    const walk = (n, depth, parentHit) => {
      const selfHit = !f || n.search.includes(f);
      if (!parentHit && !matches(n)) return;
      const isOpen = !!n.children && (state.open.has(n.key) || (!!f && !selfHit));
      const el = document.createElement('div');
      el.className = 'tn' + (n.key === state.selKey ? ' sel' : '');
      el.dataset.key = n.key;
      el.style.paddingLeft = `${depth * 18 + 2}px`;
      const label = state.longNames ? n.label : n.short;
      const m = /^(.*) \((0x[0-9A-F]+)\)$/.exec(label);
      const text = m ? `<span class="lbl">${esc(m[1])}</span><span class="tid">${m[2]}</span>` : `<span class="lbl">${esc(label)}</span>`;
      el.title = label;
      el.innerHTML = `<span class="chev${isOpen ? ' open' : ''}">${n.children ? '❯' : ''}</span><span class="tico ${n.icon}"></span>${text}`;
      frag.appendChild(el);
      state.visible.push(n);
      if (isOpen) n.children.forEach((c) => walk(c, depth + 1, parentHit || (!!f && selfHit)));
    };
    nodes.forEach((n) => walk(n, 0, false));
    treeEl.appendChild(frag);
  }

  function toggleNode(n) {
    if (!n.children) return;
    if (state.open.has(n.key)) state.open.delete(n.key); else state.open.add(n.key);
    renderTree();
  }

  function serviceSelection(n) {
    const operation = n.operations && (n.operations.find((op) => op.key === state.routineOperations.get(n.key)) || n.operations[0]);
    return { key: operation ? `${n.key}:${operation.key}` : n.key, build: operation ? operation.build : n.build };
  }

  function selectNode(n, { scroll = false } = {}) {
    state.selKey = n.key;
    if (n.ecu) {
      if (n.ecu !== state.ecu) selectEcu(n.ecu);
      state.svc = R.buildEcuSummaryService(state.model.summary);
      state.selRow = null;
      $('ecu-label').textContent = state.ecu;
      renderGrids();
    } else if (n.build) {
      const selection = serviceSelection(n);
      if (!state.cache.has(selection.key)) state.cache.set(selection.key, selection.build());
      state.svc = state.cache.get(selection.key);
      state.selRow = null;
      renderGrids();
    }
    renderTree();
    if (scroll) {
      const el = treeEl.querySelector(`.tn[data-key="${CSS.escape(n.key)}"]`);
      if (el) el.scrollIntoView({ block: 'nearest' });
    }
  }

  treeEl.addEventListener('click', (e) => {
    const el = e.target.closest('.tn');
    if (!el) return;
    const n = state.index.get(el.dataset.key);
    if (!n) return;
    treeEl.focus();
    if (e.target.classList.contains('chev') || (n.children && !n.ecu)) return toggleNode(n);
    selectNode(n);
  });
  treeEl.addEventListener('dblclick', (e) => {
    const el = e.target.closest('.tn');
    const n = el && state.index.get(el.dataset.key);
    if (n && n.ecu && n.children) toggleNode(n);
  });
  treeEl.addEventListener('keydown', (e) => {
    const vis = state.visible;
    if (!vis.length) return;
    let i = vis.findIndex((n) => n.key === state.selKey);
    const cur = vis[i];
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      i = Math.max(0, Math.min(vis.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)));
      selectNode(vis[i], { scroll: true });
    } else if (e.key === 'ArrowRight' && cur && cur.children && !state.open.has(cur.key)) {
      toggleNode(cur);
    } else if (e.key === 'ArrowLeft' && cur && cur.children && state.open.has(cur.key)) {
      toggleNode(cur);
    } else if (e.key === 'Enter' && cur && cur.children) {
      toggleNode(cur);
    } else return;
    e.preventDefault();
  });

  /* ---------- grids ---------- */
  function headerEl() {
    const h = document.createElement('div');
    h.className = 'gh';
    h.innerHTML = COLS.map((c, i) => `<div class="c">${c}<span class="rs" data-col="${i}"></span></div>`).join('');
    return h;
  }

  const isEditable = (r) => ['enum', 'num', 'bytes', 'string'].includes(r.kind);

  function rowEl(row, depth, idx) {
    const el = document.createElement('div');
    el.className = 'gr' + (row === state.selRow ? ' sel' : '');
    el.dataset.idx = idx;
    const hasKids = row.children && row.children.length;
    const val = R.valueText(row);
    const valCls = ['c', 'val'];
    if (row.kind === 'const' || row.kind === 'reserved') valCls.push('grey');
    if (isEditable(row)) valCls.push('editable');
    if (R.outOfRange(row)) valCls.push('bad');
    const dd = row.enumList && (row.kind === 'enum' || row.kind === 'num') ? '<span class="dd" title="Select values">▼</span>' : '';
    el.innerHTML =
      `<div class="c name" style="padding-left:${depth * 16 + 2}px" title="${esc(row.name)}">` +
      `<span class="exp${hasKids && row.open ? ' open' : ''}">${hasKids ? '❯' : ''}</span>` +
      `<span class="cb${row.checked ? ' on' : ''}"></span><span class="ico ${row.icon}"></span><span>${esc(row.name)}</span></div>` +
      `<div class="c" title="${esc(row.paramType)}">${esc(row.paramType)}</div>` +
      `<div class="c">${esc(row.dataType)}</div>` +
      `<div class="${valCls.join(' ')}" title="${esc(val)}">${esc(val)}${dd}</div>` +
      `<div class="c" title="${esc(R.pduText(row))}">${esc(R.pduText(row))}</div>` +
      `<div class="c">${esc(row.unit)}</div>` +
      `<div class="c" title="${esc(row.scaling)}">${esc(row.scaling)}</div>`;
    return el;
  }

  function renderGrid(el, roots, emptyMsg) {
    const st = el.scrollTop, sl = el.scrollLeft;
    el.innerHTML = '';
    el.appendChild(headerEl());
    el._rows = [];
    if (!roots || !roots.length) {
      if (emptyMsg) el.insertAdjacentHTML('beforeend', `<div class="empty">${esc(emptyMsg)}</div>`);
      return;
    }
    const frag = document.createDocumentFragment();
    const walk = (row, depth) => {
      frag.appendChild(rowEl(row, depth, el._rows.length));
      el._rows.push(row);
      if (row.children && row.open) row.children.forEach((c) => walk(c, depth + 1));
    };
    roots.forEach((r) => walk(r, 0));
    el.appendChild(frag);
    el.scrollTop = st;
    el.scrollLeft = sl;
  }

  function renderInfo() {
    const svc = state.svc;
    if (!svc) { infoEl.innerHTML = ''; return; }
    const entries = Object.entries(svc.info || {});
    if (svc.request && svc.request[0]) entries.splice(1, 0, ['Request PDU', R.pduText(svc.request[0])]);
    infoEl.innerHTML = `<table>${entries.map(([k, v]) => `<tr><td class="k">${esc(k)}</td><td class="v">${esc(v)}</td></tr>`).join('')}</table>`;
  }

  function renderGrids() {
    const svc = state.svc;
    const node = state.index.get(state.selKey);
    const control = $('routine-control');
    control.hidden = !node?.operations;
    const select = $('routine-operation');
    select.innerHTML = node?.operations
      ? node.operations.map((op) => `<option value="${esc(op.key)}">${esc(op.label)}</option>`).join('') : '';
    if (node?.operations) select.value = state.routineOperations.get(node.key) || node.operations[0].key;
    renderGrid(gridReq, svc ? svc.request : [], svc ? svc.emptyRequest || '' : 'No service selected.');
    renderGrid(gridResp, svc ? svc.responses : [], '');
    renderInfo();
  }

  $('routine-operation').addEventListener('change', (e) => {
    const node = state.index.get(state.selKey);
    if (!node?.operations) return;
    state.routineOperations.set(node.key, e.target.value);
    selectNode(node);
  });

  function onGridClick(e) {
    const grid = e.currentTarget;
    const rEl = e.target.closest('.gr');
    if (!rEl) return;
    const row = grid._rows[+rEl.dataset.idx];
    if (!row) return;
    if (e.target.classList.contains('exp')) { row.open = !row.open; return renderGrids(); }
    if (e.target.classList.contains('cb')) { row.checked = !row.checked; return renderGrids(); }
    if (e.target.classList.contains('dd')) { state.selRow = row; renderGrids(); return openSelect(row); }
    if (state.selRow !== row) { state.selRow = row; renderGrids(); }
  }

  function onGridDblClick(e) {
    const grid = e.currentTarget;
    const rEl = e.target.closest('.gr');
    if (!rEl) return;
    const row = grid._rows[+rEl.dataset.idx];
    if (!row) return;
    const cell = e.target.closest('.c');
    if (cell && cell.classList.contains('val') && isEditable(row)) {
      if (row.kind === 'enum') return openSelect(row);
      return inlineEdit(grid, +rEl.dataset.idx, row);
    }
    if (row.children && row.children.length) { row.open = !row.open; renderGrids(); }
  }

  function inlineEdit(grid, idx, row) {
    const cell = grid.querySelector(`.gr[data-idx="${idx}"] .c.val`);
    if (!cell) return;
    const input = document.createElement('input');
    input.value = R.valueText(row).replace(/^≠ /, '');
    cell.innerHTML = '';
    cell.appendChild(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (commit) => {
      if (done) return;
      done = true;
      if (commit) {
        try {
          const v = R.parseInput(row, input.value);
          if ('raw' in v) row.raw = v.raw;
          if ('text' in v) row.text = v.text;
          if (R.outOfRange(row)) msg(`${row.name}: raw value ${row.raw} is outside the allowed range [${row.min ?? ''}..${row.max ?? ''}]`, true);
          else msg('');
        } catch (err) { msg(`${row.name}: ${err.message}`, true); }
      }
      renderGrids();
    };
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Enter') finish(true);
      else if (ev.key === 'Escape') finish(false);
      ev.stopPropagation();
    });
    input.addEventListener('blur', () => finish(true));
  }

  [gridReq, gridResp].forEach((g) => {
    g.addEventListener('click', onGridClick);
    g.addEventListener('dblclick', onGridDblClick);
  });

  /* ---------- dialogs ---------- */
  function modal(html, onKey) {
    const root = $('modal-root');
    root.innerHTML = `<div class="backdrop">${html}</div>`;
    const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', key, true); };
    const key = (e) => { if (e.key === 'Escape') { close(); e.preventDefault(); } else if (onKey) onKey(e, close); };
    document.addEventListener('keydown', key, true);
    root.querySelector('.backdrop').addEventListener('mousedown', (e) => { if (e.target.classList.contains('backdrop')) close(); });
    return { el: root.querySelector('.dlg'), close };
  }

  function openSelect(row) {
    const list = row.enumList || [];
    let sel = list.findIndex((x) => x.value === row.raw);
    const html = `<div class="dlg"><div class="dt">Select values</div><div class="db"><div class="vt">
      <div class="vh"><div>Text</div><div>TI</div><div>ID</div></div>
      ${list.map((x, i) => `<div class="vr" data-i="${i}"><div class="t">${esc(x.text)}</div><div></div><div>${R.hex(x.value, row.bits)}</div></div>`).join('')}
      </div></div><div class="df"><label><input type="checkbox" id="neg"${row.negated ? ' checked' : ''}> negated</label>
      <span class="grow"></span><button class="primary" id="ok">OK</button><button id="cancel">Cancel</button></div></div>`;
    const apply = (close) => {
      if (sel >= 0) row.raw = list[sel].value;
      row.negated = el.querySelector('#neg').checked;
      close();
      renderGrids();
    };
    const { el, close } = modal(html, (e, c) => {
      if (e.key === 'Enter') { apply(c); e.preventDefault(); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        sel = Math.max(0, Math.min(list.length - 1, sel + (e.key === 'ArrowDown' ? 1 : -1)));
        paint();
        e.preventDefault();
      }
    });
    const vrs = [...el.querySelectorAll('.vr')];
    const paint = () => vrs.forEach((v, i) => {
      v.classList.toggle('sel', i === sel);
      if (i === sel) v.scrollIntoView({ block: 'nearest' });
    });
    paint();
    vrs.forEach((v) => {
      v.addEventListener('click', () => { sel = +v.dataset.i; paint(); });
      v.addEventListener('dblclick', () => { sel = +v.dataset.i; apply(close); });
    });
    el.querySelector('#ok').addEventListener('click', () => apply(close));
    el.querySelector('#cancel').addEventListener('click', close);
  }

  function about() {
    const { el, close } = modal(`<div class="dlg about"><div class="dt"><b>RAL Browser</b></div><div class="db">
      <p>ODX-Browser-style viewer for RAL diagnostic YAML.</p>
      <p>Services are derived from the RAL data: DIDs (0x22/0x2E), routines (0x31), DTCs (0x19), sessions (0x10), security levels (0x27) and monitors.</p>
      <p>Double-click a value to edit it; the PDU column shows the encoded bytes. Data stays local in your browser.</p>
      </div><div class="df"><span class="grow"></span><button class="primary" id="ok">OK</button></div></div>`, (e, c) => { if (e.key === 'Enter') c(); });
    el.querySelector('#ok').addEventListener('click', close);
  }

  /* ---------- commands ---------- */
  const walkRows = (rows, fn) => (rows || []).forEach((r) => { fn(r); walkRows(r.children, fn); });
  const allSvcRows = (svc, fn) => { if (svc) { walkRows(svc.request, fn); walkRows(svc.responses, fn); } };

  const commands = {
    open: () => $('file-input').click(),
    reload: loadDefault,
    'copy-req': async () => {
      const r = state.svc && state.svc.request && state.svc.request[0];
      if (!r) return msg('No request PDU for the current selection', true);
      const pdu = R.pduText(r);
      try { await navigator.clipboard.writeText(pdu); msg(`Copied request PDU: ${pdu}`); } catch { msg(`Request PDU: ${pdu}`); }
    },
    reset: () => {
      const n = state.index.get(state.selKey);
      if (!n || !n.build) return;
      state.cache.delete(serviceSelection(n).key);
      selectNode(n);
      msg('Values reset');
    },
    'reset-all': () => {
      state.cache.clear();
      const n = state.index.get(state.selKey);
      if (n && n.build) selectNode(n);
      msg('All values reset');
    },
    uncheck: () => { state.cache.forEach((svc) => allSvcRows(svc, (r) => { r.checked = false; })); renderGrids(); },
    ln: () => {
      state.longNames = !state.longNames;
      $('ln-check').textContent = state.longNames ? '✓' : '';
      $('tb-ln').classList.toggle('on', state.longNames);
      renderTree();
    },
    expand: () => {
      const add = (ns) => ns.forEach((n) => { if (n.children) { state.open.add(n.key); add(n.children); } });
      add(tabNodes());
      allSvcRows(state.svc, (r) => { r.open = true; });
      renderTree(); renderGrids();
    },
    collapse: () => {
      const del = (ns) => ns.forEach((n) => { if (n.children) { state.open.delete(n.key); del(n.children); } });
      del(tabNodes());
      allSvcRows(state.svc, (r) => { if (r.kind !== 'root') r.open = false; });
      renderTree(); renderGrids();
    },
    'toggle-info': () => {
      state.showInfo = !state.showInfo;
      $('pane-info').style.display = state.showInfo ? '' : 'none';
      $('split-info').style.display = state.showInfo ? '' : 'none';
      $('info-check').textContent = state.showInfo ? '✓' : '';
      $('tb-info').classList.toggle('on', state.showInfo);
    },
    about,
  };

  document.addEventListener('click', (e) => {
    const cmdEl = e.target.closest('[data-cmd]');
    const menu = e.target.closest('.menu');
    document.querySelectorAll('.menu.open').forEach((m) => { if (m !== menu || cmdEl) m.classList.remove('open'); });
    if (cmdEl) { commands[cmdEl.dataset.cmd](); return; }
    if (menu && !e.target.closest('.menu-pop')) menu.classList.toggle('open');
  });
  document.querySelectorAll('.menu').forEach((m) => m.addEventListener('mouseenter', () => {
    const openMenu = document.querySelector('.menu.open');
    if (openMenu && openMenu !== m) { openMenu.classList.remove('open'); m.classList.add('open'); }
  }));

  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); commands.open(); }
    else if (mod && e.key.toLowerCase() === 'f') { e.preventDefault(); $('filter').focus(); $('filter').select(); }
  });

  $('tabs').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tab]');
    if (!b) return;
    state.tab = b.dataset.tab;
    renderTabs();
    renderTree();
  });

  let filterTimer;
  $('filter').addEventListener('input', (e) => {
    clearTimeout(filterTimer);
    filterTimer = setTimeout(() => { state.filter = e.target.value; renderTree(); }, 120);
  });

  $('file-input').addEventListener('change', (e) => { loadFiles([...e.target.files]); e.target.value = ''; });

  /* drag & drop */
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; document.body.classList.add('dragging'); });
  window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dragging'); } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging');
    loadFiles([...e.dataTransfer.files]);
  });

  /* ---------- splitters & column resize ---------- */
  function saveLayout() {
    try {
      localStorage.setItem(LAYOUT_KEY, JSON.stringify({
        cols: state.cols, left: $('left').offsetWidth, req: $('pane-req').offsetHeight, info: $('pane-info').offsetHeight,
      }));
    } catch { /* storage unavailable */ }
  }
  function applyCols() { document.documentElement.style.setProperty('--cols', state.cols.map((c) => `${c}px`).join(' ')); }

  function drag(handle, onMove) {
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const move = (ev) => onMove(ev);
      const up = () => {
        document.removeEventListener('mousemove', move);
        document.removeEventListener('mouseup', up);
        document.body.style.cursor = '';
        saveLayout();
      };
      document.body.style.cursor = getComputedStyle(handle).cursor;
      document.addEventListener('mousemove', move);
      document.addEventListener('mouseup', up);
    });
  }
  drag($('split-main'), (ev) => { $('left').style.width = `${Math.max(160, ev.clientX - $('left').getBoundingClientRect().left)}px`; });
  drag($('split-rr'), (ev) => { $('pane-req').style.height = `${Math.max(24, ev.clientY - $('pane-req').getBoundingClientRect().top)}px`; });
  drag($('split-info'), (ev) => { $('pane-info').style.height = `${Math.max(24, $('pane-info').getBoundingClientRect().bottom - ev.clientY)}px`; });

  document.addEventListener('mousedown', (e) => {
    if (!e.target.classList.contains('rs')) return;
    e.preventDefault();
    e.stopPropagation();
    const i = +e.target.dataset.col, x0 = e.clientX, w0 = state.cols[i];
    const move = (ev) => { state.cols[i] = Math.max(30, w0 + ev.clientX - x0); applyCols(); };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); saveLayout(); };
    document.addEventListener('mousemove', move);
    document.addEventListener('mouseup', up);
  });

  try {
    const l = JSON.parse(localStorage.getItem(LAYOUT_KEY) || 'null');
    if (l) {
      if (Array.isArray(l.cols) && l.cols.length === COLS.length) state.cols = l.cols;
      if (l.left) $('left').style.width = `${l.left}px`;
      if (l.req) $('pane-req').style.height = `${l.req}px`;
      if (l.info) $('pane-info').style.height = `${l.info}px`;
    }
  } catch { /* ignore bad layout */ }
  applyCols();

  /* ---------- render ---------- */
  function renderTabs() {
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === state.tab));
  }
  function renderAll() {
    renderTabs();
    renderTree();
    renderGrids();
    $('ecu-label').textContent = state.ecu || '—';
    $('status-file').textContent = state.file || 'No file loaded';
  }

  window.RAL.app = { state, loadText, commands, selectNode };
  if (window.RAL_STANDALONE) {
    document.querySelectorAll('[data-cmd="reload"]').forEach((el) => {
      if (el.title) el.title = 'Reload current file (resets values)';
      else el.textContent = 'Reload current file';
    });
  }
  loadDefault();
})();
