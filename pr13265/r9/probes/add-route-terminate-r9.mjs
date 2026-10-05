// Round 9: 2a3688d703's natural-end settle removes the unit as soon as it
// empties; a concurrent terminate() polling the same unit then never sees it
// empty and writes cgroup.kill into a removed directory (ENOENT, seen in the
// probe's own cleanup). Measure it through the production stop route: start
// an ordinary background Shell, stop it with shell-terminate, read status.
// Also make the probe's cleanup record instead of crash.
import fs from 'node:fs';
const file = '/Users/wenshao/pr13265-rig/probe/l19-executor.mjs';
let s = fs.readFileSync(file, 'utf8');
const rep = (a, b) => { if (s.split(a).length !== 2) throw new Error(`anchor ${a.slice(0, 60)}`); s = s.replace(a, () => b); };
rep('  await registry.terminate(other.unitName, 1000);\n}',
`  try {
    await registry.terminate(other.unitName, 1000);
    out.drain.keepCleanup = 'ok';
  } catch (e) {
    out.drain.keepCleanup = \`\${e.code ?? e.name}: \${e.message.slice(0, 120)}\`;
  }
}

// e2. the production stop route on an ordinary running background Shell
if (want('routeTerminate')) {
  out.routeTerminate = {};
  for (const [label, command] of [['execSleep', 'sleep 3198'], ['shellParent', 'sleep 3199; true']]) {
    const answers = {};
    let unitsLeft = 0;
    for (let i = 0; i < 10; i++) {
      const s = await start('s-rt', \`l19-rt-\${label.toLowerCase()}-\${i}\`, command);
      if (!s.started) { answers[\`startError\`] = (answers.startError ?? 0) + 1; continue; }
      await sleep(300);
      const t = await ask('s-rt', 'shell-terminate', s.callId);
      const key = t.error ? \`error \${t.error.slice(0, 90)}\` : \`\${t.state}\${t.evidence ? ' ' + JSON.stringify(t.evidence) : ''}\`;
      answers[key] = (answers[key] ?? 0) + 1;
      const st = await ask('s-rt', 'shell-status', s.callId);
      const skey = \`status \${st.error ? 'error ' + st.error.slice(0, 60) : st.state}\`;
      answers[skey] = (answers[skey] ?? 0) + 1;
      if (fs.existsSync(path.join(ROOT, s.unitName))) unitsLeft++;
    }
    out.routeTerminate[label] = { answers, unitsLeft, holdAfter: executor.hasActiveSession('s-rt') };
  }
}`);
fs.writeFileSync(file, s);
console.log('added routeTerminate');
