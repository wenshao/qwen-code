// VERIFICATION RIG ONLY (PR #13194): general-log window around a whole Spring start.  usage: node p5-genlog.mjs on | check <ws...>
import fs from 'node:fs';
import { genlogOn, genlogOff, genlogWrites, RUNTIME_TABLES, RIG, DB, sql, j } from './lib94.mjs';
const [cmd, ...wss] = process.argv.slice(2);
const OFF = `${RIG}/out/${DB}/genlog-offset.txt`;
if (cmd === 'on') { fs.mkdirSync(`${RIG}/out/${DB}`, { recursive: true }); fs.writeFileSync(OFF, String(genlogOn())); console.log('genlog on'); }
else {
  const off = Number(fs.readFileSync(OFF, 'utf8'));
  for (const ws of wss) {
    const st = JSON.parse(fs.readFileSync(`${RIG}/out/${DB}/mixed-${ws}.json`, 'utf8'));
    const w = genlogWrites(off, RUNTIME_TABLES, [st.S, st.binding]);
    const row = sql(`SELECT state, claim_generation, completed_at FROM managed_agent_operation WHERE operation_id='${st.op}'`)[0];
    console.log(`${ws}: op=${j(row)} runtime-writes=${w.length} ${w.slice(0, 2).join(' | ')}`);
  }
  genlogOff();
}
