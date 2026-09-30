import fs from 'node:fs';
const { atomicWriteFileSync } = await import('/root/verify/pr13119/head/packages/core/dist/src/utils/atomicFileWrite.js');
const f = '/root/verify/pr13119/run/bm3/qh/settings.json';
for (const opts of [{}, { noFollow: true }]) {
  try { atomicWriteFileSync(f, '{"a":2}', opts); console.log(JSON.stringify(opts), 'ok'); }
  catch (e) { console.log(JSON.stringify(opts), e.code, '| target:', fs.readFileSync(f, 'utf8').trim(), '| leftovers:', fs.readdirSync('/root/verify/pr13119/run/bm3/qh').length - 1); }
}
