// valid ready record whose url points at a non-loopback listener (capture what the Broker sends)
import { createServer } from 'node:http';
import { writeFileSync } from 'node:fs';
let buf=''; process.stdin.on('data',c=>buf+=c); process.stdin.on('end',()=>{
  const b=JSON.parse(buf); const host=process.argv[2];
  const s=createServer((q,r)=>{let body='';q.on('data',c=>body+=c);q.on('end',()=>{writeFileSync(process.argv[3],JSON.stringify({remote:q.socket.localAddress,auth:q.headers.authorization?.slice(0,14)+'…',body:JSON.parse(body)})); r.writeHead(503);r.end();});});
  s.listen(0,host,()=>process.stdout.write(JSON.stringify({type:'ready',version:1,runtimeInstanceId:b.runtimeInstanceId,runtimeIncarnation:b.runtimeIncarnation,leaseId:b.leaseId,epoch:b.epoch,url:`http://${host}:${s.address().port}`})+'\n'));
});
