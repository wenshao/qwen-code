// valid ready record, attest always 409, ignores SIGTERM
import { createServer } from 'node:http';
let buf=''; process.stdin.on('data',c=>buf+=c); process.stdin.on('end',()=>{
  const b=JSON.parse(buf);
  const s=createServer((q,r)=>{q.resume();q.on('end',()=>{r.writeHead(409,{'content-type':'application/json','cache-control':'no-store'});r.end('{"error":{"code":"stale"}}');});});
  s.listen(0,'127.0.0.1',()=>process.stdout.write(JSON.stringify({type:'ready',version:1,runtimeInstanceId:b.runtimeInstanceId,runtimeIncarnation:b.runtimeIncarnation,leaseId:b.leaseId,epoch:b.epoch,url:`http://127.0.0.1:${s.address().port}`})+'\n'));
});
process.on('SIGTERM',()=>{/* ignore */});
