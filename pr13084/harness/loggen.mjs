// Deterministic text log: <lines> lines of exactly 80 bytes on stdout, optional stderr lines, exit code.
// usage: node loggen.mjs <lines> [stderrLines] [exitCode]
const [lines, errLines = '0', code = '0'] = process.argv.slice(2);
const N = Number(lines);
let buf = '';
for (let i = 1; i <= N; i++) {
  buf += `[${String(i).padStart(8, '0')}] INFO  compile module-${String(i % 9973).padStart(4, '0')} ok  ` + 'abcdefghijklmnopqrstuvwxyz0123456789'.slice(0, 36) + ' \n';
  if (buf.length >= 1 << 20) {
    if (!process.stdout.write(buf)) await new Promise((r) => process.stdout.once('drain', r));
    buf = '';
  }
}
if (buf) process.stdout.write(buf);
for (let i = 1; i <= Number(errLines); i++) process.stderr.write(`error[E${String(i).padStart(4, '0')}]: unresolved symbol rig_link_target_${i}\n`);
await new Promise((r) => process.stdout.write('', r));
process.exitCode = Number(code);
