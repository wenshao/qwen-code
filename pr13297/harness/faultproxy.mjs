// TCP fault proxy in front of MySQL. Control: GET http://127.0.0.1:<ctl>/{up,down,stats}
// down = destroy every live socket and reset every new one (a real store outage
// as Connector/J sees it: "Communications link failure").
import net from 'node:net';
import http from 'node:http';

const [listenPort, targetPort, controlPort] = process.argv.slice(2).map(Number);
let up = true;
const live = new Set();
const stats = { accepted: 0, refused: 0 };

net
  .createServer((client) => {
    if (!up) {
      stats.refused++;
      client.resetAndDestroy();
      return;
    }
    stats.accepted++;
    const upstream = net.connect(targetPort, '127.0.0.1');
    const pair = [client, upstream];
    live.add(pair);
    const close = () => {
      live.delete(pair);
      client.destroy();
      upstream.destroy();
    };
    client.on('error', close).on('close', close);
    upstream.on('error', close).on('close', close);
    client.pipe(upstream);
    upstream.pipe(client);
  })
  .listen(listenPort, '127.0.0.1');

http
  .createServer((req, res) => {
    if (req.url === '/down') {
      up = false;
      for (const [c, u] of live) {
        c.resetAndDestroy();
        u.destroy();
      }
      live.clear();
    } else if (req.url === '/up') {
      up = true;
    }
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ up, live: live.size, ...stats }));
  })
  .listen(controlPort, '127.0.0.1');
console.log(`faultproxy ${listenPort} -> ${targetPort}, control ${controlPort}`);
