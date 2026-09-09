import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { chromium } from '/root/git/pr11485-head/node_modules/playwright/index.mjs';
const args = Object.fromEntries(process.argv.slice(2).map((a)=>{const i=a.indexOf('=');return [a.slice(2,i),a.slice(i+1)];}));
let html = readFileSync(args.doc,'utf8').replaceAll(/https:\/\/unpkg\.com\/@qwen-code\/qwen-code@[^/"]+\/export-transcript-document\.(js|css)/g,(_m,e)=>`/export-transcript-document.${e}`);
const js = readFileSync(args.js); const css = args.css ? readFileSync(args.css) : null;
const server = createServer((req,res)=>{const u=req.url.split('?')[0];
  if(u==='/'){res.writeHead(200,{'content-type':'text/html; charset=utf-8'});res.end(html);return;}
  if(u==='/export-transcript-document.js'){res.writeHead(200,{'content-type':'text/javascript'});res.end(js);return;}
  if(u==='/export-transcript-document.css'&&css){res.writeHead(200,{'content-type':'text/css'});res.end(css);return;}
  res.writeHead(404);res.end('nf');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1280,height:900}});
await page.goto(`http://127.0.0.1:${server.address().port}/`,{waitUntil:'load'});
await page.waitForFunction(()=>document.body.dataset.renderComplete==='true',null,{timeout:30000});
await page.getByRole('button',{name:/light theme/i}).click();
await page.waitForTimeout(400);
const info = await page.evaluate(()=>({bg:getComputedStyle(document.body).backgroundColor, cls:document.documentElement.className}));
console.log(JSON.stringify(info));
await page.screenshot({path:args.shot,fullPage:true});
await browser.close(); server.close();
