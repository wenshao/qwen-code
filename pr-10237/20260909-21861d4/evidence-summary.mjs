import fs from 'node:fs';
import assert from 'node:assert/strict';
const dir='/tmp/qwen-pr10237-verify-20260909/artifacts';
const get=(path)=>JSON.parse(fs.readFileSync(`${dir}/${path}`,'utf8'));
console.log('PR #10237 | observed A/B verification results');
console.log('HEAD 21861d474450 | BASE fb12a6e7fe05');
console.log('macOS 26.5.1 arm64 | Node 22.22.2 | real files and locks');
console.log('');
for(const arm of ['base','head','merge']){
 const a=get(`${arm}-runtime/summary.json`),b=get(`${arm}-cross-process/summary.json`);
 assert.equal(a.passed,30);assert.equal(b.passed,5);
 const pairs=a.records.filter(r=>r.name.startsWith('concurrent-leader-'));
 const duplicates=pairs.filter(r=>r.promptRecipients.length===2).length;
 const crossDuplicates=b.records.filter(r=>r.promptRecipients.length===2).length;
 const scan=a.records.find(r=>r.name.includes('idle-scan'));
 console.log(`${arm.toUpperCase().padEnd(6)} same-process duplicate pairs: ${String(duplicates).padStart(2)}/20`);
 console.log(`       cross-process duplicate pairs: ${crossDuplicates}/5`);
 if(scan) console.log(`       idle scan: ${JSON.stringify({owner:scan.ownerOnDisk,received:{alice:scan.actualAutoClaimPrompts,bob:scan.staleLeaderBobPrompts}})}`);
 console.log(`       expected runtime outcomes: ${a.passed}/30; process pairs: ${b.passed}/5`);
}
console.log('');
console.log('BASE: two prompts, two successful writers, one persisted owner.');
console.log('HEAD + MERGE: one prompt, one success, one explicit stale-state error.');
console.log('Boundary: compiled tool/store/TeamManager; FakeBackend replaces LLM.');
console.log('Separate CLI smoke uses real InProcessBackend + localhost HTTP provider.');
