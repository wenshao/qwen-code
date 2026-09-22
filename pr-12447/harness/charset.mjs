import fs from 'node:fs';
const fx = JSON.parse(fs.readFileSync(process.env.FIXTURES, 'utf8'));
const ok = fx.cases.find((c) => c.id === 'success').request;
const json = JSON.stringify(ok.body);
const enc = {
  'utf-8': Buffer.from(json, 'utf8'),
  'utf-16le': Buffer.from(json, 'utf16le'),
  'utf-7': Buffer.from(json, 'utf8'), // ASCII-only JSON is identical in UTF-7 except '+'; none present
  'iso-8859-1': Buffer.from(json, 'latin1'),
};
for (const [cs, body] of Object.entries(enc)) {
  const r = await fetch(`http://127.0.0.1:${process.env.PORT}${fx.route.path}`, { method: 'POST', headers: { ...ok.headers, 'content-type': `application/json; charset=${cs}` }, body });
  const t = await r.text();
  console.log(`charset=${cs.padEnd(10)} (${body.length} bytes) -> ${r.status} ${r.headers.get('content-type')?.split(';')[0]} ${JSON.parse(t).code ?? '(success body)'}`);
}
