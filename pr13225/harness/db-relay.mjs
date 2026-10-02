// VERIFICATION RIG ONLY (PR #13225): TCP relay in front of mysqld that delays each client->server packet
// by the number of ms in <ctlFile> (re-read every 200 ms), modelling a database on another host.
// usage: node db-relay.mjs <listen> <target> <ctlFile>
import net from 'node:net';
import fs from 'node:fs';
const [listen, target, ctl] = [Number(process.argv[2]), Number(process.argv[3]), process.argv[4]];
let delay = 0, packets = 0;
const read = () => { try { delay = Number(fs.readFileSync(ctl, 'utf8').trim()) || 0; } catch { delay = 0; } };
read(); setInterval(read, 200).unref();
net.createServer((client) => {
  const up = net.connect(target, '127.0.0.1');
  client.setNoDelay(true); up.setNoDelay(true);
  let chain = Promise.resolve();
  client.on('data', (chunk) => {
    packets++;
    const d = delay;
    chain = chain.then(() => (d > 0 ? new Promise((r) => setTimeout(r, d)) : undefined)).then(() => { if (!up.destroyed) up.write(chunk); });
  });
  up.on('data', (chunk) => { if (!client.destroyed) client.write(chunk); });
  const close = () => { client.destroy(); up.destroy(); };
  client.on('close', close); up.on('close', close); client.on('error', close); up.on('error', close);
}).listen(listen, '127.0.0.1', () => console.log(`db relay ${listen} -> ${target}, delay from ${ctl}`));
