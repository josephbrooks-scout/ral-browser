/* Load into the app page, then await runWorkspaceTests(). Synthetic AUTOSAR data only. */
window.runWorkspaceTests = async () => {
  const R = window.RAL, $ = (id) => document.getElementById(id);
  let assertions = 0;
  const check = (condition, message) => { if (!condition) throw new Error(message); assertions++; };
  const wrap = (content) => `<AUTOSAR xmlns="http://autosar.org/schema/r4.0"><AR-PACKAGES>
    <AR-PACKAGE><SHORT-NAME>Demo</SHORT-NAME><ELEMENTS>${content}</ELEMENTS></AR-PACKAGE>
    </AR-PACKAGES></AUTOSAR>`;
  const first = wrap(`<ECU-INSTANCE><SHORT-NAME>E</SHORT-NAME><CONNECTORS>
    <CAN-COMMUNICATION-CONNECTOR><SHORT-NAME>C</SHORT-NAME></CAN-COMMUNICATION-CONNECTOR>
    </CONNECTORS></ECU-INSTANCE>
    <CAN-CLUSTER><SHORT-NAME>Network</SHORT-NAME><PHYSICAL-CHANNELS>
      <CAN-PHYSICAL-CHANNEL><SHORT-NAME>Channel</SHORT-NAME>
        <COMMUNICATION-CONNECTOR-REF DEST="CAN-COMMUNICATION-CONNECTOR">/Demo/E/C</COMMUNICATION-CONNECTOR-REF>
        <FRAME-TRIGGERINGS><CAN-FRAME-TRIGGERING><SHORT-NAME>T</SHORT-NAME>
          <FRAME-REF DEST="CAN-FRAME">/Demo/F</FRAME-REF><IDENTIFIER>291</IDENTIFIER>
        </CAN-FRAME-TRIGGERING></FRAME-TRIGGERINGS>
      </CAN-PHYSICAL-CHANNEL>
    </PHYSICAL-CHANNELS></CAN-CLUSTER>
    <CAN-FRAME><SHORT-NAME>F</SHORT-NAME><FRAME-LENGTH>8</FRAME-LENGTH>
      <PDU-TO-FRAME-MAPPINGS><PDU-TO-FRAME-MAPPING><SHORT-NAME>M</SHORT-NAME>
        <PDU-REF DEST="I-SIGNAL-I-PDU">/Demo/P</PDU-REF><START-POSITION>0</START-POSITION>
      </PDU-TO-FRAME-MAPPING></PDU-TO-FRAME-MAPPINGS>
    </CAN-FRAME>`);
  const second = wrap(`<I-SIGNAL-I-PDU><SHORT-NAME>P</SHORT-NAME><LENGTH>8</LENGTH>
      <I-SIGNAL-TO-PDU-MAPPINGS><I-SIGNAL-TO-I-PDU-MAPPING><SHORT-NAME>M</SHORT-NAME>
        <I-SIGNAL-REF DEST="I-SIGNAL">/Demo/S</I-SIGNAL-REF><START-POSITION>7</START-POSITION>
        <PACKING-BYTE-ORDER>MOST-SIGNIFICANT-BYTE-FIRST</PACKING-BYTE-ORDER>
      </I-SIGNAL-TO-I-PDU-MAPPING></I-SIGNAL-TO-PDU-MAPPINGS>
    </I-SIGNAL-I-PDU>
    <I-SIGNAL><SHORT-NAME>S</SHORT-NAME><LENGTH>16</LENGTH>
      <SYSTEM-SIGNAL-REF DEST="SYSTEM-SIGNAL">/Demo/SS</SYSTEM-SIGNAL-REF>
    </I-SIGNAL>
    <SYSTEM-SIGNAL><SHORT-NAME>SS</SHORT-NAME>
      <COMPU-METHOD-REF DEST="COMPU-METHOD">/Demo/Scale</COMPU-METHOD-REF>
    </SYSTEM-SIGNAL>
    <COMPU-METHOD><SHORT-NAME>Scale</SHORT-NAME>
      <COMPU-INTERNAL-TO-PHYS><COMPU-SCALES><COMPU-SCALE><COMPU-RATIONAL-COEFFS>
        <COMPU-NUMERATOR><V>-40</V><V>0.5</V></COMPU-NUMERATOR>
        <COMPU-DENOMINATOR><V>1</V></COMPU-DENOMINATOR>
      </COMPU-RATIONAL-COEFFS></COMPU-SCALE></COMPU-SCALES></COMPU-INTERNAL-TO-PHYS>
      <UNIT-REF DEST="UNIT">/Demo/DegC</UNIT-REF>
    </COMPU-METHOD>
    <UNIT><SHORT-NAME>DegC</SHORT-NAME><DISPLAY-NAME>degC</DISPLAY-NAME></UNIT>`);
  const sources = new Map([['network.arxml', first], ['signals.arxml', second]]);
  const parsed = R.parseArxmlWorkspace(sources);
  check(parsed.files.length === 2, 'Keeps both workspace sources');
  check(parsed.roots.length === 1 && parsed.paths.get('/Demo').definitions.length === 2, 'Combines split packages');
  check(parsed.missingReferences === 0 && parsed.conflicts.length === 0, 'Resolves cross-file references');
  check(parsed.outgoing.get('/Demo/F/M')[0].target.file === 'signals.arxml', 'Retains referenced file provenance');
  check(parsed.incoming.get('/Demo/P')[0].source.path === '/Demo/F/M', 'Indexes incoming cross-file links');
  check(R.arxmlRelationships(parsed, parsed.paths.get('/Demo/F')).some((link) => link.record?.path === '/Demo/P'), 'Frame exposes mapped PDU');
  check(R.arxmlRelationships(parsed, parsed.paths.get('/Demo/P')).some((link) => link.record?.path === '/Demo/S'), 'PDU exposes mapped signal');
  check(R.arxmlRelationships(parsed, parsed.paths.get('/Demo/E')).some((link) => link.record?.path === '/Demo/Network/Channel'), 'ECU exposes network through connector reference');
  const details = R.arxmlSignalDetails(parsed, parsed.paths.get('/Demo/S'));
  check(details.some((row) => row.owner.path === '/Demo/DegC' && row.value === 'degC'), 'Traces unit through system signal and compu method');
  check(details.some((row) => row.name.includes('COMPU-NUMERATOR/V[2]') && row.value === '0.5'), 'Preserves coefficient context');
  check(R.arxmlProperties(parsed.paths.get('/Demo/P/M')).some((row) => row.name.endsWith('/START-POSITION') && row.value === '7'), 'Exposes declared bit position');
  const mapping = R.arxmlMappings(parsed, parsed.paths.get('/Demo/P'))[0];
  check(mapping.position === '7' && mapping.order === 'MOST-SIGNIFICANT-BYTE-FIRST' && mapping.length === '16', 'Summarizes mapped signal layout');
  check(R.arxmlCommunicationGroups(parsed).some((group) => group.name === 'ECUs' && group.children.length === 1), 'Groups communication objects');
  const changedSignal = second.replace('<LENGTH>16</LENGTH>', '<LENGTH>32</LENGTH>');
  const conflict = R.parseArxmlWorkspace(new Map([...sources, ['conflict.arxml', changedSignal]]));
  check(conflict.paths.get('/Demo/S').conflict && conflict.conflicts.length === 1, 'Detects differing definitions at same path');
  check(conflict.outgoing.get('/Demo/P/M').every((ref) => !ref.target && ref.status === 'conflict'), 'Does not resolve conflicting targets');
  const reversed = R.parseArxmlWorkspace(new Map([...sources].reverse()));
  check(reversed.paths.get('/Demo/F/M').file === 'network.arxml' && reversed.missingReferences === 0, 'Selection order does not affect resolution');
  const identical = R.parseArxmlWorkspace(new Map([['a.arxml', second], ['b.arxml', second]]));
  check(identical.conflicts.length === 0 && identical.paths.get('/Demo/S').definitions.length === 2, 'Coalesces identical definitions without losing provenance');
  const mismatch = R.parseArxmlWorkspace(new Map([['bad.arxml', first.replace('DEST="I-SIGNAL-I-PDU"', 'DEST="I-SIGNAL"')], ['signals.arxml', second]]));
  check(mismatch.outgoing.get('/Demo/F/M')[0].status === 'type mismatch', 'Reports incorrect DEST type');
  const namespaceMismatch = R.parseArxmlWorkspace(new Map([['network.arxml', first], ['other.arxml', second.replace('schema/r4.0', 'schema/r3.0')]]));
  check(namespaceMismatch.outgoing.get('/Demo/F/M')[0].status === 'namespace mismatch' && namespaceMismatch.paths.get('/Demo').conflict, 'Does not silently combine incompatible namespaces');
  check(R.parseArxmlWorkspace(new Map([['network.arxml', first]])).missingReferences === 1, 'Reports absent cross-file target');
  try { R.parseArxmlWorkspace(new Map([['broken.arxml', '<bad>']])); throw new Error('Accepted invalid XML'); }
  catch (error) { check(error.message.includes('broken.arxml') && error.message.includes('Invalid XML'), 'Names failing source'); }

  const base = R.parseArxml(second, 'baseline.arxml');
  const candidate = R.parseArxml(changedSignal.replace('<DISPLAY-NAME>degC</DISPLAY-NAME>', '<DISPLAY-NAME>Celsius</DISPLAY-NAME>')
    .replace('</ELEMENTS>', '<CAN-FRAME><SHORT-NAME>NewFrame</SHORT-NAME></CAN-FRAME></ELEMENTS>'), 'candidate.arxml');
  const diff = R.compareArxml(base, candidate);
  check(diff.counts.changed === 2 && diff.counts.added === 1 && diff.counts.removed === 0, 'Counts added and changed definitions');
  check(!diff.changes.some((change) => change.path === '/Demo'), 'Does not cascade child changes to parent package');
  const layoutCandidate = R.parseArxml(second.replace('<START-POSITION>7', '<START-POSITION>15')
    .replace('<V>0.5</V>', '<V>0.25</V>').replace('/Demo/SS</SYSTEM-SIGNAL-REF>', '/Demo/Missing</SYSTEM-SIGNAL-REF>'));
  check(R.compareArxml(base, layoutCandidate).counts.changed === 3, 'Detects mapping, scaling and reference changes independently');
  check(R.arxmlPropertyDiff(base.paths.get('/Demo/Scale'), layoutCandidate.paths.get('/Demo/Scale')).some((row) => row.before === '0.5' && row.after === '0.25'), 'Shows changed scaling coefficient');
  check(R.arxmlPropertyDiff(base.paths.get('/Demo/S'), candidate.paths.get('/Demo/S')).some((row) =>
    row.name.endsWith('/LENGTH') && row.before === '16' && row.after === '32'), 'Shows before/after values');
  check(R.compareArxml(candidate, base).counts.removed === 1, 'Reversed comparison reports removed definitions');
  check(R.compareArxml(base, base).changes.length === 0, 'Identical file has no differences');
  check(R.compareArxml(R.parseArxml(wrap('')), base).changes.every((change) => change.path !== '/Demo'), 'Adding first named children does not change package properties');
  const attributesA = R.parseArxml(wrap('<I-SIGNAL UUID="a"><SHORT-NAME>S</SHORT-NAME></I-SIGNAL>'));
  const attributesB = R.parseArxml(wrap('<I-SIGNAL UUID="b"><SHORT-NAME>S</SHORT-NAME></I-SIGNAL>'));
  check(R.arxmlPropertyDiff(attributesA.paths.get('/Demo/S'), attributesB.paths.get('/Demo/S')).some((row) => row.name.endsWith('/@UUID')), 'Compares UUID attributes');
  const typesB = R.parseArxml(wrap('<SYSTEM-SIGNAL UUID="a"><SHORT-NAME>S</SHORT-NAME></SYSTEM-SIGNAL>'));
  check(R.compareArxml(attributesA, typesB).counts.changed === 1, 'Detects type changes at same path');
  const prefix = second.replace('<AUTOSAR xmlns=', '<a:AUTOSAR xmlns:a=').replace(/<(\/?)([A-Z][A-Z0-9-]*)(?=[ >])/g, '<$1a:$2');
  check(R.compareArxml(base, R.parseArxml(prefix)).changes.length === 0, 'Ignores namespace prefix spelling');
  const ordered = R.parseArxml(wrap('<I-SIGNAL><SHORT-NAME>S</SHORT-NAME><A>1</A><B>2</B></I-SIGNAL>'));
  const reordered = R.parseArxml(wrap('<I-SIGNAL><SHORT-NAME>S</SHORT-NAME><B>2</B><A>1</A></I-SIGNAL>'));
  check(R.arxmlPropertyDiff(ordered.paths.get('/Demo/S'), reordered.paths.get('/Demo/S')).some((row) => row.name.endsWith('/#children')), 'Explains structural ordering differences');
  const repeatBefore = R.parseArxml(wrap('<I-SIGNAL><SHORT-NAME>S</SHORT-NAME><V>1</V><V>2</V></I-SIGNAL>'));
  const repeatAfter = R.parseArxml(wrap('<I-SIGNAL><SHORT-NAME>S</SHORT-NAME><V>1</V><V>3</V></I-SIGNAL>'));
  check(R.arxmlPropertyDiff(repeatBefore.paths.get('/Demo/S'), repeatAfter.paths.get('/Demo/S')).some((row) => row.name.endsWith('/V[2]') && row.after === '3'), 'Disambiguates repeated properties');
  const mixedBefore = R.parseArxml(wrap('<I-SIGNAL><SHORT-NAME>S</SHORT-NAME><DESC>Hello <EM>world</EM>!</DESC></I-SIGNAL>'));
  const mixedAfter = R.parseArxml(wrap('<I-SIGNAL><SHORT-NAME>S</SHORT-NAME><DESC>Changed <EM>world</EM>!</DESC></I-SIGNAL>'));
  check(R.arxmlPropertyDiff(mixedBefore.paths.get('/Demo/S'), mixedAfter.paths.get('/Demo/S')).some((row) => row.name.includes('#text') && row.after === 'Changed '), 'Compares mixed-content text');
  R.showArxml(conflict, 'Conflict workspace');
  R.filterArxml('/Demo/P/M');
  document.querySelector('.arxml-object').click();
  check(document.querySelector('.arxml-unresolved').textContent.includes('conflicting definitions'), 'Labels ambiguous reference in properties');
  $('arxml-overview').click();
  check($('arxml-properties').textContent.includes('Conflicting definition: /Demo/S'), 'Keeps conflicts in persistent issues list');

  const waitFor = async (predicate) => {
    for (let i = 0; i < 200; i++) {
      if (predicate()) return;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    throw new Error('Timed out waiting for UI update');
  };
  const selectFiles = (id, entries) => {
    const transfer = new DataTransfer();
    for (const [name, text] of entries) transfer.items.add(new File([text], name));
    $(id).files = transfer.files;
    $(id).dispatchEvent(new Event('change', { bubbles: true }));
  };
  selectFiles('file-input', [...sources]);
  await waitFor(() => R.app.state.arxmlSource?.sources.size === 2);
  check($('arxml-summary').textContent.includes('2 file(s)'), 'Opens multi-file workspace through Open');
  check(document.querySelectorAll('.arxml-file-row').length === 2, 'Lists source files');
  R.filterArxml('/Demo/F/M');
  document.querySelector('.arxml-object').click();
  [...document.querySelectorAll('#arxml-properties button')].find((node) => node.textContent === '/Demo/P').click();
  check($('arxml-selected').textContent === '/Demo/P' && $('arxml-properties').textContent.includes('signals.arxml'), 'Follows cross-file link and shows provenance');
  $('arxml-communication').click();
  check($('arxml-properties').textContent.includes('Connected objects') && $('arxml-properties').textContent.includes('/Demo/S'), 'Communication view shows mapped signals');
  check($('arxml-properties').textContent.includes('Start bit: 7') && $('arxml-properties').textContent.includes('Length: 16 bits'), 'Displays mapping summary table');
  R.filterArxml('/Demo/P/M');
  document.querySelector('.arxml-object').click();
  check($('arxml-properties').textContent.includes('MOST-SIGNIFICANT-BYTE-FIRST'), 'Communication mapping exposes byte order');
  $('arxml-compare').click();
  selectFiles('arxml-baseline', [['same.arxml', second]]);
  await waitFor(() => $('arxml-properties').textContent.includes('Baseline: same.arxml'));
  selectFiles('arxml-candidate', [['same.arxml', changedSignal]]);
  await waitFor(() => $('arxml-properties').textContent.includes('1 changed'));
  check(document.querySelectorAll('.arxml-tree-row').length === 1, 'Compares same-filename revisions independently');
  document.querySelector('.arxml-object').click();
  check($('arxml-properties').textContent.includes('16') && $('arxml-properties').textContent.includes('32'), 'Displays comparison property table');
  $('arxml-diff-status').value = 'added';
  $('arxml-diff-status').dispatchEvent(new Event('change'));
  check($('arxml-tree').textContent.includes('No matching differences'), 'Filters comparison by status');
  check(R.app.state.arxmlSource.sources.size === 2, 'Comparison does not replace workspace');
  const hugeBefore = R.parseArxml(wrap(Array.from({ length: 450 }, (_, i) => `<I-SIGNAL><SHORT-NAME>S${i}</SHORT-NAME><LENGTH>8</LENGTH></I-SIGNAL>`).join('')));
  const hugeAfter = R.parseArxml(wrap(Array.from({ length: 450 }, (_, i) => `<I-SIGNAL><SHORT-NAME>S${i}</SHORT-NAME><LENGTH>16</LENGTH></I-SIGNAL>`).join('')));
  $('arxml-diff-status').value = '';
  R.showArxmlComparison(hugeBefore, hugeAfter);
  check(document.querySelectorAll('.arxml-tree-row').length === 200, 'Pages comparison object list');
  [...document.querySelectorAll('#arxml-tree button')].find((node) => node.textContent.startsWith('Show more')).click();
  check(document.querySelectorAll('.arxml-tree-row').length === 400, 'Shows next comparison page');
  selectFiles('arxml-candidate', [['broken.arxml', '<AUTOSAR>']]);
  await waitFor(() => $('arxml-compare-error').textContent.includes('Invalid XML'));
  check(!$('arxml-properties').textContent.includes('1 changed'), 'Does not retain a stale report after failed comparison import');
  $('arxml-explorer').click();
  $('arxml-overview').click();
  R.removeArxmlFile('signals.arxml');
  check(R.app.state.arxmlSource.sources.size === 1 && $('arxml-summary').textContent.includes('1 unresolved'), 'Removing file recalculates missing references');
  $('arxml-communication').click();
  R.filterArxml('/Demo/F');
  [...document.querySelectorAll('.arxml-object')].find((node) => node.textContent === 'F').click();
  check($('arxml-properties').textContent.includes('/Demo/P (missing)'), 'Renders unresolved mapping without assuming target layout');
  selectFiles('arxml-add-input', [['signals.arxml', second]]);
  await waitFor(() => R.app.state.arxmlSource.sources.size === 2);
  check($('arxml-summary').textContent.includes('0 unresolved'), 'Adding file resolves missing reference');
  selectFiles('arxml-add-input', [['signals.arxml', second]]);
  await waitFor(() => $('status-msg').textContent.includes('already selected'));
  check(R.app.state.arxmlSource.sources.size === 2, 'Rejects duplicate filenames without replacing workspace');
  R.app.commands.reload();
  check(R.app.state.arxmlSource.sources.size === 2 && $('arxml-summary').textContent.includes('0 unresolved'), 'Reload preserves workspace sources');
  selectFiles('file-input', [['bad.arxml', '<AUTOSAR>']]);
  await waitFor(() => $('status-msg').textContent.includes('Invalid XML'));
  check(R.app.state.arxmlSource.sources.size === 2 && !$('arxml-view').hidden, 'Failed workspace import preserves valid view');
  selectFiles('file-input', [['network.arxml', first], ['bad.yaml', 'ecus: {}']]);
  await waitFor(() => $('status-msg').textContent.includes('separately'));
  check(R.app.state.arxmlSource.sources.size === 2, 'Rejects mixing ARXML and RAL');
  R.app.loadText('ecus: {demo: {diagnostics: {dids: {}, routine_controls: {}}}}', 'demo.yaml');
  check($('arxml-view').hidden && R.app.state.arxmlSource === null, 'RAL import closes workspace');
  let release;
  const delayed = new File([first], 'delayed.arxml');
  Object.defineProperty(delayed, 'text', { value: () => new Promise((resolve) => { release = resolve; }) });
  const transfer = new DataTransfer(); transfer.items.add(delayed);
  $('file-input').files = transfer.files;
  $('file-input').dispatchEvent(new Event('change', { bubbles: true }));
  R.app.loadText('ecus: {latest: {diagnostics: {dids: {}, routine_controls: {}}}}', 'latest.yaml');
  release(first);
  await new Promise((resolve) => setTimeout(resolve, 20));
  check(R.app.state.file === 'latest.yaml' && R.app.state.arxmlSource === null, 'Late ARXML file read cannot overwrite a newer RAL import');
  return { assertions, passed: true };
};
