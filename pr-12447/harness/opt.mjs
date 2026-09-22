const path = '/internal/managed-runtime/v2/attest';
for (const [label, port] of [['head b1ff554', process.env.P], ['gate method check removed (M33)', process.env.MP]]) {
  for (const method of ['OPTIONS', 'GET', 'PUT']) {
    const r = await fetch(`http://127.0.0.1:${port}${path}`, { method });
    const t = await r.text();
    console.log(`${label.padEnd(32)} ${method.padEnd(7)} -> ${r.status} allow=${r.headers.get('allow')} cache-control=${r.headers.get('cache-control')} body=${JSON.stringify(t.slice(0, 40))}`);
  }
}
