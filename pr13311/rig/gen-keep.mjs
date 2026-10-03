import fs from 'node:fs';
const [src, dst] = process.argv.slice(2);
const text = fs.readFileSync(src, 'utf8');
const anchor = "if (failure && process.env['QWEN_MANAGED_E2E_KEEP_TMP'] === '1') {";
const n = text.split(anchor).length - 1;
if (n !== 1) { console.error(`anchor count ${n}`); process.exit(3); }
fs.writeFileSync(dst, text.replace(anchor, "if (process.env['QWEN_MANAGED_E2E_KEEP_TMP'] === '1') {"));
console.log(`wrote ${dst}`);
