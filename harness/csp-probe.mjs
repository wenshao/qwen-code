// Does the document's createElement shim let a runtime-injected <style> past the
// nonce-only CSP? (Validates the corrected shape-guard comment in build.mjs.)
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { chromium } from '/root/git/pr11485-head/node_modules/playwright/index.mjs';
const a = Object.fromEntries(process.argv.slice(2).map(x=>{const i=x.indexOf('=');return [x.slice(2,i),x.slice(i+1)];}));
let html = readFileSync(a.doc,'utf8').replaceAll(/https:\/\/unpkg\.com\/@qwen-code\/qwen-code@[^/"]+\/export-transcript-document\.(js|css)/g,(_m,e)=>`/export-transcript-document.${e}`);
const js = readFileSync(a.js); const css = a.css?readFileSync(a.css):null;
const srv = createServer((req,res)=>{const u=req.url.split('?')[0];
 if(u==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html);return;}
 if(u==='/export-transcript-document.js'){res.writeHead(200,{'content-type':'text/javascript'});res.end(js);return;}
 if(u==='/export-transcript-document.css'&&css){res.writeHead(200,{'content-type':'text/css'});res.end(css);return;}
 res.writeHead(404);res.end('nf');});
await new Promise(r=>srv.listen(0,'127.0.0.1',r));
const b = await chromium.launch({headless:true});
const p = await b.newPage();
const cspErrors=[];
p.on('console',m=>{const t=m.text(); if(/content security policy|refused to/i.test(t)) cspErrors.push(t);});
await p.goto(`http://127.0.0.1:${srv.address().port}/`,{waitUntil:'load'});
await p.waitForFunction(()=>document.body.dataset.renderComplete==='true',null,{timeout:30000});
const out = await p.evaluate(() => {
  const viaShim = document.createElement('style');
  viaShim.dataset.qwenWebShell = 'component';
  viaShim.textContent = 'body{background-color:rgb(1,2,3) !important}';
  document.head.appendChild(viaShim);
  const shimApplied = getComputedStyle(document.body).backgroundColor;
  viaShim.remove();
  // control: bypass the shim, create the element the way the shim cannot see
  const raw = document.createElementNS('http://www.w3.org/1999/xhtml','style');
  raw.textContent = 'body{background-color:rgb(4,5,6) !important}';
  document.head.appendChild(raw);
  const rawApplied = getComputedStyle(document.body).backgroundColor;
  raw.remove();
  return { shimApplied, rawApplied, shimNonce: viaShim.getAttribute('nonce') !== null };
});
console.log(JSON.stringify({...out, cspErrors}, null, 1));
await b.close(); srv.close();
