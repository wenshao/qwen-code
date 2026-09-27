// BFS over esbuild metafile inputs (static imports only) from the serve
// entry to each forbidden module; prints the shortest static import chain.
import fs from 'node:fs';
const meta = JSON.parse(fs.readFileSync('dist/esbuild.json', 'utf8'));
const inputs = meta.inputs;
const start = Object.keys(inputs).find((k) => k.endsWith(process.env.ROOT ?? 'packages/cli/src/serve/run-qwen-serve.ts'));
const targets = ['packages/cli/src/serve/acp-session-bridge.ts', 'packages/core/src/tools/shell.ts', 'packages/acp-bridge/src/bridge.ts'];
const prev = new Map([[start, null]]);
const q = [start];
while (q.length) {
  const cur = q.shift();
  for (const imp of inputs[cur]?.imports ?? []) {
    if (imp.kind !== 'import-statement' || imp.external) continue;
    if (!prev.has(imp.path)) { prev.set(imp.path, cur); q.push(imp.path); }
  }
}
for (const t of targets) {
  const key = Object.keys(inputs).find((k) => k.endsWith(t));
  if (!prev.has(key)) { console.log(`${t}: not statically reachable from server.ts`); continue; }
  const chain = [];
  for (let c = key; c; c = prev.get(c)) chain.unshift(c.replace(/^.*?packages\//, 'packages/'));
  console.log(`${t}:\n  ` + chain.join('\n  -> '));
}
