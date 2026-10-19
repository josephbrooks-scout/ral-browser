/* Value formatting, parsing and PDU bit packing for RAL parameters. */
(function () {
  const R = (window.RAL = window.RAL || {});

  const big = (v) => {
    if (typeof v === 'bigint') return v;
    if (v === null || v === undefined || v === '') return 0n;
    if (typeof v === 'string' && /^0x[0-9a-f]+$/i.test(v.trim())) return BigInt(v.trim());
    const n = Number(v);
    return Number.isFinite(n) ? BigInt(Math.round(n)) : 0n;
  };

  const hex = (v, bits = 8) => {
    const digits = Math.max(2, Math.ceil(bits / 4));
    return '0x' + big(v).toString(16).toUpperCase().padStart(digits, '0');
  };

  const bytesHex = (bytes) =>
    bytes.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');

  const decimals = (n) => {
    const s = String(n);
    if (/e-/i.test(s)) return Number(s.split(/e-/i)[1]);
    return (s.split('.')[1] || '').length;
  };

  class BitWriter {
    constructor() { this.bits = []; }
    write(v, n) {
      v = big(v) & ((1n << BigInt(n)) - 1n);
      for (let i = n - 1; i >= 0; i--) this.bits.push(Number((v >> BigInt(i)) & 1n));
    }
    writeBytes(arr) { arr.forEach((b) => this.write(b, 8)); }
    bytes() {
      const out = [];
      for (let i = 0; i < this.bits.length; i += 8) {
        let b = 0;
        for (let j = 0; j < 8; j++) b = (b << 1) | (this.bits[i + j] || 0);
        out.push(b);
      }
      return out;
    }
  }

  const rawOf = (row) => (row.src ? rawOf(row.src) : row.raw);
  const masked = (raw, bits) => big(raw) & ((1n << BigInt(bits)) - 1n);

  function stringBytes(row) {
    const len = Math.ceil(row.bits / 8);
    const out = [];
    for (let i = 0; i < len; i++) {
      const c = i < row.text.length ? row.text.charCodeAt(i) : 0x20;
      out.push(c & 0xff);
    }
    return out;
  }

  function fieldBytesBE(raw, bits) {
    const n = Math.ceil(bits / 8);
    const out = [];
    for (let i = n - 1; i >= 0; i--) out.push(Number((raw >> BigInt(i * 8)) & 0xffn));
    return out;
  }

  function encodeField(row, w) {
    if (row.kind === 'string') return w.writeBytes(stringBytes(row));
    const raw = masked(rawOf(row), row.bits);
    if (row.endianness === 'little' && row.bits % 8 === 0 && row.bits > 8) {
      return w.writeBytes(fieldBytesBE(raw, row.bits).reverse());
    }
    w.write(raw, row.bits);
  }

  function encodeRows(rows, w) {
    for (const r of rows || []) {
      if (r.kind === 'struct') { for (let i = 0; i < (r.repeat ?? 1); i++) encodeRows(r.children, w); continue; }
      if (!r.bits || r.kind === 'info' || r.noPdu) continue;
      encodeField(r, w);
    }
    return w;
  }

  R.encode = (rows) => encodeRows(rows, new BitWriter()).bytes();

  R.applyPdu = (root, input) => {
    if (root.kind !== 'root' || !root.message) throw new Error('Select a complete diagnostic message.');
    const text = String(input).trim();
    if (!/^(?:[0-9a-f]{2}\s*)+$/i.test(text)) throw new Error('Enter complete hexadecimal bytes, for example 62 01 2F 00.');
    const bytes = text.replace(/\s/g, '').match(/../g).map((byte) => parseInt(byte, 16));
    const fields = [];
    function collect(rows) {
      let nextBit = 0;
      for (const row of rows || []) {
        if (row.spec) {
          if (row.spec.start_bit !== undefined && Number(row.spec.start_bit) !== nextBit) {
            throw new Error(`${row.name}: non-sequential start_bit layout cannot be decoded safely.`);
          }
          nextBit += row.bits || 0;
        }
        if (row.kind === 'struct') {
          if (row.spec && row.spec.size_type !== 'fixed_size') throw new Error('Decoding variable-length arrays is not supported.');
          for (let i = 0; i < (row.repeat ?? 1); i++) collect(row.children);
        } else if (row.bits && row.kind !== 'info' && !row.noPdu) fields.push(row);
      }
    }
    collect(root.children);
    const bits = fields.reduce((sum, row) => sum + (row.kind === 'string' ? Math.ceil(row.bits / 8) * 8 : row.bits), 0);
    if (bytes.length !== Math.ceil(bits / 8)) throw new Error(`Expected ${Math.ceil(bits / 8)} bytes; received ${bytes.length}.`);
    let position = 0;
    const read = (count) => {
      let value = 0n;
      for (let i = 0; i < count; i++, position++) {
        value = (value << 1n) | BigInt((bytes[position >> 3] >> (7 - position % 8)) & 1);
      }
      return value;
    };
    const updates = new Map();
    for (const row of fields) {
      let update;
      if (row.kind === 'string') {
        let value = '';
        for (let i = 0; i < Math.ceil(row.bits / 8); i++) value += String.fromCharCode(Number(read(8)));
        update = { text: value };
      } else {
        let raw;
        if (row.endianness === 'little' && row.bits % 8 === 0 && row.bits > 8) {
          raw = 0n;
          for (let i = 0; i < row.bits / 8; i++) raw |= read(8) << BigInt(i * 8);
        } else raw = read(row.bits);
        if (row.kind === 'const' || row.kind === 'match' || row.fixedPdu) {
          if (raw !== masked(rawOf(row), row.bits)) throw new Error(`${row.name} is fixed; expected ${hex(masked(rawOf(row), row.bits), row.bits)}.`);
          continue;
        }
        if (row.signed && raw >= (1n << BigInt(row.bits - 1))) raw -= 1n << BigInt(row.bits);
        update = { raw };
      }
      const previous = updates.get(row);
      if (previous && (previous.raw !== update.raw || previous.text !== update.text)) {
        throw new Error('Repeated array items have different values; this layout cannot represent them independently.');
      }
      updates.set(row, update);
    }
    if (bits % 8 && read(8 - bits % 8) !== 0n) throw new Error('Unused trailing padding bits must be zero.');
    const changed = [];
    for (const [row, update] of updates) {
      if (('raw' in update && row.raw !== update.raw) || ('text' in update && row.text !== update.text)) changed.push(row);
    }
    for (const [row, update] of updates) Object.assign(row, update, { negated: false });
    return changed;
  };

  R.pduText = (row) => {
    switch (row.kind) {
      case 'root': return row.children && row.message ? bytesHex(R.encode(row.children)) : '';
      case 'string': {
        const s = bytesHex(stringBytes(row));
        return s.length > 35 ? s.slice(0, 35) + '…' : s;
      }
      case 'info': case 'struct': case 'group': return '';
      default: return row.bits && !row.noPdu ? hex(masked(rawOf(row), row.bits), row.bits) : '';
    }
  };

  const enumText = (row, raw) => {
    const e = row.enumList && row.enumList.find((x) => x.value === raw);
    return e ? e.text : null;
  };

  R.valueText = (row) => {
    const raw = row.kind === 'string' || row.kind === 'info' ? null : rawOf(row);
    switch (row.kind) {
      case 'const': case 'match': return hex(raw, row.bits);
      case 'enum': {
        const t = enumText(row, raw);
        return (row.negated ? '≠ ' : '') + (t !== null ? t : hex(raw, row.bits));
      }
      case 'num': {
        const t = enumText(row, raw);
        if (t !== null) return (row.negated ? '≠ ' : '') + t;
        if (row.scale === 1 && row.offset === 0) return raw.toString();
        const v = Number(raw) * row.scale + row.offset;
        return v.toFixed(Math.max(decimals(row.scale), decimals(row.offset)));
      }
      case 'bytes': return hex(raw, row.bits);
      case 'string': return row.text;
      case 'info': return row.value === undefined || row.value === null ? '' : String(row.value);
      default: return '';
    }
  };

  /* Parse user input for an editable row; returns {raw} / {text} or throws Error. */
  R.parseInput = (row, input) => {
    const s = String(input).trim();
    const maxRaw = row.signed ? (1n << BigInt(row.bits - 1)) - 1n : (1n << BigInt(row.bits)) - 1n;
    const minRaw = row.signed ? -(1n << BigInt(row.bits - 1)) : 0n;
    if (row.kind === 'string') {
      const len = Math.ceil(row.bits / 8);
      if (s.length > len) throw new Error(`Max ${len} characters`);
      return { text: s };
    }
    const e = row.enumList && row.enumList.find((x) => x.text.toLowerCase() === s.toLowerCase());
    if (e) return { raw: e.value };
    let raw;
    if (/^0x[0-9a-f]+$/i.test(s)) {
      raw = BigInt(s);
      if (row.signed && raw > maxRaw && raw < (1n << BigInt(row.bits))) raw -= 1n << BigInt(row.bits);
    }
    else if (row.kind === 'bytes' && /^[0-9a-f\s]+$/i.test(s) && /[a-f\s]/i.test(s)) raw = BigInt('0x' + s.replace(/\s/g, ''));
    else {
      const v = Number(s);
      if (s === '' || !Number.isFinite(v)) throw new Error(`"${s}" is not a valid value`);
      const scale = row.scale ?? 1, offset = row.offset ?? 0;
      raw = BigInt(Math.round((v - offset) / scale));
    }
    if (raw < minRaw || raw > maxRaw) throw new Error(`Raw value ${raw} out of range ${minRaw}..${maxRaw} (${row.bits} bit)`);
    return { raw };
  };

  R.outOfRange = (row) => {
    if (row.kind !== 'num' || enumText(row, row.raw) !== null) return false;
    const r = Number(row.raw);
    return (row.min !== undefined && r < row.min) || (row.max !== undefined && r > row.max);
  };

  Object.assign(R, { big, hex, bytesHex, decimals, rawOf });
})();
