const {BASE_URL:B,TOKEN:T,WS}=process.env; const h={Authorization:`Bearer ${T}`,'content-type':'application/json'};
const j=async(p,o={})=>{const r=await fetch(B+p,{headers:{...h,...(o.cid?{'x-qwen-client-id':o.cid}:{})},method:o.m||'GET',body:o.b&&JSON.stringify(o.b)});const t=await r.text();try{return [r.status,JSON.parse(t)]}catch{return [r.status,t.slice(0,300)]}};
const [,s]=await j('/session',{m:'POST',b:{cwd:WS,approvalMode:'yolo',sessionScope:'thread'}});
const sid=s.sessionId, cid=s.clientId;
const [,p1]=await j(`/session/${sid}/prompt`,{m:'POST',cid,b:{prompt:[{type:'text',text:'[[S:hello]] first'}]}});
await new Promise(r=>setTimeout(r,2500));
const [,p2]=await j(`/session/${sid}/prompt`,{m:'POST',cid,b:{prompt:[{type:'text',text:'[[S:hello]] second'}]}});
await new Promise(r=>setTimeout(r,2500));
const um=async()=>{const [,t]=await j(`/session/${sid}/transcript`);return t.events.filter(e=>e.data?.sessionUpdate==='user_message_chunk').map(e=>[e.data.content.text,e.data._meta?.promptId])};
console.log('before',JSON.stringify(await um()));
const cdr=await j(`/session/${sid}/cd`,{m:"POST",cid,b:{path:`${WS}/sub`}}); console.log("cd",cdr[0]);
for (const target of [`${sid}########2`]) {
  const r=await j(`/session/${sid}/rewind`,{m:'POST',cid,b:{promptId:target,rewindFiles:false}});
  console.log('rewind',target,r[0],JSON.stringify(r[1]).slice(0,300));
  if (r[0]===200) break;
}
console.log('after',JSON.stringify(await um()));
