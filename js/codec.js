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
