// observation only: print the two numbers the in-flight-cap assertion compares, plus timing
import { readFileSync, writeFileSync } from 'node:fs';
const file = process.argv[2] + '/integration-tests/helpers/hosted-monitor-run-fault-driver.ts';
let s = readFileSync(file, 'utf8');
const a = `  await releaseFifo(current.directory, 'run-gate');
  await waitUntil(async () => {
    checkProxy();
    checkStoreProxy();
    const state = await probe<ProbeState>(current.sessionId, 'state');
    return childRunOf(state)?.run?.state === 'settled';
  }, 120_000);
  const state = await probe<ProbeState>(current.sessionId, 'state');
  return {
    case: current.name,
    stallBlocks,`;
if (s.split(a).length !== 2) throw new Error('anchor');
s = s.replace(a, a.replace(`  await releaseFifo(current.directory, 'run-gate');`, "  console.log(`FG8_IFC stallBlocks=${stallBlocks} committedAtResume=${committedAtResume} progressNow=${progressLines()} @+${Date.now() - caseStart}ms`);\n  await releaseFifo(current.directory, 'run-gate');"));
writeFileSync(file, s);
console.log('IFC PATCHED');
