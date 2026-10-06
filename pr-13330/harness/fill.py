#!/usr/bin/env python3
"""Fills comment.tmpl.md -> comment.md (raw image URLs) and REPORT*.md (relative paths)."""
import sys
from pathlib import Path

P = Path('/root/verify/pr13330/publish')
sha = sys.argv[1] if len(sys.argv) > 1 else 'SHA'
fixfull = (Path('/root/verify/pr13330/results/fix-full-summary.txt').read_text().strip())
raw = f'https://raw.githubusercontent.com/wenshao/qwen-code/{sha}/pr-13330'
tree = f'https://github.com/wenshao/qwen-code/tree/{sha}/pr-13330'
imgs = {1: 'fig1-close-fence.png', 2: 'fig2-tool-item-identity.png', 3: 'fig3-reachability.png',
        4: 'fig4-operability.png', 5: 'fig5-mutation.png', 6: 'fig6-candidate-fix.png'}

MUT = """![mutation]({{IMG5}})

- **Negative control.** I compiled the PR's changed test classes against the base production code. Of 82 tests, exactly the **7 new witnesses** go red: 3 for the connector, 2 for the broker (fence and k8s wording), 1 for the lease and 1 for the identity. `MessageMaterializerTest` cannot compile against base because it uses the new interface method.
- **17 mutants on head, each run against the full unit suite: 13 killed.** The 4 survivors show where the tests are blind:
  - **m06** makes `drain()` retire unconditionally, which is the base behaviour, and it **survives**: no test tells the PR's conditional apart from the always-retire it replaced. Given the real `CLOSING` ordering, always-retire is the behaviour that is actually correct. **m07** makes `drain()` never retire, which is what really happens at head, and it is killed only because `drainStillRetiresAClosedSessionInProcess` mocks the row as `CLOSED`.
  - **m01** drops the rename cause. No test covers it, and it has no observable effect anyway (item 7).
  - **m16 and m17** make the `deferMaterializationTarget` SQL a no-op, or also bump `covered_sequence` (which breaks the gap guard). Nothing pins the store method, because `MessageMaterializerTest` mocks the store. A JDBC-level test asserting that `updated_at` moves and `covered_sequence` does not would cover both."""

MUT_ZH = """![mutation]({{IMG5}})

- **负对照。** 我把 PR 改动的测试类放到 base 生产代码上编译运行。82 个测试中，红的恰好是 **7 个新增见证**：连接器 3 个，broker 2 个（围栏与 k8s 文案），lease 1 个，身份 1 个。`MessageMaterializerTest` 用到了新接口方法，在 base 上无法编译。
- **在 head 上做 17 个变异，每个都跑全量单测：杀死 13 个。** 存活的 4 个暴露了测试的盲区：
  - **m06** 让 `drain()` 无条件退休（即 base 的行为），结果**存活**：没有测试能区分 PR 的条件退休和它所替换的"总是退休"。而结合真实的 `CLOSING` 时序，"总是退休"才是真正正确的行为。**m07** 让 `drain()` 从不退休（这正是 head 上实际发生的情况），它被杀死只是因为 `drainStillRetiresAClosedSessionInProcess` 把行 mock 成了 `CLOSED`。
  - **m01** 去掉 rename 的 cause。没有测试覆盖它，而且它本来就没有可观测效果（第 7 项）。
  - **m16 和 m17** 让 `deferMaterializationTarget` 的 SQL 变成空操作，或额外推进 `covered_sequence`（这会破坏 gap 守卫）。没有任何测试钉住这个 store 方法，因为 `MessageMaterializerTest` mock 了 store。加一个 JDBC 层测试，断言 `updated_at` 变化而 `covered_sequence` 不变，就能同时覆盖这两点。"""

FIX = """![candidate fix]({{IMG6}})

The patch touches two files ([diff]({{DIFF}})):

1. `HarnessEventProjector` keeps the callId branch as `turnId + ":" + callId`, which is `EventIdentity` v1, so the published result and every stored id agree. Only the no-id fallback moves, to `turnId + "#source:" + sourceId`, which no `turnId:callId` can spell. The PR's own collision test stays green.
2. The broker resolver fences `CLOSING`, `CLOSED`, `ARCHIVING`, `ARCHIVED`, `DELETING` and `DELETED` durably, and `drain()` keeps an in-process entry only when the row has vanished.

With the patch applied, every non-ACTIVE cell of Fig. 1 refuses in both phases, all three identity scenarios merge into one item, and the full unit suite is **{{FIXFULL}}**. I left the backoff cap and the rename logging to the author."""

