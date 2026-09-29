// Preview-tail fixture: stdout body of about SO bytes, then a final marker line
// padded with K '~' so the tail window starts at a different byte offset.
// usage: node tailgen.mjs <SO> <kind:cjk|ansi|cjklines> <K> <exit>
//   cjk      pure CJK body (3-byte characters, a newline every 40 characters)
//   cjklines CJK log lines that also contain ASCII digits
//   ansi     red-coloured ASCII lines: ESC[31m RRR... ESC[0m
const [so, kind, k, code] = process.argv.slice(2);
const CJK = '错误链接器找不到符号定义中文输出构建日志';
let out = '';
let i = 0;
while (Buffer.byteLength(out) < Number(so)) {
  i++;
  if (kind === 'cjk') {
    let line = '';
    for (let j = 0; j < 40; j++) line += CJK[(i + j) % CJK.length];
    out += line + '\n';
  } else if (kind === 'cjklines') {
    out += `第${i}行：链接器找不到符号定义，构建日志中文输出\n`;
  } else if (kind === 'emoji') {
    out += '\u{1F600}\u{1F680}\u{1F9EA}\u{1F4E6}'.repeat(10) + '\n';
  } else {
    out += `\u001b[31m${'R'.repeat(50)}\u001b[0m\n`;
  }
}
out += `构建结束 END_MARK${'~'.repeat(Number(k))}\n`;
process.stdout.write(out, () => process.exit(Number(code)));
