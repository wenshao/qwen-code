// PR #13098 design-note consistency check: the English and Chinese notes must
// pin the same decision encoding (compact UTF-8 JSON, exact key order and
// types, lowercase hex SHA-256 without prefix) and the same cumulative
// approval-wait caveat; the code must implement exactly that encoding.
import fs from 'node:fs';

const WT = '/root/git/qwen-code-pr13098';
const en = fs.readFileSync(`${WT}/docs/design/2026-09-30-managed-agent-actions.md`, 'utf8');
const zh = fs.readFileSync(`${WT}/docs/design/2026-09-30-managed-agent-actions.zh-CN.md`, 'utf8');
const code = fs.readFileSync(`${WT}/packages/cli/src/serve/hosted-tool-approval.ts`, 'utf8');

let failures = 0;
const check = (name, cond, detail = '') => {
  console.log(`[${cond ? 'PASS' : 'FAIL'}] ${name}${cond ? '' : ` — ${detail}`}`);
  if (!cond) failures++;
};

const EXAMPLE = '{"v":1,"optionId":"allow","inputRevision":1,"policyRevision":"hosted-tool-approval/1"}';

// Both languages show the identical example byte string.
check('EN shows the exact example decision bytes', en.includes(EXAMPLE));
check('ZH shows the exact example decision bytes', zh.includes(EXAMPLE));

// Both pin key order and types: v and inputRevision numbers, strings for the
// rest; compact (no whitespace / trailing newline).
check('EN pins compact JSON, key order, no whitespace/newline', /JSON\.stringify\(\{ v: 1, optionId, inputRevision, policyRevision \}\)/.test(en) && /without whitespace or a trailing newline/.test(en));
check('ZH pins compact JSON, key order, no whitespace/newline', zh.includes('JSON.stringify({ v: 1, optionId, inputRevision, policyRevision })') && zh.includes('不含空白或末尾换行'));
check('EN pins v/inputRevision as JSON numbers, optionId/policyRevision strings', /`v` and\s+`inputRevision` are JSON numbers/.test(en) && /`optionId` and `policyRevision`\s+are strings/.test(en));
check('ZH pins v/inputRevision as JSON numbers, optionId/policyRevision strings', zh.includes('`v` 与 `inputRevision` 是 JSON 数字') && zh.includes('`optionId` 与 `policyRevision` 是字符串'));
check('EN pins inputRevision from the Action record, not the checkpoint string', /Action record's own\s+value, not the checkpoint's string revision/.test(en));
check('ZH pins inputRevision from the Action record, not the checkpoint string', zh.includes('Action 记录自身的值，而非 checkpoint 中的字符串版本'));

// Both pin the digest form.
check('EN pins lowercase hex SHA-256 without sha256: prefix', /lowercase hexadecimal\s+without a `sha256:` prefix/.test(en));
check('ZH pins lowercase hex SHA-256 without sha256: prefix', zh.includes('不带 `sha256:` 前缀的小写十六进制'));

// Both describe the queue recheck for decision AND expiry writes.
check('EN says decision and expiry writes recheck inside the serial queue', /Both decision and expiry writes recheck this condition inside the authority[’']s serial queue/.test(en.replace(/\n/g, ' ')));
check('ZH says decision and expiry writes recheck inside the serial queue', zh.includes('决定和过期写入都会在 authority 的串行队列内重新检查该条件'));

// Both carry the cumulative approval-wait caveat with the same bounds.
check('EN cumulative-wait caveat: asked calls x timeout x up to 16 rounds, no budget', /cumulative approval waiting can approach the\s+number of asked calls times the timeout, across up to 16 model rounds/.test(en) && /no cumulative\s+approval-wait budget/.test(en));
check('ZH cumulative-wait caveat: asked calls x timeout x up to 16 rounds, no budget', zh.includes('累计审批等待可接近询问次数乘以超时，跨越每个 Turn 最多 16 轮模型回复') && zh.includes('没有累计审批等待预算'));

// The code implements exactly the documented encoding, in key order.
const impl = code.match(/JSON\.stringify\(\{[^}]+\}\)/);
check('code decisionBytes uses the documented compact stringify', impl?.[0] === 'JSON.stringify({ v: 1, optionId, inputRevision, policyRevision })', impl?.[0]);
check('code digest is plain lowercase hex SHA-256 (no prefix)', /createHash\('sha256'\)\.update\(bytes\)\.digest\('hex'\)/.test(code));

// And the computed digest of the documented example is stable.
import { createHash } from 'node:crypto';
const digest = createHash('sha256').update(Buffer.from(EXAMPLE, 'utf8')).digest('hex');
console.log(`[info] sha256 of the documented example bytes: ${digest}`);
check('example digest is deterministic lowercase hex', /^[0-9a-f]{64}$/.test(digest));

console.log(failures === 0 ? '[summary] ALL PASS' : `[summary] ${failures} FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
