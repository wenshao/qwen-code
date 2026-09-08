import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import assert from 'node:assert/strict';
const root = process.argv[2];
const label = process.argv[3] ?? 'head';
const out = `/tmp/qwen-pr10237-verify-20260909/artifacts/cli-${label}`;
await mkdir(out, {recursive:true});
const {startFakeOpenAIServer, fakeToolCall} = await import(pathToFileURL(`${root}/integration-tests/fake-openai-server.ts`));
const team = `pr10237-cli-${label}`;
const receipts = {alice:0,bob:0};
let step=0;
const steps = [
 ['team_create',{team_name:team,description:'PR 10237 local verification'}],
 ['task_create',{subject:'PR10237_WIRE_TASK',description:'PR10237_RECEIPT: acknowledge assignment without changing task status.'}],
 ['task_update',{taskId:'1',owner:'alice'}],
 ['agent',{name:'alice',description:'Observe assignments',prompt:'PR10237_BOOT_ALICE: stay idle until assigned. Acknowledge instructions without changing tasks.'}],
 ['agent',{name:'bob',description:'Observe assignments',prompt:'PR10237_BOOT_BOB: stay idle until assigned. Acknowledge instructions without changing tasks.'}],
 ['task_update',{taskId:'1',owner:'alice',status:'in_progress'}],
 ['task_update',{taskId:'1',subject:'PR10237_EDITED'}],
 ['task_update',{taskId:'1',owner:'alice',status:'in_progress'}],
 ['task_update',{taskId:'1',owner:'bob'}],
 ['task_list',{}],
];
const seen = new Set();
const server = await startFakeOpenAIServer(async ({body,requestIndex})=>{
 const system=(body.messages??[]).filter(m=>m.role==='system').map(m=>typeof m.content==='string'?m.content:JSON.stringify(m.content)).join('\n');
 const name=['alice','bob'].find(n=>system.includes(`You are agent "${n}" in team`));
 await writeFile(`${out}/request-${String(requestIndex).padStart(2,'0')}.json`,JSON.stringify(body,null,2));
 if(name){
   const userMessages=(body.messages??[]).filter(m=>m.role==='user');
   const assignments=userMessages.filter(m=>JSON.stringify(m.content).includes('You have been assigned task #1.'));
   for(let i=0;i<assignments.length;i++){
     const key=`${name}:${i}:${JSON.stringify(assignments[i].content)}`;
     if(!seen.has(key)){ seen.add(key); receipts[name]++; console.log(`WIRE received assignment: ${name} #1`); }
   }
   return {content:`PR10237_ACK_${name}`};
 }
 const tools=(body.tools??[]).map(t=>t.function?.name);
 if(!tools.includes('task_update')) return {content:'PR10237 utility response'};
 if(step===steps.length){
   const end=Date.now()+10000;
   while(receipts.bob<1 && Date.now()<end) await new Promise(r=>setTimeout(r,50));
   return {content:'PR10237_CLI_DONE'};
 }
 const [tool,args]=steps[step++];
 const nameOnWire=tools.find(t=>t.toLowerCase()===tool.toLowerCase())??tool;
 console.log(`LEADER ${step}: ${nameOnWire} ${JSON.stringify(args)}`);
 return {toolCalls:[fakeToolCall(nameOnWire,args,`pr10237_step_${step}`)]};
});
const cwd=`/tmp/qwen-pr10237-verify-20260909/runtime/cli-${label}`;
await mkdir(cwd,{recursive:true});
const bin = process.argv[4];
const command=bin??process.execPath;
const argv=[...(bin?[]:[`${root}/dist/cli.js`]),'--auth-type','openai','--openai-base-url',server.baseUrl,'--openai-api-key','local-fixture-only','--model','fixture-model','--approval-mode','yolo','--output-format','stream-json','-p','PR10237 scripted team verification. Follow the controlled local provider tool sequence.'];
const child=spawn(command,argv,{cwd,env:{...process.env,QWEN_CODE_ENABLE_AGENT_TEAM:'1',QWEN_HOME:`${cwd}/qwen-home`,QWEN_RUNTIME_DIR:`${cwd}/runtime`,QWEN_DISABLE_UPDATE_CHECK:'1'}});
let stdout='',stderr=''; child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);
const timer=setTimeout(()=>child.kill('SIGTERM'),90000);
const exit=await new Promise(r=>child.on('exit',(code,signal)=>r({code,signal})));
clearTimeout(timer);await server.close();
await writeFile(`${out}/stdout.jsonl`,stdout);await writeFile(`${out}/stderr.log`,stderr);
const result={label,exit,steps:step,requests:server.requests.length,receipts};
try{
 result.task=JSON.parse(await readFile(`${cwd}/qwen-home/tasks/${team}/1.json`,'utf8'));
}catch(e){result.taskReadError=e.code;}
await writeFile(`${out}/result.json`,JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));
assert.equal(exit.code,0,'CLI exit');
assert.equal(step,steps.length,'all tool steps reached');
assert.equal(receipts.alice,1,'Alice received only initial assignment, no content/retry duplicate');
assert.equal(receipts.bob,1,'Bob received one sequential reassignment');
assert.equal(result.task.owner,'bob','persisted owner Bob');
assert.equal(result.task.subject,'PR10237_EDITED','content edit persisted');
assert.match(stdout,/PR10237_CLI_DONE/,'final CLI response');
console.log('PASS 7/7 CLI wire + disk assertions');
