// Round 9: 2a3688d703 holds a natural end until the unit is empty, so the
// probes' unbounded awaits on a launcher that leaves a live member never
// return. Bound them (10 s / 15 s), record whether the end came inside the
// bound, then stop through the route and record what the stop answers.
import fs from 'node:fs';
const P = '/Users/wenshao/pr13265-rig/probe';
const edit = (file, pairs) => {
  let s = fs.readFileSync(`${P}/${file}`, 'utf8');
  for (const [a, b] of pairs) {
    if (s.split(a).length !== 2) throw new Error(`${file}: anchor ${a.slice(0, 60)}`);
    s = s.replace(a, () => b);
  }
  fs.writeFileSync(`${P}/${file}`, s);
  console.log(`bounded ${file}`);
};
edit('l19-executor.mjs', [[
`  const receipt = await s.completion;
  out[name] = {
    completionMs: Date.now() - s.t0,
    receipt: receipt.evidence,
    holdAfter: executor.hasActiveSession(\`s-\${name}\`),
    status: await ask(\`s-\${name}\`, 'shell-status', s.callId),
    terminate: await ask(\`s-\${name}\`, 'shell-terminate', s.callId),`,
`  const receipt = await Promise.race([s.completion, sleep(10_000).then(() => null)]);
  const completionMs = receipt ? Date.now() - s.t0 : null;
  const holdAfter = executor.hasActiveSession(\`s-\${name}\`);
  const status = await ask(\`s-\${name}\`, 'shell-status', s.callId);
  const terminate = await ask(\`s-\${name}\`, 'shell-terminate', s.callId);
  const late = receipt ? null : await Promise.race([s.completion, sleep(10_000).then(() => null)]);
  out[name] = {
    completionMs,
    endedWithin10s: receipt !== null,
    receipt: receipt ? receipt.evidence : null,
    holdAfter,
    status,
    terminate,
    ...(receipt ? {} : { receiptAfterTerminate: late ? late.evidence : 'none within 10 s', holdAfterTerminate: executor.hasActiveSession(\`s-\${name}\`) }),`,
]]);
edit('b-l14-terminate-race.mjs', [[
`const receipt = await reg.register({ unitName: name, sessionId: 's15', process: p, sink, publisher: { finish: async () => calls.push('publisher.finish') }, identity: {} });
const ms = Date.now() - t0;`,
`const receipt = (await Promise.race([
  reg.register({ unitName: name, sessionId: 's15', process: p, sink, publisher: { finish: async () => calls.push('publisher.finish') }, identity: {} }),
  sleep(15_000).then(() => ({ evidence: 'no end within 15 s' })),
]));
const ms = Date.now() - t0;`,
]]);
