// TCP pass-through between the browser and a qwen serve daemon, with a
// control port that can sever every live connection ("network drop") and keep
// refusing new ones until told otherwise. Used to force a real WebSocket loss
// (and to interrupt a restoration mid-flight) without touching the daemon.
// usage: node cutproxy.cjs <listenPort> <targetPort> <controlPort>
const net = require('node:net');
const http = require('node:http');

const [listenPort, targetPort, controlPort] = process.argv.slice(2).map(Number);
const live = new Set();
let down = false;
let cuts = 0;

net
  .createServer((client) => {
    if (down) {
      client.destroy();
      return;
    }
    const upstream = net.connect(targetPort, '127.0.0.1');
    const pair = { client, upstream };
    live.add(pair);
    const close = () => {
      live.delete(pair);
      client.destroy();
      upstream.destroy();
    };
    client.on('error', close).on('close', close);
    upstream.on('error', close).on('close', close);
    // The daemon validates Host/Origin against its own port. Rewrite the
    // same-length authority in both directions so the browser can sit on the
    // proxy port (5411 <-> 4411) without any other byte changing.
    const fromClient = Buffer.from(`127.0.0.1:${listenPort}`);
    const toUpstream = Buffer.from(`127.0.0.1:${targetPort}`);
    const swap = (buf, a, b) => {
      let i = buf.indexOf(a);
      while (i !== -1) {
        b.copy(buf, i);
        i = buf.indexOf(a, i + a.length);
      }
      return buf;
    };
    client.on('data', (d) => upstream.write(swap(d, fromClient, toUpstream)));
    upstream.on('data', (d) => client.write(swap(d, toUpstream, fromClient)));
  })
  .listen(listenPort, '127.0.0.1');

http
  .createServer((req, res) => {
    if (req.url === '/down' || req.url === '/cut') {
      cuts++;
      const n = live.size;
      for (const { client, upstream } of live) {
        client.destroy();
        upstream.destroy();
      }
      live.clear();
      if (req.url === '/down') down = true;
      res.end(JSON.stringify({ severed: n, down, cuts }));
    } else if (req.url === '/up') {
      down = false;
      res.end(JSON.stringify({ down }));
    } else {
      res.end(JSON.stringify({ live: live.size, down, cuts }));
    }
  })
  .listen(controlPort, '127.0.0.1');
console.log(`cutproxy ${listenPort} -> ${targetPort}, control ${controlPort}`);
