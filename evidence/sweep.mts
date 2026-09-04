const ARMS = { base: '/root/git/pr10983-base', pr: '/root/git/pr10983-pr' } as const;
const RP: any = {};
for (const [n, wt] of Object.entries(ARMS)) RP[n] = await import(`${wt}/packages/core/src/permissions/rule-parser.js`);

const bodies = [
  'npm --version', 'npm install', 'git status', 'git commit -m "x y"', 'ls', 'ls *.txt',
  'echo hi', 'echo "a b"', 'python3 -c "print(1)"', 'cat a.txt | grep x', 'ls && pwd',
  'ls; pwd', 'ls || pwd', 'make -j4', 'node -e 0', 'bash -lc true', 'ls > out.txt',
  'find . -name "*.ts"', 'tar czf a.tgz .', 'rm -rf build',
];
const prefixes = [
  '', 'FOO=bar ', 'FOO= ', 'FOO=bar BAZ=qux ', 'FOO="bar baz" ', "FOO='bar baz' ",
  'PYTHONPATH=/tmp/lib ', 'NODE_ENV=production ', 'CC=gcc-14 ', 'TZ=UTC ', 'LANG=C.UTF-8 ',
  'FOO=a:b,c./d-e@f%g+h ', 'FOO=bar\\ baz ', 'FOO=* ', 'FOO=a*b ', 'FOO=? ', 'FOO=[ab] ',
  'FOO=a|b ', 'FOO=a;b ', 'FOO=a&b ', 'FOO=$HOME ', 'FOO=${HOME} ', 'FOO=$(id) ',
  'FOO=`id` ', 'FOO="$(id)" ', 'FOO=a#b ', 'FOO=~ ', 'FOO=a\\nb ', 'FOO=a\tb ',
  'NODE_OPTIONS=--require=/tmp/a.cjs ', 'LD_PRELOAD=/tmp/a.so ', 'GIT_CONFIG_GLOBAL=/tmp/a ',
  'PATH=/tmp/x ', 'HOME=/tmp/h ', 'LD_AUDIT=/tmp/a.so ', 'JAVA_TOOL_OPTIONS=-agentpath:/tmp/a.so ',
  'foo=bar ', '_X=1 ', 'X1=1 ', 'FOO=bar  ', '  FOO=bar ',
];
const patterns = [
  'npm --version', 'npm *', 'npm install', 'git status', 'git *', 'ls', 'ls *', 'echo *',
  'python3 *', 'cat *', 'make *', 'node *', 'bash *', 'find *', 'tar *', 'rm *', '*',
];
let total = 0; const flips: any[] = [];
for (const p of prefixes) for (const b of bodies) {
  const cmd = p + b;
  for (const pat of patterns) {
    total++;
    const a = RP['base'].matchesCommandPattern(pat, cmd);
    const c = RP['pr'].matchesCommandPattern(pat, cmd);
    if (a !== c) flips.push({ cmd, pat, base: a, pr: c });
  }
}
console.log(`pairs compared: ${total}`);
console.log(`verdict flips base->pr: ${flips.length}`);
const loosened = flips.filter((f) => !f.base && f.pr);
const tightened = flips.filter((f) => f.base && !f.pr);
console.log(`  tightened (was match, now no match): ${tightened.length}`);
console.log(`  LOOSENED  (was no match, now match): ${loosened.length}`);
if (loosened.length) console.log(JSON.stringify(loosened.slice(0, 20), null, 1));
// group tightened by prefix
const byPrefix = new Map<string, number>();
for (const f of tightened) {
  const m = /^(\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)+)/.exec(f.cmd);
  const key = (m ? m[1] : '(none)').trim();
  byPrefix.set(key, (byPrefix.get(key) ?? 0) + 1);
}
console.log('\ntightened, grouped by leading prefix:');
for (const [k, v] of [...byPrefix.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(v).padStart(4)}  ${JSON.stringify(k)}`);
// no-prefix invariance check
const noPrefix = [] as any[];
for (const b of bodies) for (const pat of patterns) {
  if (RP['base'].matchesCommandPattern(pat, b) !== RP['pr'].matchesCommandPattern(pat, b)) noPrefix.push({ b, pat });
}
console.log(`\ncommands with NO leading assignment that changed verdict: ${noPrefix.length}`, JSON.stringify(noPrefix));
