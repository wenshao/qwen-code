// Claim checker for the bilingual design docs + the code they describe.
// Run once on the PR head (expect all pass) and once on the base docs
// (planted-falsehood control: the changed-claim rows must fail).
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import postcss from 'postcss';

const dir = path.dirname(new URL(import.meta.url).pathname);
const repo = '/root/git/qwen-code-verify';
const mode = process.argv[2] ?? 'head';
const suffix = mode === 'head' ? 'head' : 'base';
const en = readFileSync(path.join(dir, `${suffix}-en.md`), 'utf8');
const zh = readFileSync(path.join(dir, `${suffix}-zh.md`), 'utf8');

const item5 = (text, startRe, endRe) => {
  const s = text.search(startRe);
  const rest = text.slice(s);
  const e = rest.search(endRe);
  return e < 0 ? rest : rest.slice(0, e);
};

const checks = [];
const check = (name, fn) => {
  try {
    const ok = Boolean(fn());
    checks.push({ name, ok, error: ok ? null : 'assertion false' });
  } catch (e) {
    checks.push({ name, ok: false, error: String(e).slice(0, 200) });
  }
};
const has = (t, re) => () => re.test(t);
const lacks = (t, re) => () => !re.test(t);
const within = (t, startRe, endRe, re) => () => re.test(item5(t, startRe, endRe));

check('en-old-blue-claim-absent', lacks(en, /blue for other active work/));
check('en-new-green-claim', has(en, /green for other active work/));
check('en-blue-reserved-completed-unread', has(en, /blue stays reserved for completed-unread/));
check('en-acceptance-order', has(en, /turn running > background-only amber > other active work/));
check('en-acceptance-blue', within(en, /^5\. Dot precedence/m, /^6\. /m, /blue reserved for\s+completed-unread/));
check('en-acceptance-no-unchanged', lacks(item5(en, /^5\. Dot precedence/m, /^6\. /m), /unchanged/));
check('en-acceptance-touch-hover', within(en, /^5\. Dot precedence/m, /^6\. /m, /touch layout[\s\S]*hover contracts/));

check('zh-old-blue-claim-absent', lacks(zh, /其他活跃工作为蓝色/));
check('zh-new-green-claim', has(zh, /其他活跃工作同样为绿\s*色/));
check('zh-blue-reserved-completed-unread', has(zh, /蓝色仅保留给完成未读/));
check('zh-acceptance-order', has(zh, /回合在跑 > 仅后台任务琥珀色 > 其他活跃工作/));
check('zh-acceptance-blue', within(zh, /^5\. 圆点优先级/m, /^6\. /m, /蓝色仅保留给完成未读/));
check('zh-acceptance-no-unchanged', lacks(item5(zh, /^5\. 圆点优先级/m, /^6\. /m), /均不变/));
check('zh-acceptance-touch-hover', within(zh, /^5\. 圆点优先级/m, /^6\. /m, /触屏布局[\s\S]*悬停契约/));

// Structure parity (passes on both arms on purpose).
const count = (t, re) => (t.match(re) ?? []).length;
check('bilingual-heading-parity', () => count(en, /^## /gm) === count(zh, /^## /gm));
check('bilingual-acceptance-length-parity', () => count(en, /^\d+\. /gm) === count(zh, /^\d+\. /gm));
check('bilingual-reciprocal-links', () => /\.zh-CN\.md/.test(en) && /background-work-indicator\.md/.test(zh));

// The code the docs describe, read at the verified head.
const head = '00b0c34f448d3167795dec7bd9df62d983fa59c2';
const css = execFileSync('git', ['-C', repo, 'show', `${head}:packages/web-shell/client/components/sidebar/WebShellSidebar.module.css`], {
  encoding: 'utf8',
});
const tsx = execFileSync('git', ['-C', repo, 'show', `${head}:packages/web-shell/client/components/sidebar/WebShellSidebar.tsx`], {
  encoding: 'utf8',
});
const root = postcss.parse(css);
const decl = (selector) => {
  let value;
  let index = -1;
  root.walkRules((rule) => {
    if (rule.parent.type !== 'root' || rule.selector !== selector) return;
    rule.walkDecls('color', (d) => {
      value = d.value;
      index = root.index(rule);
    });
  });
  return { value, index };
};
const base = decl('.sessionStatusDot');
const running = decl('.sessionStatusDotRunning');
check('css-base-dot-uses-unread-blue-token', () => base.value === 'var(--agent-blue-500)');
check('css-running-dot-uses-success-token', () => /^var\(--success-color\b/.test(running.value));
check('css-running-rule-follows-base-rule', () => running.index > base.index);
check('component-completed-unread-base-class-only', () =>
  /completedUnread[\s\S]{0,220}className=\{styles\.sessionStatusDot\}/.test(tsx),
);
check('component-active-work-adds-running-class', () =>
  /sessionWorkActive[\s\S]{0,400}styles\.sessionDotRunning|sessionWorkActive[\s\S]{0,400}styles\.sessionStatusDotRunning/.test(tsx),
);

const failed = checks.filter((c) => !c.ok);
for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.error ? `  (${c.error})` : ''}`);
console.log(`\n${mode}: ${checks.length - failed.length}/${checks.length} pass`);
writeFileSync(path.join(dir, `docs-${mode}.json`), JSON.stringify(checks, null, 2));
