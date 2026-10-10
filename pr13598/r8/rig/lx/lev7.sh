#!/bin/bash
# usage: lev7.sh <db> <sinceHH:MM:SS> — Runtime Session rows, the execution lease, and the Harness->Broker
# calls on wake Runtime Sessions since <since> (status/code, consecutive duplicates collapsed with a count).
cd /rig; DB=$1; S=$2
echo "-- runtime sessions"; mysql -h127.0.0.1 -uroot -N -e "select substr(runtime_session_id,1,20), session_state from qwen_runtime_session order by runtime_session_id" $DB
echo "-- execution lease"; mysql -h127.0.0.1 -uroot -N -e "select ifnull(substr(runtime_session_id,1,20),'-') from managed_workspace_execution_lease" $DB
echo "-- broker calls since $S"
node -e '
const L=require("fs").readFileSync("runs/'$DB'/broker-tap.jsonl","utf8").trim().split("\n").map(JSON.parse);
const req=new Map(L.filter(e=>e.dir==="req").map(e=>[e.id,e]));
const out=[];
for (const e of L) { if (e.dir==="req" || e.at.slice(11,19) < "'$S'") continue; const r=req.get(e.id); const p=(r?.url??"").replace(/\?.*/,"").replace("/internal/runtime-broker/v1",""); if(/warm|executions\/|control/.test(p)) continue;
  const k=p.replace(/wake-[0-9a-f]{8}[0-9a-f]+/,m=>m.slice(0,13)).replace(/[0-9a-f]{8}-[0-9a-f-]{27}/,"<user>")+" "+(e.status??e.dir)+" "+(((e.body||"").match(/"code":"[a-z_]+"/)||[""])[0]).replace(/"code":/,"");
  if (out.length && out[out.length-1].k===k) out[out.length-1].n++; else out.push({t:e.at.slice(11,23),k,n:1}); }
for (const o of out.slice(0,40)) console.log(o.t, o.k, o.n>1?"x"+o.n:"");'
