#!/usr/bin/env python3
# VERIFICATION RIG ONLY (PR #13505 round 2): assemble the round-2 PR comment from report-r2.{en,zh}.md + result files.
import re, os
R = '/Users/wenshao/git/pr13505-rig'
C = open(f'{R}/assets.commit').read().strip()
assert re.fullmatch(r'[0-9a-f]{40}', C), C
raw = lambda n: f'https://raw.githubusercontent.com/wenshao/qwen-code/{C}/pr13505/r2/{n}'
IMGS = ['r2-01-fix-verification.png', 'r2-02-shell-capture-parser.png', 'r2-03-suites.png']
tsv = lambda p: [l.rstrip('\n').split('\t') for l in open(p) if l.strip()] if os.path.exists(p) else []
PIPE, DOT = ' | ', ' · '

def suites(zh=False):
    L = (lambda en, cn: cn if zh else en)
    rows = [L('| Run | Arm | Result | Notes |', '| 运行 | 臂 | 结果 | 说明 |'), '| --- | --- | --- | --- |']
    for r in tsv(f'{R}/results/ts.tsv'):
        if r[2] not in ('h2', 'm2'): continue
        note = ''
        if r[3] != 'exit=0':
            note = L('15 s timeouts in hook-scale / one hosted-harness-session case; see A/B', 'hook-scale 15 s 超时 / 一个 hosted-harness-session 用例；见 A/B')
        rows.append(f'| TS `{r[1]}` | {r[2]} | {r[5].strip().replace(PIPE, DOT)} | {note} |')
    t = open(f'{R}/logs/suite-m2.log').read()
    m = max(re.findall(r'Tests run: (\d+), Failures: (\d+), Errors: (\d+), Skipped: (\d+)\s*$', t, re.M), key=lambda x: int(x[0]))
    rows.append(f'| Java `managed-agent-server` surefire | m2 | run {m[0]} · failed {m[1]} · errors {m[2]} · skipped {m[3]} | |')
    for r in tsv(f'{R}/results/it.tsv'):
        if r[1] == 'm2':
            rows.append(f'| Java MySQL ITs (failsafe, native MySQL 8.4.7) | m2 | {r[4].replace("[INFO] ", "")} | ManagedAgentMySqlIT, ToolPublicationRecoveryMySqlIT, WorkspaceSession{{Close,Retention}}MySqlIT, WorkspaceRecoveryMySqlIT |')
    jt = {r[1]: r for r in tsv(f'{R}/results/jtest.tsv')}
    for k, label in (('store-on-mysql-h2-exact', L('PR `ManagedExtensionRecordStoreTest` on native MySQL 8.4.7 (h2 code)', 'PR 的 `ManagedExtensionRecordStoreTest` 原样跑在 MySQL 8.4.7（h2 代码）')),
                     ('j7b-test-on-h2', L('Candidate J7b store test on h2', 'J7b 候选 store 测试（h2）'))):
        if k in jt: rows.append(f'| {label} | h2 | {jt[k][3].replace("[INFO] ", "")} | |')
    rows.append(f'| {L("Candidate T7b authority case on h2", "T7b 候选 authority 用例（h2）")} | h2 | Tests 16 passed (16) | |')
    rows.append(f'| {L("Candidate F3 fix + test (local-shell-stream-result-session)", "F3 候选修复 + 测试（local-shell-stream-result-session）")} | h2 code | {L("with fix 5/5 · without fix 1 failed", "有修复 5/5 · 无修复 1 失败")} | |')
    ab = {}
    fam = {}
    for r in tsv(f'{R}/results/ab-r2.tsv'):
        a = r[2]; ab.setdefault(a, [0, 0]); ab[a][1] += 1
        if r[4] == 'exit=0': ab[a][0] += 1
        fam.setdefault(a, 0); fam[a] += r[6].count('fences recovery') if len(r) > 6 else 0
    if ab:
        txt = ' · '.join(f'{a} {p}/{n} {L("files green", "轮全绿")}, {fam.get(a, 0)} {L("fences failures", "次 fences 失败")}' for a, (p, n) in ab.items())
        rows.append(f'| {L("A/B: whole `hosted-harness-session.test.ts`, interleaved", "A/B：整个 `hosted-harness-session.test.ts` 交替跑")} | base/h2 | {txt} | |')
    return '\n'.join(rows)

def fence_safe(t):
    assert '```' not in t
    return t.rstrip('\n')

en = open(f'{R}/report-r2.en.md').read()
zh = open(f'{R}/report-r2.zh.md').read()
for i, n in enumerate(IMGS, 1):
    en = en.replace(f'(IMG{i})', f'({raw(n)})')
en = en.replace('PATCH_F3', fence_safe(open(f'{R}/candidate-f3.patch').read()))
en = en.replace('TEST_F3', fence_safe(open(f'{R}/candidate-f3-test.patch').read()))
en = en.replace('TEST_J7B', fence_safe(open(f'{R}/candidate-j7b-test.patch').read()))
en = en.replace('TEST_T7B', fence_safe(open(f'{R}/candidate-t7b-test.patch').read()))
en = en.replace('SUITES', suites())
en = en.replace('`RIGLINK`', f'[`assets-pr13505@{C[:8]}/pr13505/r2`](https://github.com/wenshao/qwen-code/tree/{C}/pr13505/r2) (probe, candidate patches, result files)')
zh = zh.replace('SUITES_ZH', suites(zh=True))
for tok in ('IMG', 'PATCH_F3', 'TEST_F3', 'TEST_J7B', 'TEST_T7B', 'SUITES', 'RIGLINK'):
    assert tok not in en and tok not in zh, tok
assert not re.search(r'\\u00[01][0-9a-fA-F]', en + zh), 'control-char escape would be mangled by GitHub'
body = en.rstrip() + '\n\n<details>\n<summary>中文版</summary>\n\n' + zh.strip() + '\n\n</details>\n'
open(f'{R}/comment-r2.md', 'w').write(body)
print(len(body), 'chars')
