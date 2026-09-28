import { createServer } from 'node:http';
const modes = ['destroy-before-headers','truncated-body','delay-31s','html-502'];
const srv = createServer((req,res)=>{
  const m = new URL(req.url,'http://x').searchParams.get('m');
  if (m==='destroy-before-headers') return res.destroy();
  if (m==='truncated-body') { res.writeHead(200,{'Content-Length':'100','Content-Type':'application/json'}); res.write('{"a":'); setTimeout(()=>res.destroy(),20); return; }
  if (m==='delay-31s') return; // never answer
  if (m==='html-502') { res.writeHead(502,{'Content-Type':'text/html'}); return res.end('<html>502</html>'); }
});
await new Promise(r=>srv.listen(0,'127.0.0.1',r));
const port = srv.address().port;
async function call(m, timeout){
  const response = await fetch(`http://127.0.0.1:${port}/?m=${m}`, {signal: AbortSignal.timeout(timeout)});
  const reader = response.body.getReader(); const chunks=[];
  try { while(true){ const c = await reader.read(); if(c.done) break; chunks.push(c.value);} } finally { reader.releaseLock(); }
  return JSON.parse(Buffer.concat(chunks).toString());
}
for (const m of modes) {
  try { await call(m, m==='delay-31s'?1500:5000); console.log(m,'OK'); }
  catch (e) { console.log(m.padEnd(24), 'ctor=', e?.constructor?.name, 'name=', e?.name, 'TypeError?', e instanceof TypeError, 'DOMException TimeoutError?', e instanceof DOMException && e.name==='TimeoutError', 'msg=', String(e.message).slice(0,60)); }
}
srv.closeAllConnections(); srv.close();
