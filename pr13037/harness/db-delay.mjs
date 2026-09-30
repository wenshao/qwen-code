// VERIFICATION RIG ONLY: TCP relay in front of mysqld that delays each client->server packet,
// modelling a database that is not on the same host. usage: node db-delay.mjs <listen> <target> <delayMs>
import net from 'node:net';
const [listen, target, delay] = process.argv.slice(2).map(Number);
let packets = 0;
net.createServer((client) => {
  const up = net.connect(target, '127.0.0.1');
  client.setNoDelay(true); up.setNoDelay(true);
  let chain = Promise.resolve();
  client.on('data', (chunk) => {
    packets++;
    chain = chain.then(() => new Promise((r) => setTimeout(r, delay))).then(() => { if (!up.destroyed) up.write(chunk); });
  });
  up.on('data', (chunk) => { if (!client.destroyed) client.write(chunk); });
  const close = () => { client.destroy(); up.destroy(); };
  client.on('close', close); up.on('close', close); client.on('error', close); up.on('error', close);
}).listen(listen, '127.0.0.1', () => console.log(`db relay ${listen} -> ${target} +${delay} ms per request packet`));
process.on('SIGUSR2', () => console.log('packets', packets));