FIX_ZH = """![candidate fix]({{IMG6}})

补丁只涉及两个文件（[diff]({{DIFF}})）：

1. `HarnessEventProjector` 的 callId 分支保持 `turnId + ":" + callId`，即 `EventIdentity` v1 规则，这样发布的结果与所有已存 id 一致。只有无 id 的兜底分支改为 `turnId + "#source:" + sourceId`，任何 `turnId:callId` 都拼不出这个形式。PR 自带的冲突测试保持绿色。
2. broker 的 resolver 对 `CLOSING`、`CLOSED`、`ARCHIVING`、`ARCHIVED`、`DELETING`、`DELETED` 做持久围栏；`drain()` 只在行已消失时才保留进程内条目。

应用补丁后，图 1 中所有非 ACTIVE 的格子在两种阶段下都拒绝，三种身份场景都合并为一个 item，全量单测 **{{FIXFULL}}**。退避上限和 rename 日志留给作者处理。"""

AARCH64 = ("On aarch64 (Orange Pi, JDK 21), a same-load A/B with 4 suites in parallel passes on both arms "
           "(base 725/725 twice, head 736/736 twice). During the 3-way mutant sweep, `RuntimeBrokerDefaultOnTest` "
           "failed in 13 of the 19 head-based runs, including the unmutated control, whatever the mutant. This is a "
           "timing race in that test: the direct `recoverSavedRuntimes()` call returns early while the startup "
           "`@Scheduled` scan holds `running`, so the spy sees no call. I can't attribute it to this PR, which does "
           "not touch that path, but it is worth a follow-up, for example `verify(timeout(...))` or disabling the "
           "scheduler in that test.")
AARCH64_ZH = ("aarch64（Orange Pi，JDK 21）上，4 个套件并行的同负载 A/B 中两臂都通过（base 两次 725/725，"
              "head 两次 736/736）。在 3 路并行的变异扫描中，`RuntimeBrokerDefaultOnTest` 在 19 次基于 head 的运行里失败了 "
              "13 次（包括未变异的对照组），与变异内容无关。这是该测试自身的时序竞态：启动时的 `@Scheduled` 扫描占着 "
              "`running` 标志时，测试直接调用的 `recoverSavedRuntimes()` 会提前返回，于是 spy 没有收到任何调用。"
              "本 PR 没有改动这条路径，无法归因于它，但值得另行跟进，例如改用 `verify(timeout(...))`，"
              "或在该测试中禁用调度器。")


def fill(text, link, tree_link=tree):
    text = (text.replace('{{MUTATION}}', MUT).replace('{{MUTATION_ZH}}', MUT_ZH)
            .replace('{{FIX}}', FIX).replace('{{FIX_ZH}}', FIX_ZH)
            .replace('{{AARCH64}}', AARCH64).replace('{{AARCH64_ZH}}', AARCH64_ZH)
            .replace('{{M3}}', 'm03/m04 killed').replace('{{FIXFULL}}', fixfull)
            .replace('{{SHORT}}', sha[:8]).replace('{{TREE}}', tree_link))
    for n, name in imgs.items():
        text = text.replace('{{IMG%d}}' % n, link(name))
    return text.replace('{{DIFF}}', link('data/candidate-fix.diff'))


tmpl = (P / 'comment.tmpl.md').read_text()
(P / 'comment.md').write_text(fill(tmpl, lambda name: f'{raw}/{name}'))
report = fill(tmpl, lambda name: name, '.')
en, zh = report.split('<details>', 1)
(P / 'pr-13330/REPORT.md').write_text(en.strip() + '\n')
zh_body = zh.split('</summary>', 1)[1].rsplit('</details>', 1)[0]
(P / 'pr-13330/REPORT.zh-CN.md').write_text(zh_body.strip() + '\n')
print('filled', sha, len((P / 'comment.md').read_text()), 'chars')
