import fs from 'node:fs';
const fx = JSON.parse(fs.readFileSync(process.env.FIXTURES, 'utf8'));
const h = { ...fx.cases[0].request.headers }; delete h.authorization;
for (const mb of [8, 64]) {
  const t = Date.now();
  try {
    const r = await fetch(`http://127.0.0.1:${process.env.PORT}${fx.route.path}`, { method: 'POST', headers: h, body: Buffer.alloc(mb << 20, 0x78) });
    console.log(`fetch keep-alive, unauthenticated ${mb} MiB body -> ${r.status} ${JSON.stringify(await r.json())} in ${Date.now() - t} ms`);
  } catch (e) { console.log(`${mb} MiB -> ${e.cause?.code ?? e}`); }
}
