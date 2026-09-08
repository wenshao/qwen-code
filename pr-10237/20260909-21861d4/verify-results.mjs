import fs from 'node:fs';
import assert from 'node:assert/strict';
const root='/tmp/qwen-pr10237-verify-20260909/artifacts';
const get=p=>JSON.parse(fs.readFileSync(`${root}/${p}`,'utf8'));
let total=0;
for(const arm of ['base','head','merge']){
 const runtime=get(`${arm}-runtime/summary.json`);
 assert.equal(runtime.records.length,30);
 for(const row of runtime.records){assert.equal(row.pass,true,row.name);total++;}
 const proc=get(`${arm}-cross-process/summary.json`);
 assert.equal(proc.records.length,5);
 for(const row of proc.records){assert.equal(row.pass,true);total++;}
 const unit=get(`unit-${arm}.json`);
 assert.equal(unit.numPassedTests,arm==='base'?162:172);assert.equal(unit.numFailedTests,0);
}
for(const arm of ['global','head']){
 const cli=get(`cli-${arm}/result.json`);
 for(const [actual,expected] of [[cli.exit.code,0],[cli.steps,10],[cli.receipts.alice,1],[cli.receipts.bob,1],[cli.task.owner,'bob'],[cli.task.subject,'PR10237_EDITED']]){assert.equal(actual,expected);total++;}
 assert.match(fs.readFileSync(`${root}/cli-${arm}/stdout.jsonl`,'utf8'),/PR10237_CLI_DONE/);total++;
}
for(const row of get('mutation-matrix.json')){assert.equal(row.failed>0,row.expectedKilled);total++;}
assert.equal(total,124);
fs.writeFileSync(`${root}/assertions.json`,JSON.stringify({pass:total,fail:0,total})+'\n');
console.log(`PASS ${total}/${total} composite behavioral expectations; base bug observations count as expected controls.`);
console.log('Separate targeted unit cases: base 162/162; head 172/172; merge 172/172.');
