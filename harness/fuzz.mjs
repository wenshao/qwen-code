/** Seeded, reproducible generator of heredoc-shaped commands. */
export const PAYLOAD = 'pwned';

export function generate(n, initialSeed = 0x9417c0de) {
  let seed = initialSeed >>> 0;
  const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
  const pick = (a) => a[Math.floor(rnd() * a.length)];

  const receivers = [
    'cat', 'python', 'python3', 'head', 'tee', 'node', 'perl', 'ruby', 'awk', 'sort',
    'bash', 'sh', 'dash', 'zsh', 'busybox sh', 'bash -s', 'sudo bash', 'nice bash',
    "'cat'", '"bash"', './cat', '/bin/cat', 'command cat', 'FOO=1 cat', 'FOO=1 bash',
    'xargs sh -c', 'env bash', 'unknowncmd',
  ];
  const opsPrefix = ['', 'cd /tmp && ', 'echo hi; ', 'echo hi | ', 'true && '];
  const opsSuffix = ['', ' && echo hi', ' | bash', '; echo hi', ' > /dev/null', ' 2>&1'];
  const delimSpellings = [
    (d) => `<<${d}`, (d) => `<<'${d}'`, (d) => `<<"${d}"`, (d) => `<<-${d}`,
    (d) => `<< ${d}`, (d) => `<<  '${d}'`,
  ];
  const delims = ['EOF', 'PY', 'A', '_x', 'E1', 'End_1'];
  const bodyLine = () => pick([
    `${PAYLOAD} hit`, 'echo inert', 'print(1)', 'plain data', '$(id)', '`id`',
    'x = 1 << 2', 'echo "', "echo 'a", 'foo\\', '# comment', '',
  ]);
  const preludes = [
    '', 'echo start\n', 'cat() { bash; }\n', 'shopt -s expand_aliases\nalias cat=bash\n',
    'PATH=/tmp/x\n', 'hash -p /bin/bash cat\n', "eval 'true'\n", 'echo $((1 << 4))\n',
  ];
  const tails = ['', `\n${PAYLOAD} tail`, '\necho done', `\necho a && ${PAYLOAD} tail2`];

  const out = [];
  for (let i = 0; i < n; i++) {
    const r = pick(receivers);
    const d = pick(delims);
    const spell = pick(delimSpellings)(d);
    const tabbed = spell.startsWith('<<-');
    const body = [];
    for (let b = 0, k = 1 + Math.floor(rnd() * 3); b < k; b++) {
      body.push((tabbed ? '\t' : '') + bodyLine());
    }
    const term = (tabbed && rnd() < 0.7 ? '\t' : '') + d;
    out.push({
      id: `rand-${i}`,
      command:
        pick(preludes) + pick(opsPrefix) + `${r} ${spell}` + pick(opsSuffix) +
        '\n' + body.join('\n') + '\n' + term + pick(tails),
    });
  }
  return out;
}
