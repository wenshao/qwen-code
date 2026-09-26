// Scores every A/B run: todo_write usage, comment lines added, and an independent
// post-hoc check of each workspace (npm run check + a behaviour probe per task).
import fs from 'node:fs';
import { execSync } from 'node:child_process';
const V = '/Users/wenshao/git/v12784';
const probes = {
  simple: `import('./src/lib/stock.ts').then(m=>{m.addItem('a',5);let t=false;try{m.reserve('a',-1)}catch(e){t=e instanceof RangeError}console.log(JSON.stringify({negThrows:t,ok:m.reserve('a',2)===true&&m.available('a')===3}))})`,
  multi: `import('./src/lib/stock.ts').then(m=>{const th=(f)=>{try{f();return false}catch(e){return e instanceof RangeError}};m.addItem('a',5);const r=typeof m.release==='function';const res={hasRelease:r,reserveNeg:th(()=>m.reserve('a',-1)),reserveZero:th(()=>m.reserve('a',0)),reserveFrac:th(()=>m.reserve('a',1.5))};if(r){m.reserve('a',2);m.release('a',2);res.releaseRestores=m.available('a')===5;res.releaseNeg=th(()=>m.release('a',-1));res.releaseFrac=th(()=>m.release('a',0.5))}console.log(JSON.stringify(res))})`,
  comments: `import('./src/lib/stock.ts').then(m=>{m.addItem('a',5);m.addItem('a',NaN);console.log(JSON.stringify({nanIgnored:m.available('a')===5,reserveOk:m.reserve('a',2)===true&&m.available('a')===3}))})`,
  big: `Promise.all([import('./src/lib/stock.ts'),import('./src/lib/money.ts'),import('./src/lib/dates.ts')]).then(([s,mo,d])=>{const th=(f)=>{try{f();return false}catch(e){return e instanceof Error}};const rth=(f)=>{try{f();return false}catch(e){return e instanceof RangeError}};s.addItem('a',5);const r={hasRelease:typeof s.release==='function',reserveNeg:rth(()=>s.reserve('a',-1)),reserveZero:rth(()=>s.reserve('a',0)),reserveFrac:rth(()=>s.reserve('a',1.5))};if(r.hasRelease){s.reserve('a',2);s.release('a',2);r.releaseRestores=s.available('a')===5;r.releaseNeg=rth(()=>s.release('a',-1))}r.usd=mo.cents(1.234)===123&&mo.cents(1.234,'USD')===123;r.eur=mo.cents(2.5,'EUR')===250;r.jpy=mo.cents(1234.4,'JPY')===1234;r.gbpThrows=th(()=>mo.cents(1,'GBP'));r.isWeekend=typeof d.isWeekend==='function'&&d.isWeekend(new Date(2026,8,26))===true&&d.isWeekend(new Date(2026,8,28))===false;console.log(JSON.stringify(r))})`,
  tz: `import('./src/lib/dates.ts').then(d=>{const x=new Date('2026-09-26T20:00:00Z');const y=new Date('2026-09-28T02:00:00Z');const call=(f,dt,z)=>{try{const v=f(dt,z);return v}catch{try{return f(dt,{timeZone:z})}catch{return 'ERR'}}};const loc=x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');const r={tokyo:call(d.formatDate,x,'Asia/Tokyo')==='2026-09-27',la:call(d.formatDate,x,'America/Los_Angeles')==='2026-09-26',localDefault:d.formatDate(x)===loc,isWeekendExported:typeof d.isWeekend==='function'};if(r.isWeekendExported){r.wkTokyo=call(d.isWeekend,y,'Asia/Tokyo')===false;r.wkLA=call(d.isWeekend,y,'America/Los_Angeles')===true}console.log(JSON.stringify(r))})`,
};
const rows = [];
for (const id of fs.readdirSync(`${V}/runs`).sort()) {
  const [task, fam, arm, t, rep] = id.split('-');
  if (task === 'smoke') continue;
  const d = `${V}/runs/${id}`;
  if (!fs.existsSync(`${d}/exit`)) continue;
  const L = fs.readFileSync(`${d}/out.jsonl`, 'utf8').trim().split('\n').flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });
  const result = L.find((e) => e.type === 'result');
  const uses = L.filter((e) => e.type === 'assistant').flatMap((e) => (e.message.content || []).filter((c) => c.type === 'tool_use'));
  const todos = uses.filter((c) => c.name === 'todo_write').map((c) => c.input.todos || []);
  const toolIdxFirstTodo = uses.findIndex((c) => c.name === 'todo_write');
  const last = todos.at(-1) || [];
  const diff = fs.existsSync(`${d}/ws.diff`) ? fs.readFileSync(`${d}/ws.diff`, 'utf8') : '';
  let file = '';
  const comments = [];
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) { file = line.slice(6); continue; }
    if (/^\+\s*(\/\/|\/\*|\*(?!\*)|\*\/)/.test(line) || /^\+.*\S\s+\/\/\s/.test(line)) comments.push(`${file}: ${line.slice(1).trim()}`);
  }
  let check = 'n/a', probe = null;
  try { execSync('npm run check', { cwd: `${d}/ws`, stdio: 'ignore', timeout: 120000 }); check = 'pass'; } catch { check = 'FAIL'; }
  try { probe = JSON.parse(execSync(`node --input-type=module -e "${probes[task].replace(/"/g, '\\"')}"`, { cwd: `${d}/ws`, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 60000 }).trim().split('\n').pop()); } catch (e) { probe = { error: String(e.message).slice(0, 80) }; }
  const probeOk = probe && !probe.error && Object.values(probe).every((v) => v === true);
  rows.push({
    id, task, fam, arm, rep: +rep,
    exit: fs.readFileSync(`${d}/exit`, 'utf8').trim(), success: result?.subtype === 'success' && !result?.is_error,
    turns: result?.num_turns, durationS: Math.round((result?.duration_ms || 0) / 1000),
    todoCalls: todos.length, todoFirstAtToolIdx: toolIdxFirstTodo, todoItemsFirst: todos[0]?.length ?? 0,
    todoMaxInProgress: Math.max(0, ...todos.map((l) => l.filter((x) => x.status === 'in_progress').length)),
    todoFinalAllCompleted: todos.length ? last.every((x) => x.status === 'completed') : null,
    finalRepeatsList: todos.length ? last.filter((x) => (result?.result || '').includes(x.content)).length >= Math.ceil(last.length / 2) : null,
    commentLines: comments.length, srcCommentLines: comments.filter((c) => c.startsWith('src/')).length, comments,
    check, probe, probeOk,
    shellDenied: L.filter((e) => e.type === 'user').flatMap((e) => e.message.content || []).filter((c) => c.type === 'tool_result' && JSON.stringify(c.content).includes('requires permission')).length,
  });
}
fs.writeFileSync(`${V}/ab-rows.json`, JSON.stringify(rows, null, 1));
const agg = {};
for (const r of rows) {
  const k = `${r.task}|${r.fam}|${r.arm}`;
  const a = (agg[k] ||= { n: 0, success: 0, usedTodo: 0, todoCalls: 0, todoItemsFirst: [], multiInProgress: 0, finalAllCompleted: 0, repeatsList: 0, withSrcComments: 0, srcCommentLines: 0, commentLines: 0, checkPass: 0, probeOk: 0, turns: [], durationS: [] });
  a.n++; a.success += r.success; a.usedTodo += r.todoCalls > 0; a.todoCalls += r.todoCalls;
  if (r.todoCalls) a.todoItemsFirst.push(r.todoItemsFirst);
  a.multiInProgress += r.todoMaxInProgress > 1; a.finalAllCompleted += r.todoFinalAllCompleted === true; a.repeatsList += r.finalRepeatsList === true;
  a.withSrcComments += r.srcCommentLines > 0; a.srcCommentLines += r.srcCommentLines; a.commentLines += r.commentLines;
  a.checkPass += r.check === 'pass'; a.probeOk += r.probeOk; a.turns.push(r.turns); a.durationS.push(r.durationS);
}
for (const [k, a] of Object.entries(agg)) {
  const med = (xs) => { const s = [...xs].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
  console.log(k.padEnd(28), `n=${a.n} ok=${a.success} todoRuns=${a.usedTodo} todoCalls=${a.todoCalls} items1st=[${a.todoItemsFirst}] >1inProg=${a.multiInProgress} finalDone=${a.finalAllCompleted} repeats=${a.repeatsList} srcCommentRuns=${a.withSrcComments} srcCommentLines=${a.srcCommentLines} allCommentLines=${a.commentLines} check=${a.checkPass} probe=${a.probeOk} medTurns=${med(a.turns)} medSec=${med(a.durationS)}`);
}
