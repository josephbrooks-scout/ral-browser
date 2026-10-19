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
  return { assertions, passed: true };
};
