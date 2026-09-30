const fs = require('fs');
const load = (f) => JSON.parse(fs.readFileSync(f, 'utf8').split('\n').filter((l) => l.startsWith('RESULT ')).at(-1).replace(/^RESULT \S+ /, ''));
const norm = (v) => JSON.stringify(v).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>').replace(/mcp_[0-9a-f]{32}/g, 'mcp_<h>').replace(/[0-9a-f]{64}/g, '<sha>').replace(/mcp<id>[0-9a-f]+/g, 'mcp<id>').replace(/stdio-\d+/g, 'stdio-N').replace(/"ms":\d+/g, '"ms":N').replace(/\d{13}/g, '<t>');
const [a, b] = process.argv.slice(2).map(load);
const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
let same = 0; const diff = [];
for (const k of keys) { if (norm(a[k]) === norm(b[k])) same++; else diff.push(k); }
console.log(`keys=${keys.length} same=${same} differing=${diff.join(',') || 'none'}`);
for (const k of diff) console.log(`  ${k}\n    A: ${norm(a[k])?.slice(0, 500)}\n    B: ${norm(b[k])?.slice(0, 500)}`);
