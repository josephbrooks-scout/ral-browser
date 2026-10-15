/* Parse self-contained RAL and local !include / !ref bundles without network access. */
(function () {
  const R = window.RAL;
  class Include {
    constructor(path) { this.path = path; }
  }
  class Ref {
    constructor(path) { this.path = path; }
  }
  const schema = jsyaml.DEFAULT_SCHEMA.extend([
    new jsyaml.Type('!include', { kind: 'scalar', construct: (path) => new Include(path) }),
    new jsyaml.Type('!ref', { kind: 'scalar', construct: (path) => new Ref(path) }),
  ]);
  const mapping = (x) => x !== null && typeof x === 'object' && !Array.isArray(x) &&
    !(x instanceof Include) && !(x instanceof Ref);
  const own = (x, key) => x !== null && typeof x === 'object' && Object.hasOwn(x, key);
  const put = (obj, key, value) => Object.defineProperty(obj, key, {
    value, enumerable: true, configurable: true, writable: true,
  });

  function merge(base, extra) {
    const out = Object.create(null);
    for (const [key, value] of Object.entries(base)) put(out, key, value);
    for (const [key, value] of Object.entries(extra)) {
      put(out, key, own(out, key) && mapping(out[key]) && mapping(value) ? merge(out[key], value) : value);
    }
    return out;
  }

  function normalize(path) {
    if (typeof path !== 'string' || !path.trim()) throw new Error('Empty RAL include path');
    const parts = [];
    for (const part of path.replace(/\\/g, '/').split('/')) {
      if (!part || part === '.') continue;
      if (part === '..') parts.pop();
      else parts.push(part);
    }
    return parts.join('/');
  }

  R.parseRal = (text, name, sources = new Map([[name, text]])) => {
    const files = new Map();
    for (const [path, source] of sources) files.set(normalize(path), source);
    files.set(normalize(name), text);
    const cache = new Map(), loading = new Set();

    function findFile(path, from) {
      const relative = normalize(from.split('/').slice(0, -1).concat(path).join('/'));
      if (files.has(relative)) return relative;
      const basename = normalize(path).split('/').pop();
      const matches = [...files.keys()].filter((key) => key.split('/').pop() === basename);
      if (matches.length === 1) return matches[0];
      if (matches.length > 1) throw new Error(`Ambiguous include "${path}" in "${from}". Select files with unique names.`);
      throw new Error(`Missing companion file "${path}" (included by "${from}"). Select the main RAL and all companion files together using Open, or drag them in together.`);
    }

    function expand(value, from, active = new Set()) {
      if (value instanceof Include) return read(findFile(value.path, from));
      if (value instanceof Ref || value === null || typeof value !== 'object') return value;
      if (active.has(value)) throw new Error(`Circular YAML alias in "${from}"`);
      active.add(value);
      let result;
      if (Array.isArray(value)) result = value.map((item) => expand(item, from, active));
      else {
        let included = Object.create(null);
        if (own(value, 'includes')) {
          if (!Array.isArray(value.includes) || !value.includes.every((item) => item instanceof Include)) {
            throw new Error(`"includes" in "${from}" must be a list of !include paths`);
          }
          for (const item of value.includes) {
            const doc = expand(item, from, active);
            if (!mapping(doc)) throw new Error(`Included file "${item.path}" must contain a YAML mapping`);
            included = merge(included, doc);
          }
        }
        const local = Object.create(null);
        for (const [key, item] of Object.entries(value)) {
          if (key !== 'includes') put(local, key, expand(item, from, active));
        }
        result = merge(included, local);
      }
      active.delete(value);
      return result;
    }

    function read(path) {
      if (loading.has(path)) throw new Error(`Circular !include involving "${path}"`);
      if (cache.has(path)) return cache.get(path);
      loading.add(path);
      const doc = expand(jsyaml.load(files.get(path), { schema, filename: path }), path);
      loading.delete(path);
      cache.set(path, doc);
      return doc;
    }

    const doc = read(normalize(name));
    const resolved = new WeakMap(), resolving = new Set();
    function resolve(value) {
      if (value === null || typeof value !== 'object') return value;
      if (resolving.has(value)) throw new Error('Circular !ref in RAL data');
      if (resolved.has(value)) return resolved.get(value);
      resolving.add(value);
      let out;
      if (value instanceof Ref) {
        if (typeof value.path !== 'string' || !value.path) throw new Error('Empty RAL !ref path');
        let target = doc;
        for (const key of value.path.split('.')) {
          if (!own(target, key)) throw new Error(`Unresolved !ref "${value.path}". Check that all companion files were selected.`);
          target = target[key];
        }
        out = resolve(target);
      } else if (Array.isArray(value)) out = value.map(resolve);
      else {
        out = Object.create(null);
        for (const [key, item] of Object.entries(value)) put(out, key, resolve(item));
      }
      resolving.delete(value);
      resolved.set(value, out);
      return out;
    }
    return resolve(doc);
  };

  R.ralRootName = (sources) => {
    const roots = [...sources].filter(([name, text]) => {
      const doc = jsyaml.load(text, { schema, filename: name });
      return mapping(doc) && mapping(doc.ecus) && Object.keys(doc.ecus).length > 0;
    }).map(([name]) => name);
    if (roots.length !== 1) throw new Error(roots.length
      ? 'Select one main RAL file plus its companions, not multiple ECU exports.'
      : 'No main RAL file found: select a file with a non-empty "ecus" mapping plus its companions.');
    return roots[0];
  };
})();
