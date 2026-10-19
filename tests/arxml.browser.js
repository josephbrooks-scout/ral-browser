/* Load after the app in a browser, then call runArxmlTests(). No customer data required. */
window.runArxmlTests = () => {
  const R = window.RAL;
  let assertions = 0;
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
    assertions++;
  };
  const rejects = (text, expected) => {
    try { R.parseArxml(text); }
    catch (error) { check(expected.test(error.message), error.message); return; }
    throw new Error('Expected invalid ARXML to be rejected');
  };
  const wrap = (content) => `<AUTOSAR xmlns="http://autosar.org/schema/r4.0"><AR-PACKAGES>
    <AR-PACKAGE><SHORT-NAME>Demo</SHORT-NAME><ELEMENTS>${content}</ELEMENTS></AR-PACKAGE>
    </AR-PACKAGES></AUTOSAR>`;
  const xml = wrap(`<I-SIGNAL><SHORT-NAME>Signal</SHORT-NAME><LENGTH>16</LENGTH>
    <SYSTEM-SIGNAL-REF DEST="SYSTEM-SIGNAL">/Demo/SystemSignal</SYSTEM-SIGNAL-REF>
    <DATA-TYPE-REF DEST="IMPLEMENTATION-DATA-TYPE">/External/Type</DATA-TYPE-REF></I-SIGNAL>
    <SYSTEM-SIGNAL><SHORT-NAME>SystemSignal</SHORT-NAME></SYSTEM-SIGNAL>`);
  const parsed = R.parseArxml(xml);
  check(parsed.records.length === 3, 'Indexes all named objects');
  check(parsed.roots.length === 1, 'Finds root package');
  check(parsed.paths.get('/Demo/Signal').parent.path === '/Demo', 'Tracks hierarchy');
  check(parsed.types.get('I-SIGNAL').length === 1, 'Indexes types');
  check(parsed.paths.get('/Demo/Signal').element.localName === 'I-SIGNAL', 'Retains XML properties');
  check(parsed.incoming.get('/Demo/SystemSignal')[0].source.path === '/Demo/Signal', 'Indexes referring objects');
  check(parsed.references.length === 2 && parsed.missingReferences === 1, 'Counts missing references');
  check(parsed.categories.find((category) => category.name === 'Signals & Signal Groups').children.length === 2, 'Groups signal types together');
  const prefixed = R.parseArxml('<a:AUTOSAR xmlns:a="http://autosar.org/schema/r4.0"><a:AR-PACKAGES><a:AR-PACKAGE><a:SHORT-NAME>Prefixed</a:SHORT-NAME></a:AR-PACKAGE></a:AR-PACKAGES></a:AUTOSAR>');
  check(prefixed.paths.has('/Prefixed'), 'Handles namespace prefixes');
  rejects('<AUTOSAR>', /Invalid XML/);
  rejects('<root/>', /Expected an AUTOSAR/);
  rejects('<AUTOSAR xmlns="urn:wrong"/>', /Expected an AUTOSAR/);
  rejects('<!DOCTYPE AUTOSAR [<!ENTITY example "data">]><AUTOSAR/>', /DTD\/entity/);
  rejects(wrap('<I-SIGNAL><SHORT-NAME>Same</SHORT-NAME></I-SIGNAL><I-SIGNAL><SHORT-NAME>Same</SHORT-NAME></I-SIGNAL>'), /Duplicate AUTOSAR object path/);

  R.showArxml(parsed, 'test.arxml');
  check(document.querySelectorAll('.arxml-overview button').length === 2, 'Shows category overview');
  [...document.querySelectorAll('.arxml-overview button')].find((node) => node.textContent.startsWith('Signals')).click();
  document.querySelector('#arxml-tree .arxml-object').click();
  document.getElementById('arxml-up').click();
  check(document.getElementById('arxml-breadcrumb').textContent === 'Signals & Signal Groups', 'Up returns from type to category');
  R.filterArxml('/Demo/Signal');
  document.querySelector('.arxml-object').click();
  check(document.getElementById('arxml-properties').textContent.includes('LENGTH'), 'Shows properties');
  check(document.querySelector('.arxml-unresolved').textContent.includes('/External/Type'), 'Labels external references');
  const link = [...document.querySelectorAll('#arxml-properties button')].find((button) => button.textContent === '/Demo/SystemSignal');
  check(!!link, 'Resolved reference is clickable');
  link.click();
  check(document.getElementById('arxml-selected').textContent === '/Demo/SystemSignal', 'Navigates reference');
  const incomingLink = [...document.querySelectorAll('.arxml-related button')].find((node) => node.textContent.startsWith('/Demo/Signal'));
  check(!!incomingLink, 'Shows referring object link');
  incomingLink.click();
  check(document.getElementById('arxml-selected').textContent === '/Demo/Signal', 'Navigates referring object');
  document.getElementById('arxml-back').click();
  check(document.getElementById('arxml-selected').textContent === '/Demo/SystemSignal', 'Back returns after referring link');
  document.getElementById('arxml-back').click();
  check(document.getElementById('arxml-selected').textContent === '/Demo/Signal', 'Back returns to source');
  document.getElementById('arxml-overview').click();
  check(document.getElementById('arxml-selected').textContent === 'File overview' && document.getElementById('filter').value === '', 'Overview resets search and selection');

  const many = R.parseArxml(wrap(Array.from({ length: 450 }, (_, i) =>
    `<I-SIGNAL><SHORT-NAME>Signal${i}</SHORT-NAME></I-SIGNAL>`).join('')));
  R.showArxml(many, 'large.arxml');
  R.filterArxml('I-SIGNAL');
  check(document.querySelectorAll('.arxml-tree-row').length === 200, 'Pages large result sets');
  [...document.querySelectorAll('#arxml-tree button')].find((button) => button.textContent.startsWith('Show more')).click();
  check(document.querySelectorAll('.arxml-tree-row').length === 400, 'Shows next page');
  R.filterArxml('nothing-matches');
  check(document.getElementById('arxml-tree').textContent.includes('No matching objects'), 'Handles empty search');
  const linked = R.parseArxml(wrap(`<SYSTEM-SIGNAL><SHORT-NAME>Target</SHORT-NAME>
    ${Array.from({ length: 250 }, (_, i) => `<DESC>${i}</DESC>`).join('')}</SYSTEM-SIGNAL>` +
    Array.from({ length: 45 }, (_, i) => `<I-SIGNAL><SHORT-NAME>Source${i}</SHORT-NAME>
      <SYSTEM-SIGNAL-REF DEST="SYSTEM-SIGNAL">/Demo/Target</SYSTEM-SIGNAL-REF></I-SIGNAL>`).join('')));
  R.showArxml(linked, 'linked.arxml');
  R.filterArxml('/Demo/Target');
  document.querySelector('.arxml-object').click();
  check(document.querySelectorAll('#arxml-properties tr').length === 201, 'Pages property rows');
  [...document.querySelectorAll('#arxml-properties button')].find((node) => node.textContent.startsWith('Show more properties')).click();
  check(document.querySelectorAll('#arxml-properties tr').length === 252, 'Shows remaining property rows');
  check(document.querySelectorAll('.arxml-related button').length === 20, 'Pages incoming references');
  [...document.querySelectorAll('#arxml-properties button')].find((node) => node.textContent === 'Show more referring objects').click();
  check(document.querySelectorAll('.arxml-related button').length === 40, 'Shows next referring objects');
  R.closeArxml();
  check(document.getElementById('arxml-view').hidden && !document.getElementById('main').hidden, 'Restores RAL view');
  return { assertions, passed: true };
};
