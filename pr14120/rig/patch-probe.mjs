// Instrument a COPY of the FG8 driver (observation only, no assertion changes):
// committed-ledger length at abort/resume, and which journal op the receipt-drop case destroys.
import { readFileSync, writeFileSync } from 'node:fs';
const file = process.argv[2] + '/integration-tests/helpers/hosted-monitor-run-fault-driver.ts';
let s = readFileSync(file, 'utf8');
const sub = (a, b) => { if (s.split(a).length !== 2) throw new Error('anchor: ' + a.slice(0, 60)); s = s.replace(a, b); };
sub(`    const cursor = observer.frames.at(-1)!.id;
    resumed = new Observer(surface, current.sessionId);
    step(\`stream aborted at \${cursor}\`);
    await resumed.start(cursor);
    step('stream resumed');`,
`    const cursor = observer.frames.at(-1)!.id;
    const ledgerAtAbort = (await probe<unknown[]>(current.sessionId, 'ledger')).length;
    resumed = new Observer(surface, current.sessionId);
    step(\`stream aborted at \${cursor}\`);
    await resumed.start(cursor);
    const ledgerAtResume = (await probe<unknown[]>(current.sessionId, 'ledger')).length;
    console.log(\`FG8_GAP \${current.name} cursor=\${cursor} ledgerAtAbort=\${ledgerAtAbort} ledgerAtResume=\${ledgerAtResume} replayable=\${ledgerAtResume - cursor}\`);
    step('stream resumed');`);
sub(`    const frames = [...observer.frames, ...resumed!.frames];`,
`    const frames = [...observer.frames, ...resumed!.frames];
    console.log(\`FG8_GAP_FINAL \${current.name} preAbort=\${observer.frames.length} resumed=\${resumed!.frames.length} ledger=\${ledger.length} resumedTypes=\${JSON.stringify(resumed!.frames.slice(0, 4).map((f) => f.event))}\`);`);
sub("      console.log(`FG8_DROPPED commit ${url.pathname}`);",
"      console.log(`FG8_DROPPED commit ${url.pathname} op=${String(parsed?.['operation'])} tx=${String(parsed?.['transactionId'])}`);");
sub(`    if (isCommit) {
      commitLog.push({`,
`    if (isCommit && droppedCommits > 0) console.log(\`FG8_POSTDROP \${url.pathname} op=\${String(parsed?.['operation'])} tx=\${String(parsed?.['transactionId'])} -> \${upstream.status}\`);
    if (isCommit) {
      commitLog.push({`);
writeFileSync(file, s);
console.log('PROBE PATCHED ' + file);
