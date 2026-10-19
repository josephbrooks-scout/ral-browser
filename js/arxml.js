/* Read-only AUTOSAR explorer. XML is parsed locally, never inserted as HTML. */
(function () {
  const R = window.RAL;
  const PAGE = 200;
  const local = (element) => element.localName;
  const shortName = (element) => [...element.children].find((child) => local(child) === 'SHORT-NAME')?.textContent.trim();
  const compare = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });
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

  R.parseArxml = (text) => {
    if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('ARXML with DTD/entity declarations is not supported.');
    const xml = new DOMParser().parseFromString(text, 'application/xml');
    const error = xml.getElementsByTagName('parsererror')[0];
    if (error) throw new Error(`Invalid XML: ${error.textContent.slice(0, 300)}`);
    if (local(xml.documentElement) !== 'AUTOSAR' ||
        !/^https?:\/\/autosar\.org\/schema\//.test(xml.documentElement.namespaceURI || '')) {
      throw new Error('Expected an AUTOSAR document with an AUTOSAR schema namespace.');
    }
    const records = [], paths = new Map(), types = new Map(), roots = [], references = [];
    function visit(element, parent) {
      const name = shortName(element);
      if (name) {
        const path = `${parent ? parent.path : ''}/${name}`;
        if (paths.has(path)) throw new Error(`Duplicate AUTOSAR object path: ${path}`);
        const record = { name, path, type: local(element), element, parent, children: [] };
        paths.set(path, record);
        records.push(record);
        if (parent) parent.children.push(record); else roots.push(record);
        if (!types.has(record.type)) types.set(record.type, []);
        types.get(record.type).push(record);
        parent = record;
      }
      if (parent && !element.children.length && /(?:REF|TREF)$/.test(local(element))) {
        const path = element.textContent.trim();
        if (path.startsWith('/')) references.push({ source: parent, path, field: local(element) });
      }
      for (const child of element.children) visit(child, parent);
    }
    visit(xml.documentElement, null);
    roots.sort(compare);
    for (const record of records) record.children.sort(compare);
    for (const items of types.values()) items.sort(compare);
    const incoming = new Map();
    let missingReferences = 0;
    for (const ref of references) {
      if (!paths.has(ref.path)) { missingReferences++; continue; }
      if (!incoming.has(ref.path)) incoming.set(ref.path, []);
      incoming.get(ref.path).push(ref);
    }
    const grouped = new Map();
    for (const [type, children] of types) {
      const category = categoryName(type);
      if (!grouped.has(category)) grouped.set(category, []);
      grouped.get(category).push({ name: friendly(type), type, children, isType: true });
    }
    const categories = [...grouped].map(([name, children]) => ({
      name, children: children.sort(compare), type: `${children.reduce((sum, group) => sum + group.children.length, 0).toLocaleString()} objects`,
      isType: true,
    })).sort(compare);
    for (const category of categories) {
      for (const type of category.children) type.parent = category;
    }
    return { xml, records, paths, types, roots, categories, incoming, missingReferences, references };
  };

  const $ = (id) => document.getElementById(id);
  let model = null, filename = '', selected = null, query = '', limit = PAGE;
  let treeRoot = null, back = [], propertyLimit = PAGE, incomingLimit = 20;
  const tree = $('arxml-tree'), properties = $('arxml-properties');
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function button(text, action, title) {
    const node = element('button', text);
    node.type = 'button';
    if (title) node.title = title;
    node.addEventListener('click', action);
    return node;
  }

  function navigate(record, remember = true) {
    if (remember && selected && selected !== record) back.push(selected);
    selected = record;
    propertyLimit = PAGE;
    incomingLimit = 20;
    $('arxml-back').disabled = !back.length;
    renderProperties();
    properties.scrollTop = 0;
    renderTree();
  }

  function propertyRows(record) {
    const rows = [];
    function walk(node, path) {
      if (node !== record.element && shortName(node)) return;
      for (const attribute of node.attributes) {
        rows.push({ name: `${path}/@${attribute.name}`, value: attribute.value });
      }
      if (!node.children.length) {
        rows.push({ name: path, value: node.textContent.trim(), ref: /(?:REF|TREF)$/.test(local(node)) });
      } else {
        for (const child of node.children) walk(child, `${path}/${local(child)}`);
      }
    }
    walk(record.element, record.type);
    return rows;
  }

  function renderProperties() {
    properties.replaceChildren();
    if (!selected) {
      properties.append(element('h2', 'Explore this AUTOSAR file'));
      properties.append(element('p', 'Choose a category below, search by name, or switch to Packages to follow the original file structure. Select an object to inspect it; orange reference links connect related definitions.'));
      const cards = element('div', undefined, 'arxml-overview');
      for (const category of model.categories) {
        const card = button(`${category.name}\n${category.type} · ${category.children.length} ${category.children.length === 1 ? 'type' : 'types'}`, () => {
          treeRoot = category; query = ''; $('filter').value = ''; $('arxml-mode').value = 'categories'; limit = PAGE; renderTree();
        });
        cards.append(card);
      }
      properties.append(cards);
      properties.append(element('p', `${model.references.length.toLocaleString()} references indexed; ${model.missingReferences.toLocaleString()} point outside this file or to missing objects. External references are shown explicitly, not treated as resolved.`));
      return;
    }
    $('arxml-selected').textContent = selected.path;
    properties.append(element('h3', `${friendly(selected.type)} (${selected.type})`));
    const rows = propertyRows(selected);
    const table = element('table');
    const head = element('tr');
    head.append(element('th', 'Property'), element('th', 'Value / Reference'));
    table.append(head);
    for (const row of rows.slice(0, propertyLimit)) {
      const tr = element('tr'), value = element('td');
      if (row.ref && row.value.startsWith('/')) {
        const target = model.paths.get(row.value);
        if (target) value.append(button(row.value, () => navigate(target), `Go to ${target.type}`));
        else value.append(element('span', `${row.value} (not in this file)`, 'arxml-unresolved'));
      } else value.textContent = row.value;
      const name = element('td');
      name.append(element('strong', friendly(row.name.split('/').pop().replace(/^@/, ''))),
        element('small', row.name, 'arxml-property-path'));
      tr.append(name, value);
      table.append(tr);
    }
    properties.append(table);
    if (rows.length > propertyLimit) properties.append(button(`Show more properties (${rows.length - propertyLimit} remaining)`, () => {
      propertyLimit += PAGE;
      renderProperties();
    }));
    if (selected.children.length) {
      properties.append(element('h3', `Child objects (${selected.children.length.toLocaleString()})`));
      const children = element('div', undefined, 'arxml-related');
      for (const child of selected.children.slice(0, 20)) {
        children.append(button(`${child.name} · ${friendly(child.type)}`, () => navigate(child), child.path));
      }
      properties.append(children);
      properties.append(button('Browse all children', () => {
        query = ''; $('filter').value = ''; treeRoot = selected; limit = PAGE; renderTree();
      }));
    }
    const incoming = model.incoming.get(selected.path) || [];
    properties.append(element('h3', `Referenced by (${incoming.length.toLocaleString()})`));
    const related = element('div', undefined, 'arxml-related');
    for (const ref of incoming.slice(0, incomingLimit)) {
      related.append(button(`${ref.source.path} · ${friendly(ref.field)}`, () => navigate(ref.source), ref.source.type));
    }
    if (!incoming.length) related.append(element('p', 'No references to this object in the current file.'));
    properties.append(related);
    if (incoming.length > incomingLimit) properties.append(button('Show more referring objects', () => {
      incomingLimit += 20; renderProperties();
    }));
  }

  function renderTree() {
    tree.replaceChildren();
    let items;
    if (query) {
      items = model.records.filter((record) => `${record.path} ${record.type}`.toLowerCase().includes(query));
    } else if (treeRoot) items = treeRoot.children;
    else if ($('arxml-mode').value === 'categories') items = model.categories;
    else if ($('arxml-mode').value === 'types') {
      items = [...model.types].sort(([a], [b]) => a.localeCompare(b)).map(([type, children]) => ({
        name: friendly(type), type, children, isType: true,
      }));
    } else items = model.roots;
    $('arxml-breadcrumb').textContent = query ? `Search: ${query}`
      : treeRoot ? treeRoot.path || treeRoot.name : $('arxml-mode').selectedOptions[0].textContent;
    $('arxml-up').disabled = !!query || !treeRoot;
    for (const record of items.slice(0, limit)) {
      const row = element('div', undefined, 'arxml-tree-row' + (selected === record ? ' selected' : ''));
      if (record.children.length) row.append(button('›', () => {
        treeRoot = record; query = ''; $('filter').value = ''; limit = PAGE; renderTree();
      }, `Browse ${record.name}`));
      const label = button(record.name, () => {
        if (record.isType) { treeRoot = record; limit = PAGE; renderTree(); }
        else navigate(record);
      }, record.path || record.name);
      label.className = 'arxml-object';
      row.append(label, element('span', record.type, 'arxml-type'));
      tree.append(row);
    }
    if (!items.length) tree.append(element('p', 'No matching objects.'));
    if (items.length > limit) tree.append(button(`Show more (${items.length - limit} remaining)`, () => {
      limit += PAGE; renderTree();
    }));
    $('arxml-count').textContent = `${Math.min(limit, items.length)} of ${items.length} objects`;
  }

  $('arxml-mode').addEventListener('change', () => { treeRoot = null; limit = PAGE; renderTree(); });
  $('arxml-up').addEventListener('click', () => { treeRoot = treeRoot.parent || null; limit = PAGE; renderTree(); });
  $('arxml-home').addEventListener('click', () => {
    treeRoot = null; query = ''; $('filter').value = ''; limit = PAGE; renderTree();
  });
  $('arxml-back').addEventListener('click', () => { if (back.length) navigate(back.pop(), false); });
  $('arxml-overview').addEventListener('click', () => {
    selected = null; back = []; $('arxml-selected').textContent = 'File overview'; $('arxml-back').disabled = true;
    treeRoot = null; query = ''; $('filter').value = ''; $('arxml-mode').value = 'categories'; limit = PAGE;
    renderProperties(); renderTree();
    properties.scrollTop = 0;
  });
  R.filterArxml = (text) => { query = text.trim().toLowerCase(); limit = PAGE; renderTree(); };
  R.showArxml = (parsed, name) => {
    model = parsed; filename = name; selected = null; treeRoot = null; back = []; query = ''; limit = PAGE;
    $('arxml-mode').value = 'categories';
    $('main').hidden = true; $('arxml-view').hidden = false; document.body.classList.add('arxml-active');
    $('filter').value = ''; $('filter').placeholder = 'Search ARXML paths or object types';
    $('ecu-label').textContent = 'ARXML';
    document.title = `${filename} - ARXML Browser`;
    const schema = parsed.xml.documentElement.getAttributeNS('http://www.w3.org/2001/XMLSchema-instance', 'schemaLocation') || 'not specified';
    $('arxml-summary').textContent = `${filename} · ${parsed.records.length.toLocaleString()} named objects · ${parsed.types.size} types · Schema: ${schema}. XML parsed; XSD validation not performed.`;
    $('arxml-selected').textContent = 'File overview';
    $('arxml-back').disabled = true;
    renderTree(); renderProperties();
  };
  R.closeArxml = () => {
    $('main').hidden = false; $('arxml-view').hidden = true; document.body.classList.remove('arxml-active');
    $('filter').placeholder = 'Filter services by name or 0x ID';
    $('filter').value = R.app?.state.filter || '';
    model = null;
  };
})();
