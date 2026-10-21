/* Load into the app page, then runMessagesTests(). Synthetic AUTOSAR data only. */
window.runMessagesTests = () => {
  const R = window.RAL, $ = (id) => document.getElementById(id);
  let assertions = 0;
  const check = (condition, message) => { if (!condition) throw new Error(message); assertions++; };
  const wrap = (content) => `<AUTOSAR xmlns="http://autosar.org/schema/r4.0"><AR-PACKAGES>
    <AR-PACKAGE><SHORT-NAME>Demo</SHORT-NAME><ELEMENTS>${content}</ELEMENTS></AR-PACKAGE>
    </AR-PACKAGES></AUTOSAR>`;
  const ecu = (name, direction) => `<ECU-INSTANCE><SHORT-NAME>${name}</SHORT-NAME><CONNECTORS>
    <CAN-COMMUNICATION-CONNECTOR><SHORT-NAME>C</SHORT-NAME><ECU-COMM-PORT-INSTANCES>
      <FRAME-PORT><SHORT-NAME>F</SHORT-NAME><COMMUNICATION-DIRECTION>${direction}</COMMUNICATION-DIRECTION></FRAME-PORT>
      <I-PDU-PORT><SHORT-NAME>P</SHORT-NAME><COMMUNICATION-DIRECTION>${direction}</COMMUNICATION-DIRECTION></I-PDU-PORT>
    </ECU-COMM-PORT-INSTANCES></CAN-COMMUNICATION-CONNECTOR></CONNECTORS></ECU-INSTANCE>`;
  const portRef = (name, kind = 'FRAME') => `<${kind}-PORT-REF DEST="${kind}-PORT">/Demo/${name}/C/${kind === 'FRAME' ? 'F' : 'P'}</${kind}-PORT-REF>`;
  const triggering = (name, ports, id = '291') => `<CAN-FRAME-TRIGGERING><SHORT-NAME>${name}</SHORT-NAME>
    <FRAME-REF DEST="CAN-FRAME">/Demo/Status</FRAME-REF><IDENTIFIER>${id}</IDENTIFIER>
    <FRAME-PORT-REFS>${ports}</FRAME-PORT-REFS></CAN-FRAME-TRIGGERING>`;
  const channel = (name, contents) => `<CAN-PHYSICAL-CHANNEL><SHORT-NAME>${name}</SHORT-NAME>${contents}</CAN-PHYSICAL-CHANNEL>`;
  const network = wrap(`${ecu('Sender', 'OUT')}${ecu('Receiver', 'IN')}${ecu('Receiver2', 'IN')}${ecu('Unknown', 'INOUT')}
    <CAN-CLUSTER><SHORT-NAME>Bus</SHORT-NAME><PHYSICAL-CHANNELS>
    ${channel('A', `<COMMUNICATION-CONNECTOR-REF DEST="CAN-COMMUNICATION-CONNECTOR">/Demo/Receiver2/C</COMMUNICATION-CONNECTOR-REF>
      <FRAME-TRIGGERINGS>${triggering('T', portRef('Sender') + portRef('Receiver') + portRef('Receiver'))}
      </FRAME-TRIGGERINGS><PDU-TRIGGERINGS><PDU-TRIGGERING><SHORT-NAME>PT</SHORT-NAME>
      <I-PDU-REF DEST="I-SIGNAL-I-PDU">/Demo/Payload</I-PDU-REF>
      <I-PDU-PORT-REFS>${portRef('Receiver2', 'I-PDU')}</I-PDU-PORT-REFS>
      </PDU-TRIGGERING></PDU-TRIGGERINGS>`)}
    ${channel('B', `<FRAME-TRIGGERINGS>${triggering('T2', portRef('Receiver2'), '292')}</FRAME-TRIGGERINGS>`)}
    </PHYSICAL-CHANNELS></CAN-CLUSTER>`);
  const definitions = wrap(`<CAN-FRAME><SHORT-NAME>Status</SHORT-NAME><FRAME-LENGTH>8</FRAME-LENGTH>
    <PDU-TO-FRAME-MAPPINGS><PDU-TO-FRAME-MAPPING><SHORT-NAME>M</SHORT-NAME>
    <PDU-REF DEST="I-SIGNAL-I-PDU">/Demo/Payload</PDU-REF><START-POSITION>0</START-POSITION>
    </PDU-TO-FRAME-MAPPING></PDU-TO-FRAME-MAPPINGS></CAN-FRAME>
    <I-SIGNAL-I-PDU><SHORT-NAME>Payload</SHORT-NAME><LENGTH>8</LENGTH><I-SIGNAL-TO-PDU-MAPPINGS>
    <I-SIGNAL-TO-I-PDU-MAPPING><SHORT-NAME>M</SHORT-NAME><I-SIGNAL-REF DEST="I-SIGNAL">/Demo/Speed</I-SIGNAL-REF>
    </I-SIGNAL-TO-I-PDU-MAPPING></I-SIGNAL-TO-PDU-MAPPINGS></I-SIGNAL-I-PDU>
    <I-SIGNAL><SHORT-NAME>Speed</SHORT-NAME><LENGTH>16</LENGTH></I-SIGNAL>
    <LIN-FRAME><SHORT-NAME>Unmapped</SHORT-NAME><FRAME-LENGTH>4</FRAME-LENGTH></LIN-FRAME>`);
  const parse = (text = network, defs = definitions) => R.parseArxmlWorkspace(new Map([['network.arxml', text], ['definitions.arxml', defs]]));
  const model = parse(), rows = R.arxmlMessages(model);
  const frame = rows.find((row) => row.trigger?.name === 'T');
  const pdu = rows.find((row) => row.trigger?.name === 'PT');
  check(rows.length === 4, 'Keeps per-channel triggerings and untriggered definitions without duplicate definition rows');
  check(frame.endpoints.length === 2, 'Deduplicates repeated port references');
  check(frame.endpoints.find((item) => item.direction === 'OUT').ecu.name === 'Sender', 'OUT port identifies sender');
  check(frame.endpoints.find((item) => item.direction === 'IN').ecu.name === 'Receiver', 'IN port identifies receiver');
  check(!frame.endpoints.some((item) => item.ecu.name === 'Receiver2'), 'Channel connector membership does not imply receiver');
  check(frame.channel.name === 'A' && frame.network.name === 'Bus' && frame.identifier === '291' && frame.length === '8', 'Retains network, channel, identifier and byte length');
  check(frame.carried[0].target.name === 'Payload' && pdu.carried[0].target.name === 'Speed', 'Traces frame-to-PDU and PDU-to-signal mappings');
  check(frame.endpoints[0].ref.file === 'network.arxml' && frame.carried[0].file === 'definitions.arxml', 'Retains cross-file endpoint and mapping evidence');
  check(pdu.endpoints.length === 1 && pdu.endpoints[0].ecu.name === 'Receiver2' && pdu.findings.some((text) => text.startsWith('Sender unknown')), 'PDU endpoints come from PDU ports, not inferred from containing frame');
  check(rows.find((row) => row.name === 'Unmapped').findings.some((text) => text.includes('No resolved triggering')), 'Untriggered messages remain visible with unknown endpoints');
  const multi = R.arxmlMessages(parse(network.replace(portRef('Receiver'), portRef('Receiver') + portRef('Receiver2'))));
  check(multi.find((row) => row.trigger?.name === 'T').endpoints.filter((item) => item.direction === 'IN').length === 2, 'Supports multiple explicit receivers');
  const unknown = R.arxmlMessages(parse(network.replace(portRef('Sender'), portRef('Unknown')))).find((row) => row.trigger?.name === 'T');
  check(!unknown.endpoints.some((item) => item.direction === 'OUT') && unknown.findings.some((text) => text.includes('direction INOUT')), 'Unknown directions are not guessed');
  const missing = R.arxmlMessages(parse(network.replace(portRef('Sender'), portRef('Absent')))).find((row) => row.trigger?.name === 'T');
  check(missing.findings.some((text) => text.includes('missing: /Demo/Absent/C/F')), 'Missing endpoint references are surfaced');
  const wrong = R.arxmlMessages(parse(network.replace('DEST="FRAME-PORT"', 'DEST="I-PDU-PORT"'))).find((row) => row.trigger?.name === 'T');
  check(wrong.findings.some((text) => text.includes('type mismatch')) && !wrong.endpoints.some((item) => item.direction === 'OUT'), 'Wrong DEST cannot produce sender');
  const wrongPort = R.arxmlMessages(parse(network.replace(portRef('Sender'), portRef('Sender', 'I-PDU')))).find((row) => row.trigger?.name === 'T');
  check(wrongPort.findings.some((text) => text.includes('Unsupported endpoint type')) && !wrongPort.endpoints.some((item) => item.direction === 'OUT'), 'Frame triggering cannot use PDU port as frame endpoint');
  const wrongMessage = R.arxmlMessages(parse(network.replaceAll('<FRAME-REF DEST="CAN-FRAME">/Demo/Status', '<FRAME-REF>/Demo/Speed')));
  check(wrongMessage.some((row) => !row.message && row.findings.some((text) => text.includes('Unsupported message target type'))), 'Missing DEST does not let a signal masquerade as a frame');
  const noReference = R.arxmlMessages(parse(network.replaceAll('<FRAME-REF DEST="CAN-FRAME">/Demo/Status</FRAME-REF>', '')));
  check(noReference.some((row) => row.trigger?.name === 'T' && row.findings.some((text) => text.includes('No absolute frame/PDU reference'))), 'Incomplete triggerings remain visible with explicit finding');
  const noFrame = R.arxmlMessages(parse(network.replaceAll('/Demo/Status</FRAME-REF>', '/Demo/Missing</FRAME-REF>')));
  check(noFrame.some((row) => !row.message && row.path === '/Demo/Missing' && row.findings.some((text) => text.includes('missing'))), 'Missing message target still produces triggering row');
  const conflicting = R.parseArxmlWorkspace(new Map([['network.arxml', network], ['definitions.arxml', definitions],
    ['conflict.arxml', wrap(ecu('Sender', 'IN'))]]));
  const ambiguous = R.arxmlMessages(conflicting).find((row) => row.trigger?.name === 'T');
  check(!ambiguous.endpoints.some((item) => item.ecu.name === 'Sender') && ambiguous.findings.some((text) => text.includes('conflict') || text.includes('Conflicting')), 'Conflicting port is withheld');
  const namespace = R.parseArxmlWorkspace(new Map([['network.arxml', network], ['definitions.arxml', definitions.replace('schema/r4.0', 'schema/r3.0')]]));
  check(R.arxmlMessages(namespace).every((row) => row.endpoints.length === 0), 'Conflicting package ancestry cannot leak endpoint claims');
  const unsafeParent = R.parseArxmlWorkspace(new Map([['network.arxml', network], ['definitions.arxml', definitions],
    ['conflict.arxml', wrap(ecu('Sender', 'OUT').replace('<CONNECTORS>', '<DESC>different ECU definition</DESC><CONNECTORS>'))]]));
  check(R.arxmlMessages(unsafeParent).find((row) => row.trigger?.name === 'T').findings.some((text) => text.includes('Conflicting endpoint ancestry')), 'Identical port under conflicting ECU is withheld');

  R.showArxml(model, 'Messages fixture');
  $('arxml-messages').click();
  check(!$('arxml-messages-panel').hidden && document.querySelector('.arxml-layout').hidden && $('arxml-messages').getAttribute('aria-pressed') === 'true', 'Messages is a separate active view');
  check($('arxml-message-list').textContent.includes('Configured communication only') && $('arxml-message-list').textContent.includes('Source evidence'), 'Shows limitations and inspectable evidence');
  check(document.querySelectorAll('.arxml-messages-table tr').length === 5, 'Renders message matrix');
  $('arxml-message-ecu').value = '/Demo/Receiver2';
  $('arxml-message-ecu').dispatchEvent(new Event('change'));
  check($('arxml-message-count').textContent.startsWith('2 of 2'), 'Filters by participating ECU');
  $('arxml-message-direction').value = 'OUT';
  $('arxml-message-direction').dispatchEvent(new Event('change'));
  check($('arxml-message-count').textContent.startsWith('0 of 0'), 'Direction is scoped to selected ECU, not another endpoint');
  $('arxml-message-ecu').value = '/Demo/Sender';
  $('arxml-message-ecu').dispatchEvent(new Event('change'));
  check($('arxml-message-count').textContent.startsWith('1 of 1'), 'Sending ECU filter matches correct row');
  R.filterArxml('unmapped');
  check($('arxml-message-count').textContent.startsWith('0 of 0'), 'Text and endpoint filters combine');
  $('arxml-message-ecu').value = ''; $('arxml-message-direction').value = '';
  $('arxml-message-ecu').dispatchEvent(new Event('change'));
  check($('arxml-message-count').textContent.startsWith('1 of 1'), 'Search includes untriggered messages');
  R.filterArxml('/Demo/Sender');
  check($('arxml-message-count').textContent.startsWith('1 of 1'), 'Search includes ECU paths');
  R.filterArxml('Sender unknown');
  check($('arxml-message-count').textContent.startsWith('3 of 3'), 'Search includes explicit unknown-sender findings');
  R.filterArxml('291');
  document.querySelector('.arxml-messages-table td button').click();
  check($('arxml-messages-panel').hidden && $('arxml-selected').textContent === '/Demo/Status' && $('arxml-communication').getAttribute('aria-pressed') === 'true', 'Message links open existing communication details');
  const many = R.parseArxml(wrap(Array.from({ length: 205 }, (_, i) => `<CAN-FRAME><SHORT-NAME>F${i}</SHORT-NAME></CAN-FRAME>`).join('')));
  R.showArxml(many, 'Many messages'); $('arxml-messages').click();
  check(document.querySelectorAll('.arxml-messages-table tr').length === 201, 'Pages message rows at 200');
  [...$('arxml-message-list').querySelectorAll('button')].find((node) => node.textContent === 'Show more messages').click();
  check(document.querySelectorAll('.arxml-messages-table tr').length === 206, 'Shows next message page');
  R.showArxml(R.parseArxml(wrap('<I-SIGNAL><SHORT-NAME>OnlySignal</SHORT-NAME></I-SIGNAL>')), 'No messages');
  $('arxml-messages').click();
  check($('arxml-message-list').textContent.includes('No matching messages') && $('arxml-message-ecu').options.length === 1, 'New workspace clears cache and ECU filters; empty state explains supported data');
  R.showArxml(model, 'Messages fixture'); $('arxml-messages').click();
  return { assertions, passed: true };
};
