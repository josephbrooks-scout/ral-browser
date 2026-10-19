const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const context = vm.createContext({});
context.window = context;
vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/codec.js'), 'utf8'), context);
const R = context.RAL;
const message = (children) => ({ kind: 'root', message: true, children });
const num = (bits, raw = 0n, extra = {}) => ({ kind: 'num', name: 'Data', bits, raw, scale: 1, offset: 0, ...extra });
const header = () => ({ kind: 'const', name: 'SID', bits: 8, raw: 0x62n });

test('decodes complete response and updates enum and physical values', () => {
  const value = num(8, 0n, { kind: 'enum', enumList: [{ value: 1n, text: 'Active' }] });
  const scaled = num(8, 0n, { scale: 0.5, offset: -10 });
  const did = { kind: 'match', name: 'DID', bits: 16, src: num(16, 0x012fn) };
  const root = message([header(), did, value, scaled]);
  assert.equal(R.applyPdu(root, '62 01 2F 01 20').length, 2);
  assert.equal(R.valueText(value), 'Active');
  assert.equal(R.valueText(scaled), '6.0');
  assert.equal(R.pduText(root), '62 01 2F 01 20');
  assert.equal(R.applyPdu(root, '62012f0120').length, 0);
});

test('rejects invalid hex, lengths, fixed headers and nonzero padding atomically', () => {
  const value = num(8);
  const root = message([value, header()]);
  for (const text of ['01 63', '01', '01 62 00', 'GG', '0', '0x0162']) {
    assert.throws(() => R.applyPdu(root, text));
    assert.equal(value.raw, 0n);
  }
  const bits = num(3);
  assert.throws(() => R.applyPdu(message([bits]), 'FF'), /padding/);
  assert.equal(bits.raw, 0n);
});

test('decodes signed little endian, unaligned bitfields, strings and large integers', () => {
  const signed = num(16, 0n, { signed: true, endianness: 'little' });
  const a = num(3), b = num(5);
  const text = { kind: 'string', bits: 16, text: '', name: 'ASCII' };
  const large = num(64);
  const root = message([signed, a, b, text, large]);
  R.applyPdu(root, 'FE FF B1 41 00 FF FF FF FF FF FF FF FE');
  assert.equal(signed.raw, -2n);
  assert.equal(a.raw, 5n);
  assert.equal(b.raw, 17n);
  assert.equal(text.text, 'A\0');
  assert.equal(large.raw, 0xfffffffffffffffen);
  assert.equal(R.pduText(root), 'FE FF B1 41 00 FF FF FF FF FF FF FF FE');
});

test('preserves linked display-only rows and handles reserved and unknown enums', () => {
  const value = num(8, 0n, { kind: 'enum', enumList: [{ value: 0n, text: 'Init' }] });
  const alias = { kind: 'match', src: value, noPdu: true, bits: 8 };
  const reserved = num(8, 0n, { kind: 'reserved' });
  const root = message([value, alias, reserved]);
  R.applyPdu(root, 'EE AB');
  assert.equal(R.valueText(value), '0xEE');
  assert.equal(R.valueText(alias), '0xEE');
  assert.equal(reserved.raw, 0xabn);
});

test('fails explicitly for ambiguous arrays and non-sequential layouts', () => {
  const value = num(8);
  const array = { kind: 'struct', repeat: 2, children: [value], spec: { size_type: 'fixed_size' } };
  assert.throws(() => R.applyPdu(message([array]), '01 02'), /independently/);
  assert.equal(value.raw, 0n);
  R.applyPdu(message([array]), '02 02');
  assert.equal(value.raw, 2n);
  array.spec.size_type = 'variable_size';
  assert.throws(() => R.applyPdu(message([array]), '02 02'), /variable-length/);
  assert.throws(() => R.applyPdu(message([num(8, 0n, { spec: { start_bit: 8 } })]), '01'), /start_bit/);
});
