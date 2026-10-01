// Builds results/it-summary.json from the IT logs and the shim observation logs.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
const SP = path.dirname(new URL(import.meta.url).pathname);
const R = (f) => path.join(SP, 'results', f);
const tests = (f) => {
  const m = [...readFileSync(R(f), 'utf8').matchAll(/Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)(?:, Time elapsed: ([\d.]+) s)? .*in com\.alibaba\.qwen\.code\.managedagent\.HostedPublicWorkspaceIT/g)].at(-1);
  if (!m) throw new Error('no summary in ' + f);
  const [run, fail, err] = [m[1], m[2], m[3]].map(Number);
  return { pass: fail + err === 0 && run > 0, tests: `${run - fail - err}/${run} passed (${m[5]} s)` };
};
const rejections = (f) => existsSync(R(f)) ? readFileSync(R(f), 'utf8').trim().split('\n').map((l) => JSON.parse(l)).filter((x) => x.url === '/session' && x.status >= 400) : [];
const turnFailed = (f) => [...new Set([...readFileSync(R(f), 'utf8').matchAll(/status=FAILED, error_code=([a-z_]+)\}\]/g)].map((m) => m[1]))];
const modelZero = (f) => /model requests: 0;/.test(readFileSync(R(f), 'utf8'));
const ok = '4 Workspace file turns (REST + WebShell, 2 tests) COMPLETED through the Broker; IT asserts 3 tool executions per turn and child/proof.txt = "after" inside the mount';
const arms = [];
for (const [tree, dir, prefix, rej] of [['PR head 1e1f1970b3', 'wt-pr', 'it-pr', 'harness-4xx.log'], ['PR head ⊕ main 0a5f518b4f', 'wt-merge', 'it-merge', 'harness-4xx-merge.log']]) {
  if (!existsSync(R(`${prefix}-positive.log`))) continue;
  arms.push({ tree, entry: `${dir}/dist/cli.js (flags as in the IT)`, ...tests(`${prefix}-positive.log`), observed: ok });
  arms.push({ tree, entry: 'pass-through shim (control)', ...tests(`${prefix}-passthrough.log`), observed: 'same as above; shim itself is inert' });
  const r = rejections(rej);
  const t = turnFailed(`${prefix}-no-broker.log`);
  arms.push({ tree, entry: 'shim drops only the 2 Broker flags', ...tests(`${prefix}-no-broker.log`),
    observed: `Harness answers POST /session ${[...new Set(r.map((x) => `${x.status} ${JSON.parse(x.body).code}`))].join(', ')} (${r.length}×) → Turn FAILED ${t.join(', ')}; model requests: ${modelZero(`${prefix}-no-broker.log`) ? 0 : '?'}` });
}
writeFileSync(R('it-summary.json'), JSON.stringify(arms, null, 2));
console.log(JSON.stringify(arms, null, 2));
