// Exact-size preview fixture: stdout ASCII lines to exactly SO bytes; optional stderr
// (ascii|cjk) of about SE bytes after PAD ASCII bytes, ending with a marker line.
// usage: node prevgen.mjs <SO> <kind:none|ascii|cjk> <SE> <PAD> <exit>
const [so, kind, se, pad, code, suffix = '0'] = process.argv.slice(2);
let out = '';
for (let i = 1; out.length < Number(so); i++) out += `stdout line ${String(i).padStart(6, '0')} ${'-'.repeat(40)}\n`;
out = out.slice(0, Number(so));
let err = '';
if (kind !== 'none') {
  err += '#'.repeat(Number(pad));
  if (Number(pad)) err += '\n';
  for (let i = 1; Buffer.byteLength(err) < Number(se); i++) err += kind === 'cjk' ? `第${i}条 链接器详细信息：符号未定义\n` : `stderr detail ${i}: undefined symbol\n`;
  err += (kind === 'cjk' ? '最终错误：链接失败 RIG_MARKER' : 'FINAL ERROR: link failed RIG_MARKER') + '~'.repeat(Number(suffix)) + '\n';
}
process.stdout.write(out, () => {
  if (!err) process.exit(Number(code));
  process.stderr.write(err, () => process.exit(Number(code)));
});
