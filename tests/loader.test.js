const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const context = vm.createContext({});
context.window = context;
for (const file of ['vendor/js-yaml.min.js', 'js/codec.js', 'js/model.js', 'js/loader.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
}
const R = context.RAL;
const main = `includes:
  - !include fixture.diag.ral
ecus:
  fixture:
    diagnostics:
      routine_controls:
        demo:
          routine:
            id: 0x1234
            start: {inputs: [], outputs: []}
      dids:
        demo:
          did: {id: 0x2345, RDBI: {}, values: []}
      dtcs:
        demo: {dtc: !ref dtc_definitions.demo}
      monitors:
        demo: {dtc: !ref dtc_definitions.demo}
`;
const companion = 'dtc_definitions:\n  demo:\n    domain: body\n    metadata: {code: 0x123456}\n';
const bundle = () => new Map([['fixture.ral', main], ['fixture.diag.ral', companion]]);

test('selects the main file regardless of selection order and resolves include/ref', () => {
  const sources = new Map([...bundle()].reverse());
  assert.equal(R.ralRootName(sources), 'fixture.ral');
  const doc = R.parseRal(main, 'fixture.ral', sources);
  assert.equal(doc.ecus.fixture.diagnostics.dtcs.demo.dtc.metadata.code, 0x123456);
  assert.equal(doc.ecus.fixture.diagnostics.monitors.demo.dtc.domain, 'body');
  const model = R.buildEcu('fixture', doc.ecus.fixture);
  const dtc = model.services.find((f) => f.label.startsWith('0x19')).children[0];
  assert.equal(R.pduText(dtc.build().request[0]), '19 06 12 34 56 FF');
  const did = model.services.find((f) => f.label.startsWith('0x22')).children[0];
  assert.equal(R.pduText(did.build().request[0]), '22 23 45');
  const rt = model.services.find((f) => f.label.startsWith('0x31')).children[0];
  assert.equal(R.pduText(rt.build().request[0]), '31 01 12 34');
});

test('self-contained flat and nested layouts still load', () => {
  for (const [did, routine] of [
    ['{id: 0x2345, RDBI: {}, values: []}', '{id: 0x1234, start: {}}'],
    ['{did: {id: 0x2345, RDBI: {}, values: []}}', '{routine: {id: 0x1234, start: {}}}'],
  ]) {
    const text = `ecus:\n  fixture:\n    diagnostics:\n      dids:\n        demo: ${did}\n      routine_controls:\n        demo: ${routine}\n`;
    const sources = new Map([['single.ral', text]]);
    assert.equal(R.ralRootName(sources), 'single.ral');
    const doc = R.parseRal(text, 'single.ral');
    const model = R.buildEcu('fixture', doc.ecus.fixture);
    assert.equal(model.summary['Readable DIDs'], 1);
    assert.equal(model.services.find((f) => f.label.startsWith('0x31')).children.length, 1);
  }
});

test('missing companions and broken references fail explicitly', () => {
  assert.throws(() => R.parseRal(main, 'fixture.ral'), /Missing companion file "fixture.diag.ral"/);
  const sources = bundle();
  sources.set('fixture.diag.ral', 'dtc_definitions: {}');
  assert.throws(() => R.parseRal(main, 'fixture.ral', sources), /Unresolved !ref "dtc_definitions.demo"/);
});

test('nested relative includes merge with local values taking precedence', () => {
  const sources = new Map([
    ['main.ral', 'includes: [!include sub/one.ral]\nvalue: {local: 2}\n'],
    ['sub/one.ral', 'includes: [!include two.ral]\nvalue: {inherited: 1}\n'],
    ['sub/two.ral', 'value: {local: 0, deep: 3}\n'],
  ]);
  const doc = R.parseRal(sources.get('main.ral'), 'main.ral', sources);
  assert.equal(JSON.stringify(doc.value), '{"local":2,"deep":3,"inherited":1}');
});

test('cycles, ambiguous includes and unsupported tags fail explicitly', () => {
  const sources = new Map([
    ['a.ral', 'includes: [!include b.ral]'],
    ['b.ral', 'includes: [!include a.ral]'],
  ]);
  assert.throws(() => R.parseRal(sources.get('a.ral'), 'a.ral', sources), /Circular !include/);
  assert.throws(() => R.parseRal('x: !ref y\ny: !ref x', 'cycle.ral'), /Circular !ref/);
  assert.throws(() => R.parseRal('x: &x {self: *x}', 'cycle.ral'), /Circular YAML alias/);
  assert.throws(() => R.parseRal('x: !unsupported value', 'bad.ral'), /unknown tag/);
  sources.set('a.ral', 'includes: [!include definitions.ral]');
  sources.set('one/definitions.ral', '{}');
  sources.set('two/definitions.ral', '{}');
  assert.throws(() => R.parseRal(sources.get('a.ral'), 'a.ral', sources), /Ambiguous include/);
});

test('multiple main exports and empty ECU maps are rejected', () => {
  assert.throws(() => R.ralRootName(new Map([['a', main], ['b', main]])), /one main RAL/);
  assert.throws(() => R.ralRootName(new Map([['a', 'ecus: {}']])), /No main RAL/);
});

test('references cannot resolve inherited object properties', () => {
  assert.throws(() => R.parseRal('x: !ref constructor.prototype', 'bad.ral'), /Unresolved !ref/);
  const doc = R.parseRal('__proto__: {polluted: true}\nx: !ref __proto__.polluted', 'safe.ral');
  assert.equal(doc.x, true);
  assert.equal({}.polluted, undefined);
});

test('routines have one alphabetical tree entry and only supported operations', () => {
  const model = R.buildEcu('example', { diagnostics: { routine_controls: {
    zebra: { id: 0x1001, start: {}, stop: {}, request_results: {} },
    alpha: { routine: { id: 0x1002, request_results: {} } },
  } } });
  const routines = model.services.find((f) => f.label.startsWith('0x31')).children;
  assert.equal(routines.length, 2);
  assert.equal(routines[0].label, 'Alpha (0x1002)');
  assert.equal(routines[1].label, 'Zebra (0x1001)');
  assert.equal(routines[0].operations.map((op) => op.key).join(','), 'request_results');
  assert.equal(routines[1].operations.map((op) => op.label).join(','), 'Start,Stop,Request Results');
  assert.equal(R.pduText(routines[0].build().request[0]), '31 03 10 02');
  for (const [index, op] of routines[1].operations.entries()) {
    const svc = op.build();
    assert.equal(R.pduText(svc.request[0]), `31 0${index + 1} 10 01`);
    assert.equal(R.pduText(svc.responses[0]), `71 0${index + 1} 10 01`);
  }
});
