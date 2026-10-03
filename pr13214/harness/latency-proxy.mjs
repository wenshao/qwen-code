// TCP relay that delays every chunk by a fixed latency in each direction
// (order preserved). usage: node latency-proxy.mjs <listenPort> <upstreamPort> <delayMs>
import net from 'node:net';

const [listenPort, upstreamPort, delayMs] = process.argv.slice(2).map(Number);
const server = net.createServer((client) => {
  const upstream = net.connect(upstreamPort, '127.0.0.1');
  const relay = (from, to) => {
    from.on('data', (chunk) => {
      setTimeout(() => {
        if (!to.destroyed) to.write(chunk);
      }, delayMs);
    });
    from.on('end', () => setTimeout(() => to.end(), delayMs + 1));
    from.on('error', () => to.destroy());
    from.on('close', () => setTimeout(() => to.destroy(), delayMs + 5));
  };
  relay(client, upstream);
  relay(upstream, client);
});
server.listen(listenPort, '127.0.0.1', () =>
  console.log(JSON.stringify({ ready: true, listenPort, upstreamPort, delayMs })),
);
