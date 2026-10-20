/* Load into the app page, then call runPduTests(). Uses synthetic data only. */
window.runPduTests = () => {
  const R = window.RAL;
  let assertions = 0;
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
    assertions++;
  };
  R.app.loadText(`ecus:
  demo:
    diagnostics:
      dids:
        state:
          id: 0x012F
          RDBI: {}
          values:
            - {name: State, type: uint, bit_length: 8, enum: {Init: 0, Active: 1}}
`, 'demo.yaml');
  const node = R.app.state.model.services.find((item) => item.label.startsWith('0x22')).children[0];
  R.app.selectNode(node);
  check([...document.querySelectorAll('#grid-resp .gh .c')].some((cell) => cell.textContent === 'Bit length'), 'Shows bit-length header');
  const stateRow = [...document.querySelectorAll('#grid-resp .gr')].find((row) =>
    row.querySelector('.name')?.textContent.trim() === 'State');
  check(stateRow.children[2].textContent === 'UINT' && stateRow.querySelector('.bits').textContent === '8', 'Enum shows numeric datatype and encoded width');
  check(stateRow.querySelector('.dd') && stateRow.querySelector('.val').textContent.includes('Init'), 'Retains enum label and dropdown');
  const rootRow = document.querySelector('#grid-resp .gr');
  check(getComputedStyle(rootRow.querySelector('.name')).gridColumnStart === 'span 4' &&
    getComputedStyle(rootRow.querySelector('.bits')).display === 'none' &&
    rootRow.querySelector('.pdu').getBoundingClientRect().x === document.querySelector('#grid-resp .gh').children[5].getBoundingClientRect().x,
  'Message heading spans metadata columns without shifting PDU');
  const apply = (index, hex) => {
    document.querySelectorAll('#grid-resp .pdu-edit')[index].click();
    document.getElementById('pdu-input').value = hex;
    document.getElementById('pdu-apply').click();
  };
  apply(0, '62 01 2F 01');
  check(R.pduText(R.app.state.svc.responses[0]) === '62 01 2F 01', 'Updates response hex');
  check([...document.querySelectorAll('.pdu-changed .val')].some((cell) =>
    cell.textContent.includes('Active') && cell.textContent.includes('Was: Init')), 'Highlights changed enum with previous value');
  apply(0, '62 01 30 00');
  check(document.getElementById('pdu-error').textContent.includes('fixed'), 'Reports mismatched DID in dialog');
  check(R.pduText(R.app.state.svc.responses[0]) === '62 01 2F 01', 'Keeps values after rejected header');
  document.getElementById('pdu-cancel').click();
  apply(0, '62');
  check(document.getElementById('pdu-error').textContent.includes('Expected 4 bytes'), 'Rejects wrong length');
  document.getElementById('pdu-cancel').click();
  apply(1, '7F 22 31');
  check([...document.querySelectorAll('.pdu-changed .val')].some((cell) =>
    cell.textContent.startsWith('requestOutOfRange')), 'Updates negative-response enum');
  check([...document.querySelectorAll('.pdu-changed .val')].some((cell) =>
    cell.textContent.startsWith('0x31')), 'Updates linked raw negative-response code');
  apply(2, '7F 2E 22');
  check(document.getElementById('pdu-error').textContent.includes('fixed'), 'Locks generic response request SID');
  document.getElementById('pdu-cancel').click();
  R.app.commands.reset();
  check(R.pduText(R.app.state.svc.responses[0]) === '62 01 2F 00', 'Reset restores original message');
  check(document.querySelectorAll('.pdu-changed').length === 0, 'Reset clears highlights');
  R.app.loadText(`ecus:
  demo:
    diagnostics:
      dids:
        coding:
          id: 0x0600
          WDBI: {}
          RDBI: {}
          values:
            - {name: Flag, type: uint, bit_length: 1, enum: {Off: 0, On: 1}}
            - {name: Mode, type: uint, bit_length: 3, enum: {Init: 0, Active: 5}}
            - {name: Signed, type: sint, bit_length: 12, enum: {Zero: 0, Negative: -1}}
            - {name: Byte, type: uint, bit_length: 8, enum: {Init: 0}}
`, 'coding.yaml');
  const coding = R.app.state.model.services.find((item) => item.label.startsWith('0x2E')).children[0];
  R.app.selectNode(coding);
  const findRow = (name) => [...document.querySelectorAll('#grid-req .gr')].find((row) =>
    row.querySelector('.name')?.textContent.trim() === name);
  for (const [name, bits, type] of [['Flag', '1', 'UINT'], ['Mode', '3', 'UINT'], ['Signed', '12', 'INT']]) {
    const row = findRow(name);
    check(row.querySelector('.bitfield-label')?.textContent === 'BITFIELD' &&
      row.querySelector('.bitfield-storage')?.textContent === type &&
      row.querySelector('.bits').textContent === bits, `${name} identifies bitfield width and numeric representation`);
    check(!!row.querySelector('.dd'), `${name} retains dropdown`);
  }
  check(findRow('Byte').querySelector('.datatype').textContent === 'UINT', 'Whole-byte enum remains UINT');
  check(R.pduText(R.app.state.svc.request[0]) === '2E 06 00 00 00 00', 'Presentation preserves bit packing');
  return { assertions, passed: true };
};
