// Preloaded into the real CLI (NODE_OPTIONS=--import). The bundle's DeclarativeTool constructor is
// spliced to call globalThis.__svProbe(this). At exit, each constructed tool's current parameter
// schema is judged by main's exact-JSON rule and by this PR's rule (both copied verbatim from
// schemaValidator.ts at d004e3ddf8 and f6c5829942), and whether it reaches the text at all.
import fs from 'node:fs';
const tools = [];
globalThis.__svProbe = (t) => tools.push(t);
const ruleMain = (value) => {
  switch (typeof value) {
    case 'string': case 'boolean': return true;
    case 'number': return Number.isFinite(value);
    case 'object': {
      if (value === null) return true;
      const array = Array.isArray(value); const prototype = Object.getPrototypeOf(value);
      return (array ? prototype === Array.prototype : prototype === Object.prototype || prototype === null) &&
        typeof value['toJSON'] !== 'function' && Reflect.ownKeys(value).length === Object.keys(value).length + (array ? 1 : 0);
    }
    default: return false;
  }
};
const rulePr = (value) => {
  switch (typeof value) {
    case 'string': case 'boolean': return true;
    case 'number': return Number.isFinite(value);
    case 'object': {
      if (value === null) return true;
      const array = Array.isArray(value); const prototype = Object.getPrototypeOf(value);
      return prototype === (array ? Array.prototype : Object.prototype) && typeof value['toJSON'] !== 'function' &&
        Reflect.ownKeys(value).length === (array ? value.length + 1 : Object.keys(value).length);
    }
    default: return false;
  }
};
const exact = (v, rule) => { try { JSON.stringify(v, function (k, c) { if (!rule(this[k])) throw new TypeError('x'); return c; }); return true; } catch { return false; } };
process.on('exit', () => {
  const seen = new Set(); const rows = [];
  for (const t of tools) {
    const s = t.parameterSchema;
    if (!process.env.SV_PROBE_ALL && seen.has(t.name)) continue; seen.add(t.name);
    rows.push({ hostProto: typeof s === 'object' && s !== null ? Object.getPrototypeOf(s) === Object.prototype : null, tool: t.name, isObject: typeof s === 'object' && s !== null, main: exact(s, ruleMain), pr: exact(s, rulePr) });
  }
  fs.writeFileSync(process.env.SV_PROBE_LOG, JSON.stringify({ pid: process.pid, constructed: tools.length, rows }, null, 1));
});
