# PR #13166 — 维护者验证第 6 轮（head `0d6a6307`，Linux x86_64）

接续[第 5 轮](https://github.com/QwenLM/qwen-code/pull/13166#issuecomment-5992523772)（`0ce55064`，macOS arm64）的增量验证。
此后的新提交：`c1bb0b2f`（R9-1）、`0d6a6307`（R10-1、R11-1、R11-2、R11-3），以及四次合入 main。

## 装置

- Linux 6.12 x86_64，16 核，Node 22.22.2，JDK 21，MySQL 8.4.11（docker，tmpfs，关闭 binlog）。
- 从 head 构建的 Spring server jar（`managed-agent-server`，迁移到 V45）：Session Store + 内嵌 Runtime Broker；
  使用仓库自带的 `trusted-actor-header`（open 模式、仅回环）代替前几轮未公开的 adapter。
  Broker 保留生产默认值：`durable-local-process=true`、`trusted-local-reboot-recovery=true`（前几轮在 macOS 上必须关闭）。
- 打包的 Hosted Harness（`dist/cli.js serve --profile hosted-harness`），在 `/session` 上显式传 `toolProfile`；脚本化的 OpenAI 兼容模型。
- worker 本地的兄弟注册表由直连的真实 worker 进程验证（`dist/cli.js managed-runtime-worker`，boot v2 走 stdin，
  workspace-capability digest）；Java Broker 给每个 Workspace Session 单独一个 worker，走不到这段代码。
- 对照臂：`head` = `0d6a6307`；`before` = `ee0a962d`（修复提交的父提交，lockfile 相同）；
  `merged` = head 与 main `9cdb0f38` 的本地合并（`01574e3c`，无冲突）。

## 图

| 文件 | 内容 |
| --- | --- |
| `r6-01-fixes.png` | 真实 worker 进程上 R10-1 / R11-1 / R11-2 / R11-3 的修复前后对比（`data/w1/`） |
| `r6-02-r10-realstack.png` | 经 Harness → Java Broker → worker 的 R10-1；持久化记录扫描（`data/g1-head`、`data/g2-base`） |
| `r6-03-pattern-oracle.png` | 遗留问题：通过 pattern 拼写仍存在逐 pattern 的存在性 oracle（`data/w1/`） |
| `r6-04-regression.png` | 第 1–5 轮回归探针在 Linux 上重跑（`data/g3-head`），变异记录（`data/mutation`） |

## 数据

- `data/w1/w1-{base,head}.{jsonl,log}`：每次 worker 调用的状态与文本（挂载路径替换为 `<MOUNT>`）以及 `leaksMount` 标记。
- `data/g1-head`、`data/g2-base`：S25（真实栈上的 R10-1），files/2 与 files/1，含逐表持久化扫描。
- `data/g3-head`：`run-r6-g3-head.log` 及各探针日志（S1–S6、S9、S16、S18、S19、S22、S23*）。
- `data/mutation`：`ledger.jsonl`（M1–M4、G1、E1、两个基线）及每次运行输出；源码逐字节还原。
- `data/unit/unit-merged-summary.json`：合并树 cli 1439/1440（1 skipped，10 个套件），core 92/92（3 个套件）。

## Harness

`harness/` 含装置脚本（`spring.sh`、`node-wrap.sh`、`build-java.sh`、已脱敏的 `rig.env`），`harness/probe/` 含：
`lib.mjs`（第 1–5 轮探针库的 Linux 移植）、`w1-worker.mjs`（直连 worker）、`s25-r10-realstack.mjs`、`run-r6.sh`（回归）、
`mutate-r6.py`、`figures-r6.mjs`，以及复用的前几轮探针。

未覆盖：Windows、本轮的 macOS、`shell/2` 发布模式（`captureBytes`，无 OSS 后端）、跨 worker 的兄弟保密（文档已声明不在范围内）、
`/2` Session 上的 W2 改目录（#13247；公开 connector 固定 `/1`）。
