/* Read-only AUTOSAR explorer. XML is parsed locally, never inserted as HTML. */
(function () {
  const R = window.RAL;
  const PAGE = 200;
  const friendly = R.arxmlLabel;
  const $ = (id) => document.getElementById(id);
  let model = null, filename = '', selected = null, query = '', limit = PAGE;
  let treeRoot = null, back = [], propertyLimit = PAGE, incomingLimit = 20, issueLimit = PAGE;
  let view = 'explorer', comparison = null, diffSelection = null, diffLimit = PAGE;
  let messages = null, messageLimit = PAGE;
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
    relationLimit = PAGE;
    $('arxml-back').disabled = !back.length;
    renderProperties();
    properties.scrollTop = 0;
    renderTree();
  }

  const propertyRows = R.arxmlProperties;
  let relationLimit = PAGE;
  const comparisonInputs = { baseline: null, candidate: null };
  const comparisonVersions = { baseline: 0, candidate: 0 };
  const comparisonMessages = { baseline: '', candidate: '' };
  const updateComparisonMessage = () => { $('arxml-compare-error').textContent = Object.values(comparisonMessages).filter(Boolean).join(' '); };

  function setView(next) {
    view = next; treeRoot = null; query = ''; $('filter').value = ''; limit = PAGE;
    for (const name of ['explorer', 'communication', 'messages', 'compare']) {
      $(`arxml-${name}`).setAttribute('aria-pressed', String(view === name));
    }
    $('arxml-compare-controls').hidden = view !== 'compare';
    $('arxml-messages-panel').hidden = view !== 'messages';
    document.querySelector('.arxml-layout').hidden = view === 'messages';
    $('arxml-mode').hidden = view !== 'explorer';
    $('arxml-up').hidden = view === 'compare';
    $('arxml-back').hidden = view === 'compare';
    $('filter').placeholder = view === 'messages' ? 'Search messages, networks, ECUs or findings'
      : view === 'compare' ? 'Search changed object paths or types' : 'Search ARXML paths or object types';
    if (view === 'messages') { messageLimit = PAGE; renderMessages(); return; }
    renderTree(); renderProperties();
  }
  for (const name of ['explorer', 'communication', 'messages', 'compare']) {
    $(`arxml-${name}`).addEventListener('click', () => setView(name));
  }

  function renderMessages() {
    if (!messages) {
      messages = R.arxmlMessages(model);
      const select = $('arxml-message-ecu');
      select.replaceChildren(element('option', 'All ECUs'));
      select.firstChild.value = '';
      for (const ecu of model.types.get('ECU-INSTANCE') || []) {
        const option = element('option', ecu.path);
        option.value = ecu.path; select.append(option);
      }
    }
    const ecu = $('arxml-message-ecu').value, direction = $('arxml-message-direction').value;
    const matching = messages.filter((row) => {
      if ((ecu || direction) && !row.endpoints.some((endpoint) =>
        (!ecu || endpoint.ecu.path === ecu) && (!direction || endpoint.direction === direction))) return false;
      return [row.path, row.type, row.channel?.path, row.network?.path, row.identifier, row.trigger?.path,
        ...row.endpoints.map((endpoint) => endpoint.ecu.path), ...row.carried.map((link) => link.path),
        ...row.findings, ...row.sources].join(' ').toLowerCase().includes(query);
    });
    const list = $('arxml-message-list');
    list.replaceChildren(element('p', 'Configured communication only, not observed bus traffic. IN/OUT is read from referenced ECU ports, never inferred from reference direction. Unknown does not mean no sender or receiver. Variants are not evaluated; no SecOC/security checks or gateway route inference.', 'arxml-notice'));
    const table = element('table', undefined, 'arxml-messages-table'), head = element('tr');
    for (const label of ['Message / Type', 'Network / Channel', 'Identifier / Length', 'Sending ECUs', 'Receiving ECUs', 'Carried PDUs / Signals', 'Evidence / Findings']) head.append(element('th', label));
    table.append(head);
    const objectLink = (record) => button(record.path, () => { selected = null; back = []; setView('communication'); navigate(record); }, record.type);
    for (const row of matching.slice(0, messageLimit)) {
      const tr = element('tr'), name = element('td');
      if (row.message) name.append(objectLink(row.message)); else name.append(element('strong', row.path));
      name.append(element('small', row.type, 'arxml-property-path'));
      const channel = element('td');
      for (const record of [row.network, row.channel].filter(Boolean)) channel.append(objectLink(record));
      if (!channel.childNodes.length) channel.textContent = 'Unknown / not declared';
      const layout = element('td', `ID: ${row.identifier ?? 'not declared'}`);
      layout.append(element('small', `Length: ${row.length === undefined ? 'not declared' : `${row.length} bytes`}`, 'arxml-property-path'));
      const sender = element('td'), receiver = element('td');
      for (const [cell, direction] of [[sender, 'OUT'], [receiver, 'IN']]) {
        const ecus = new Map(row.endpoints.filter((item) => item.direction === direction).map((item) => [item.ecu.path, item.ecu]));
        for (const ecu of ecus.values()) cell.append(objectLink(ecu));
        if (!ecus.size) cell.textContent = 'Unknown';
      }
      const carried = element('td');
      for (const link of row.carried) {
        if (link.target) carried.append(objectLink(link.target));
        else carried.append(element('p', `${link.path} (${link.status})`, 'arxml-conflict'));
      }
      if (!row.carried.length) carried.textContent = 'Not resolved / not declared';
      const evidence = element('td');
      for (const finding of row.findings) evidence.append(element('p', finding, 'arxml-conflict'));
      const details = element('details');
      details.append(element('summary', 'Source evidence'));
      if (row.trigger) details.append(objectLink(row.trigger));
      for (const endpoint of row.endpoints) {
        details.append(element('p', `${endpoint.direction}: ${endpoint.ecu.path}`), objectLink(endpoint.port),
          element('small', `${endpoint.ref.source.path} → ${endpoint.ref.path} · ${endpoint.ref.field} · ${endpoint.ref.file}`, 'arxml-property-path'));
      }
      for (const link of row.carried) details.append(element('small', `${link.mapping.path} → ${link.path} · ${link.file}`, 'arxml-property-path'));
      details.append(element('p', row.sources.join(', ')));
      evidence.append(details);
      tr.append(name, channel, layout, sender, receiver, carried, evidence); table.append(tr);
    }
    list.append(table);
    if (!matching.length) list.append(element('p', 'No matching messages. Supported rows are CAN/LIN/FlexRay frame triggerings, PDU triggerings, and frame/PDU definitions. Load related system-description files to resolve ECU ports.'));
    if (matching.length > messageLimit) list.append(button('Show more messages', () => { messageLimit += PAGE; renderMessages(); }));
    $('arxml-message-count').textContent = `${Math.min(messageLimit, matching.length)} of ${matching.length} matching message rows (${messages.length} total)`;
  }
  for (const id of ['arxml-message-ecu', 'arxml-message-direction']) {
    $(id).addEventListener('change', () => { messageLimit = PAGE; renderMessages(); });
  }
  function renderSources() {
    properties.append(element('h3', 'Workspace files'));
    for (const file of model.files) {
      const row = element('div', undefined, 'arxml-file-row');
      row.append(element('span', `${file.name} · ${file.count.toLocaleString()} source objects · Schema: ${file.schema} · Namespace: ${file.namespace}`));
      const remove = button('Remove', () => R.removeArxmlFile(file.name), `Remove ${file.name}`);
      remove.disabled = model.files.length === 1;
      row.append(remove); properties.append(row);
      const details = element('details'), summary = element('summary', 'Declared file metadata');
      details.append(summary);
      if (!file.metadata.length) details.append(element('p', 'No additional document-level release/admin metadata declared. Object-level ADMIN-DATA remains visible in properties.'));
      for (const item of file.metadata) details.append(element('p', `${item.name}: ${item.value}`));
      properties.append(details);
    }
    properties.append(element('p', 'Schema filenames are source metadata, not proof of an ECU software release. No approved ECU baseline is loaded; ECU compatibility is not checked.', 'arxml-notice'));
  }
  function renderIssues() {
    const issues = [
      ...model.conflicts.map((record) => ({ record, text: `Conflicting definition: ${record.path} (${record.definitions.map((item) => item.file).join(', ')})` })),
      ...model.references.filter((ref) => ref.status !== 'resolved').map((ref) =>
        ({ record: ref.source, text: `${ref.status}: ${ref.path} from ${ref.source.path} · ${ref.file} · ${ref.field}` })),
    ];
    properties.append(element('h3', `Workspace issues (${issues.length.toLocaleString()})`));
    const list = element('div', undefined, 'arxml-related');
    for (const issue of issues.slice(0, issueLimit)) list.append(button(issue.text, () => navigate(issue.record)));
    if (!issues.length) list.append(element('p', 'No conflicting paths or unresolved absolute references found. This is not XSD or ECU compatibility validation.'));
    properties.append(list);
    if (issues.length > issueLimit) properties.append(button('Show more issues', () => { issueLimit += PAGE; renderProperties(); }));
  }
  function renderCommunication() {
    properties.append(element('h3', 'Communication relationships'));
    properties.append(element('p', 'Follow explicit references and containment from ECU/connectors to channels, triggerings, frames, PDUs and signals. Reference direction is not transmit/receive direction. Missing links are not inferred.'));
    if (selected.conflict) {
      properties.append(element('p', 'This path has conflicting definitions. Relationships and decoded summaries are withheld; inspect each source below.', 'arxml-notice'));
      return;
    }
    const details = R.arxmlSignalDetails(model, selected);
    if (details.length) {
      const table = element('table'), head = element('tr');
      head.append(element('th', 'Communication property / Source object'), element('th', 'Declared value'));
      table.append(head);
      for (const detail of details.slice(0, propertyLimit)) {
        const row = element('tr'), name = element('td');
        name.append(element('strong', detail.name), element('small', `${detail.owner.path} · ${detail.owner.file}`, 'arxml-property-path'));
        row.append(name, element('td', detail.value)); table.append(row);
      }
      properties.append(table);
      if (details.length > propertyLimit) properties.append(button('Show more communication properties', () => { propertyLimit += PAGE; renderProperties(); }));
    }
    const mappings = R.arxmlMappings(model, selected);
    if (mappings.length) {
      properties.append(element('h3', `Mappings (${mappings.length.toLocaleString()})`));
      const table = element('table'), head = element('tr');
      head.append(element('th', 'Mapped object / Mapping'), element('th', 'Declared layout'));
      table.append(head);
      for (const item of mappings.slice(0, relationLimit)) {
        const row = element('tr'), target = element('td'), layout = element('td');
        if (item.conflict) {
          target.textContent = item.mapping.path; layout.textContent = 'Conflicting mapping definitions';
        } else {
          if (item.ref.target) target.append(button(item.ref.target.name, () => navigate(item.ref.target), item.ref.path));
          else target.append(element('strong', `${item.ref.path} (${item.ref.status})`, 'arxml-conflict'));
          target.append(element('small', `${item.mapping.path} · ${item.ref.file}`, 'arxml-property-path'));
          layout.textContent = `Start bit: ${item.position ?? 'not declared'}; Byte order: ${item.order ?? 'not declared'}`;
          if (item.length !== undefined) layout.append(element('small', `Length: ${item.length} ${/SIGNAL/.test(item.ref.target.type) && !/PDU/.test(item.ref.target.type) ? 'bits' : 'bytes'}`, 'arxml-property-path'));
          if (item.transfer) layout.append(element('small', `Transfer: ${item.transfer}`, 'arxml-property-path'));
        }
        row.append(target, layout); table.append(row);
      }
      properties.append(table);
      if (mappings.length > relationLimit) properties.append(button('Show more mappings', () => { relationLimit += PAGE; renderProperties(); }));
    }
    const links = R.arxmlRelationships(model, selected);
    properties.append(element('h3', `Connected objects (${links.length.toLocaleString()})`));
    const list = element('div', undefined, 'arxml-related');
    for (const link of links.slice(0, relationLimit)) {
      const row = element('div');
      if (link.record && link.status === 'resolved') row.append(button(`${link.path} · ${link.record.type}`, () => navigate(link.record)));
      else row.append(element('strong', `${link.path} (${link.status})`, 'arxml-conflict'));
      row.append(element('small', `${link.relation} · ${link.field} · ${link.file}`, 'arxml-property-path'));
      list.append(row);
    }
    if (!links.length) list.append(element('p', 'No explicit relationships found in the loaded files.'));
    properties.append(list);
    if (links.length > relationLimit) properties.append(button('Show more connections', () => { relationLimit += PAGE; renderProperties(); }));
    properties.append(element('p', 'Lengths and start positions are shown as declared. Signal LENGTH is in bits; PDU/frame lengths are in bytes. COMPU coefficients are displayed in their original numerator/denominator context, not assumed to be a simple scale/offset.', 'arxml-notice'));
  }

  function showComparison(baseline, candidate) {
    comparison = R.compareArxml(baseline, candidate);
    diffSelection = null; diffLimit = PAGE; limit = PAGE;
    query = ''; $('filter').value = ''; $('arxml-compare-error').textContent = '';
    setView('compare');
  }
  R.showArxmlComparison = showComparison;
  for (const side of ['baseline', 'candidate']) {
    $(`arxml-${side}`).addEventListener('change', async (event) => {
      const file = event.target.files[0];
      if (!file) return;
      const version = ++comparisonVersions[side];
      comparisonInputs[side] = null; comparison = null; diffSelection = null;
      comparisonMessages[side] = `Reading ${side}: ${file.name}…`; updateComparisonMessage();
      renderTree(); renderProperties();
      try {
        const text = await file.text();
        if (version !== comparisonVersions[side] || !model) return;
        if (!/\.(arxml|xml)$/i.test(file.name)) throw new Error('Select an ARXML / AUTOSAR XML file.');
        const parsed = R.parseArxml(text, file.name);
        comparisonInputs[side] = parsed;
        comparisonMessages[side] = ''; updateComparisonMessage();
        if (comparisonInputs.baseline && comparisonInputs.candidate) showComparison(comparisonInputs.baseline, comparisonInputs.candidate);
        else { renderTree(); renderProperties(); }
      } catch (error) {
        if (version !== comparisonVersions[side] || !model) return;
        comparisonMessages[side] = `Could not read ${side} "${file.name}": ${error.message}`; updateComparisonMessage();
      }
    });
  }
  $('arxml-diff-status').addEventListener('change', () => { limit = PAGE; renderTree(); });

  function renderComparison() {
    $('arxml-selected').textContent = diffSelection?.path || 'Comparison overview';
    properties.append(element('h2', 'ARXML file comparison'));
    properties.append(element('p', 'Choose two files above: baseline (before) and candidate (after). They are compared independently, not merged into the workspace. Objects match by full AUTOSAR path; a rename appears as removed + added. This is a definition comparison, not ECU compatibility validation.'));
    if (!comparison) {
      for (const side of ['baseline', 'candidate']) {
        const source = comparisonInputs[side];
        properties.append(element('p', `${side === 'baseline' ? 'Baseline' : 'Candidate'}: ${source ? source.files[0].name : 'not loaded'}`));
      }
      return;
    }
    const { baseline, candidate, counts } = comparison;
    properties.append(element('p', `${baseline.files[0].name} → ${candidate.files[0].name}`, 'arxml-source'));
    properties.append(element('p', `${counts.added} added · ${counts.removed} removed · ${counts.changed} changed · ${counts.unchanged} unchanged`, 'arxml-status'));
    properties.append(element('p', `Baseline schema: ${baseline.files[0].schema}; namespace: ${baseline.files[0].namespace}. Candidate schema: ${candidate.files[0].schema}; namespace: ${candidate.files[0].namespace}.`));
    const metadataBefore = JSON.stringify(baseline.files[0].metadata), metadataAfter = JSON.stringify(candidate.files[0].metadata);
    if (metadataBefore !== metadataAfter) {
      properties.append(element('p', 'Document-level metadata differs (separate from named-object counts).', 'arxml-notice'));
      properties.append(element('pre', `Baseline:\n${metadataBefore}\nCandidate:\n${metadataAfter}`, 'arxml-metadata-diff'));
    }
    properties.append(element('p', 'Compares local properties, attributes (including UUID), reference targets, ordering, and named-object types. Nested named objects are compared separately. Formatting between elements and namespace-prefix spelling are ignored. No semantic equivalence or variant evaluation is assumed.'));
    if (!diffSelection) {
      properties.append(element('p', comparison.changes.length ? 'Select a difference on the left to see before/after properties.' : 'No named-object differences found.'));
      return;
    }
    properties.append(element('h3', `${diffSelection.status.toUpperCase()}: ${diffSelection.path}`));
    const differences = R.arxmlPropertyDiff(diffSelection.before, diffSelection.after);
    const table = element('table', undefined, 'arxml-comparison'), head = element('tr');
    head.append(element('th', 'Property / XML path'), element('th', 'Baseline'), element('th', 'Candidate'));
    table.append(head);
    for (const difference of differences.slice(0, diffLimit)) {
      const row = element('tr');
      row.append(element('td', difference.name),
        element('td', difference.before === undefined ? '(not present)' : difference.before === '' ? '(empty)' : difference.before),
        element('td', difference.after === undefined ? '(not present)' : difference.after === '' ? '(empty)' : difference.after));
      table.append(row);
    }
    properties.append(table);
    if (differences.length > diffLimit) properties.append(button('Show more differences', () => { diffLimit += PAGE; renderProperties(); }));
  }

  function renderProperties() {
    properties.replaceChildren();
    if (view === 'compare') return renderComparison();
    if (!selected) {
      $('arxml-selected').textContent = 'Workspace overview';
      properties.append(element('h2', view === 'communication' ? 'Explore communication data' : 'Explore this AUTOSAR workspace'));
      properties.append(element('p', view === 'communication'
        ? 'Start with an ECU, network, frame, PDU or signal. Follow connected objects to trace the declared communication structure across loaded files.'
        : 'Choose a category below, search by name, or switch to Packages to follow the original file structure. Select an object to inspect it; orange reference links connect related definitions.'));
      const cards = element('div', undefined, 'arxml-overview');
      for (const category of view === 'communication' ? R.arxmlCommunicationGroups(model) : model.categories) {
        const card = button(`${category.name}\n${category.type}${view === 'communication' ? '' : ` · ${category.children.length} ${category.children.length === 1 ? 'type' : 'types'}`}`, () => {
          treeRoot = category; query = ''; $('filter').value = ''; $('arxml-mode').value = 'categories'; limit = PAGE; renderTree();
        });
        cards.append(card);
      }
      properties.append(cards);
      properties.append(element('p', `${model.references.length.toLocaleString()} references indexed; ${model.missingReferences.toLocaleString()} unresolved (missing, conflicting or wrong target type). ${model.conflicts.length} conflicting object paths. Split packages are combined; other differing definitions are not resolved by file order.`));
      renderSources();
      renderIssues();
      return;
    }
    $('arxml-selected').textContent = selected.path;
    properties.append(element('h3', `${friendly(selected.type)} (${selected.type})`));
    properties.append(element('p', `Source: ${selected.definitions.map((item) => item.file).join(', ')}`, 'arxml-source'));
    if (selected.conflict) properties.append(element('p', 'Conflicting definitions: each source is shown below. References to this path are not resolved until the conflict is removed.', 'arxml-notice'));
    if (view === 'communication') renderCommunication();
    const rows = selected.definitions.flatMap((definition) =>
      propertyRows(definition).map((row) => ({ ...row, file: definition.file })));
    const table = element('table');
    const head = element('tr');
    head.append(element('th', 'Property'), element('th', 'Value / Reference'));
    table.append(head);
    for (const row of rows.slice(0, propertyLimit)) {
      const tr = element('tr'), value = element('td');
      if (row.ref && row.value.startsWith('/')) {
        const definition = selected.definitions.find((item) => item.file === row.file);
        const { target, status } = R.arxmlReference(model.paths, row.value, row.dest, definition.element.namespaceURI);
        if (target) value.append(button(row.value, () => navigate(target), `Go to ${target.type}`));
        else value.append(element('span', `${row.value} (${status === 'missing' ? 'not in this file / workspace'
          : status === 'conflict' ? 'conflicting definitions' : status})`, 'arxml-unresolved'));
      } else value.textContent = row.value;
      const name = element('td');
      name.append(element('strong', friendly(row.name.split('/').pop().replace(/^@/, ''))),
        element('small', `${row.name} · ${row.file}`, 'arxml-property-path'));
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
    if (!incoming.length) related.append(element('p', 'No resolved references to this object in the workspace.'));
    properties.append(related);
    if (incoming.length > incomingLimit) properties.append(button('Show more referring objects', () => {
      incomingLimit += 20; renderProperties();
    }));
  }

  function renderTree() {
    tree.replaceChildren();
    let items;
    if (view === 'compare') {
      items = (comparison?.changes || []).filter((change) =>
        (!$('arxml-diff-status').value || change.status === $('arxml-diff-status').value) &&
        `${change.path} ${change.type}`.toLowerCase().includes(query));
    } else if (query) {
      items = model.records.filter((record) => `${record.path} ${record.type} ${record.definitions.map((item) => item.file).join(' ')}`.toLowerCase().includes(query));
    } else if (treeRoot) items = treeRoot.children;
    else if (view === 'communication') items = R.arxmlCommunicationGroups(model);
    else if ($('arxml-mode').value === 'categories') items = model.categories;
    else if ($('arxml-mode').value === 'types') {
      items = [...model.types].sort(([a], [b]) => a.localeCompare(b)).map(([type, children]) => ({
        name: friendly(type), type, children, isType: true,
      }));
    } else items = model.roots;
    $('arxml-breadcrumb').textContent = view === 'compare' ? 'Baseline → Candidate differences' : query ? `Search: ${query}`
      : treeRoot ? treeRoot.path || treeRoot.name : view === 'communication' ? 'Communication groups' : $('arxml-mode').selectedOptions[0].textContent;
    $('arxml-up').disabled = !!query || !treeRoot;
    for (const record of items.slice(0, limit)) {
      const row = element('div', undefined, 'arxml-tree-row' + ((view === 'compare' ? diffSelection : selected) === record ? ' selected' : ''));
      if (record.children.length) row.append(button('›', () => {
        treeRoot = record; query = ''; $('filter').value = ''; limit = PAGE; renderTree();
      }, `Browse ${record.name}`));
      const label = button(record.name, () => {
        if (view === 'compare') { diffSelection = record; diffLimit = PAGE; renderProperties(); renderTree(); properties.scrollTop = 0; }
        else if (record.isType) { treeRoot = record; limit = PAGE; renderTree(); }
        else navigate(record);
      }, record.path || record.name);
      label.className = 'arxml-object';
      row.append(label, element('span', view === 'compare' ? record.status : record.conflict ? `${record.type} · CONFLICT` : record.type, 'arxml-type'));
      tree.append(row);
    }
    if (!items.length) tree.append(element('p', view === 'compare' ? comparison ? 'No matching differences.' : 'Choose a baseline and candidate file.' : 'No matching objects.'));
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
    if (view === 'compare') diffSelection = null;
    selected = null; back = []; $('arxml-selected').textContent = 'Workspace overview'; $('arxml-back').disabled = true;
    treeRoot = null; query = ''; $('filter').value = ''; $('arxml-mode').value = 'categories'; limit = PAGE;
    renderProperties(); renderTree();
    properties.scrollTop = 0;
  });
  R.filterArxml = (text) => {
    query = text.trim().toLowerCase(); limit = PAGE; messageLimit = PAGE;
    if (view === 'messages') renderMessages(); else renderTree();
  };
  R.showArxml = (parsed, name) => {
    model = parsed; filename = name; selected = null; treeRoot = null; back = []; query = ''; limit = PAGE;
    messages = null; messageLimit = PAGE;
    $('arxml-message-ecu').value = ''; $('arxml-message-direction').value = '';
    $('arxml-mode').value = 'categories';
    $('main').hidden = true; $('arxml-view').hidden = false; document.body.classList.add('arxml-active');
    $('filter').value = ''; $('filter').placeholder = 'Search ARXML paths or object types';
    $('ecu-label').textContent = 'ARXML';
    document.title = `${filename} - ARXML Browser`;
    $('arxml-summary').textContent = `${filename} · ${parsed.files.length} file(s) · ${parsed.records.length.toLocaleString()} named objects · ${parsed.types.size} types · ${parsed.conflicts.length} conflicts · ${parsed.missingReferences} unresolved references. XSD validation and ECU compatibility not checked.`;
    $('arxml-selected').textContent = 'Workspace overview';
    $('arxml-back').disabled = true;
    comparison = null; diffSelection = null; issueLimit = PAGE;
    for (const side of ['baseline', 'candidate']) {
      comparisonInputs[side] = null; comparisonVersions[side]++;
      comparisonMessages[side] = '';
      $(`arxml-${side}`).value = '';
    }
    $('arxml-compare-error').textContent = '';
    $('arxml-diff-status').value = '';
    setView('explorer');
  };
  R.closeArxml = () => {
    $('main').hidden = false; $('arxml-view').hidden = true; document.body.classList.remove('arxml-active');
    $('filter').placeholder = 'Filter services by name or 0x ID';
    $('filter').value = R.app?.state.filter || '';
    model = null;
    messages = null; $('arxml-message-list').replaceChildren();
    selected = null; treeRoot = null; back = []; comparison = null; diffSelection = null;
    tree.replaceChildren(); properties.replaceChildren();
    for (const side of ['baseline', 'candidate']) {
      comparisonVersions[side]++;
      comparisonInputs[side] = null;
      comparisonMessages[side] = '';
      $(`arxml-${side}`).value = '';
    }
  };
})();
