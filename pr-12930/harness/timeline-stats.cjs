const fs=require('fs'),path=require('path');
const rows=[];
for (const d of process.argv.slice(2)) {
  let L; try { L=fs.readFileSync(path.join(d,'timeline.jsonl'),'utf8').trim().split('\n').map(JSON.parse);} catch {continue}
  const g=L.find(e=>e.ev==='sse_get_dispatch'),r=L.find(e=>e.ev==='sse_response'),k=L.find(e=>e.ev==='kill_sent');
  if(!g||!r||!k){rows.push({d,missing:true});continue}
  rows.push({d:path.basename(d),status:r.status,killMinusResp:k.t-r.t});
}
const by=(p)=>rows.filter(x=>x.d&&x.d.includes(p));
for (const p of process.argv[1]?['-base-','-head-']:[]) {
  const s=by(p).filter(x=>!x.missing);
  const before=s.filter(x=>x.killMinusResp<0).length;
  const v=s.map(x=>x.killMinusResp).sort((a,b)=>a-b);
  console.log(p, 'n=',s.length,'kill BEFORE 200 response:',before,'kill AFTER:',s.length-before,'kill-minus-response ms min/median/max:',v[0],v[Math.floor(v.length/2)],v[v.length-1]);
}
