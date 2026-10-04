// Usage: node mutate.mjs <worktree> <mutant>
// Restores one PR #13388 conversion to an intrinsic monitor on top of the
// head file; every other conversion stays a ReentrantLock.
//   M1          HarnessEventStream.next() -> public synchronized (author's mutation 1)
//   C<line>     the context.lock() site at head line <line> -> synchronized (context)
//   BR / DR     BindingRenewal / DispatchRenewal class -> merge-base text
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';

const [wt, mutant] = process.argv.slice(2);
const HEAD = process.env.HEAD_SHA ?? '07849a18f001d9d909ef7a419e47de3dea805ac2';
const BASE = process.env.BASE_SHA ?? '6136786c0cbdfc9376243e3c524b22c6d374df47';
const STREAM = 'packages/sdk-java/qwencode/src/main/java/com/alibaba/qwen/code/daemon/HarnessEventStream.java';
const BROKER = 'packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/RuntimeBrokerService.java';
const show = (rev, p) => execFileSync('git', ['-C', wt, 'show', `${rev}:${p}`], { encoding: 'utf8', maxBuffer: 64 << 20 });
const once = (text, from, to) => {
  const n = text.split(from).length - 1;
  if (n !== 1) throw new Error(`expected exactly one match, got ${n}: ${from.slice(0, 80)}`);
  return text.replace(from, to);
};

// Reset both files to head first so mutants never stack.
fs.writeFileSync(`${wt}/${STREAM}`, show(HEAD, STREAM));
fs.writeFileSync(`${wt}/${BROKER}`, show(HEAD, BROKER));

if (mutant === 'M1') {
  let t = show(HEAD, STREAM);
  t = once(t, '    public DaemonEvent next() {\n        lock.lock();\n        try {\n            ensureOpen();',
    '    public synchronized DaemonEvent next() {\n        {\n            ensureOpen();');
  t = once(t, '                throw e;\n            }\n        } finally {\n            lock.unlock();\n        }\n    }\n',
    '                throw e;\n            }\n        }\n    }\n');
  fs.writeFileSync(`${wt}/${STREAM}`, t);
} else if (/^C\d+$/.test(mutant)) {
  const line = Number(mutant.slice(1));
  const lines = show(HEAD, BROKER).split('\n');
  const i = line - 1;
  const m = /^(\s*)context\.lock\(\);$/.exec(lines[i]);
  if (!m) throw new Error(`line ${line} is not a context.lock(): ${lines[i]}`);
  const ind = m[1];
  if (lines[i + 1] !== `${ind}try {`) throw new Error(`no try after line ${line}`);
  let j = i + 2;
  while (!(lines[j] === `${ind}} finally {` && lines[j + 1] === `${ind}    context.unlock();` && lines[j + 2] === `${ind}}`)) {
    if (++j >= lines.length) throw new Error('matching finally not found');
  }
  lines.splice(j, 3, `${ind}}`);
  lines.splice(i, 2, `${ind}synchronized (context) {`);
  fs.writeFileSync(`${wt}/${BROKER}`, lines.join('\n'));
} else if (mutant === 'BR' || mutant === 'DR') {
  const start = mutant === 'BR' ? '    private final class BindingRenewal implements AutoCloseable {' : '    private final class DispatchRenewal implements AutoCloseable {';
  const endOf = (t) => (mutant === 'BR' ? t.indexOf('    private final class DispatchRenewal implements AutoCloseable {') : t.lastIndexOf('\n}'));
  const cut = (t) => { const s = t.indexOf(start); const e = endOf(t); if (s < 0 || e < s) throw new Error('class bounds'); return [s, e]; };
  const head = show(HEAD, BROKER);
  const base = show(BASE, BROKER);
  const [hs, he] = cut(head);
  const [bs, be] = cut(base);
  fs.writeFileSync(`${wt}/${BROKER}`, head.slice(0, hs) + base.slice(bs, be) + head.slice(he));
} else if (mutant !== 'NONE') {
  throw new Error(`unknown mutant ${mutant}`);
}
const diff = execFileSync('git', ['-C', wt, 'diff', '--stat'], { encoding: 'utf8' }).trim();
console.log(`${mutant}: ${diff.split('\n').pop() ?? 'no change'}`);
