// CJK build log: N lines of UTF-8 Chinese on stdout, one Chinese error on stderr, exit 2.
const n = Number(process.argv[2] ?? 4000);
let out = '';
for (let i = 1; i <= n; i++) out += `第${i}个模块 编译通过（共${n}个）\n`;
process.stdout.write(out, () => { process.stderr.write('错误：链接失败，未定义符号 rig_中文_target\n', () => process.exit(2)); });
