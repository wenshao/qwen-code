**Verdict: `merge-ready`** — 139/139 scripted assertions passed, 0 failed; verified head `b94f5917dfec61ffb3cbbcac786d8da778498cbf`, base `89fe54406d61b16414d1614fcf987a212ddb9527`.

<details>
<summary>中文摘要</summary>

**结论：`merge-ready`（可合入）。** 验证的 head 是 `b94f5917`（本轮开始时 head 为 `a8c264f7`，验证过程中被作者推进一步并改动了生产代码，因此**所有数据都在新 head 上重新测量**），base 是 `89fe5440`；139 条脚本化断言全部执行并通过，0 失败。

- **中心主张被 A/B 证实。** 用真实 `LlmContentGenerator` + 真实 `@google/genai` 客户端打到本地回环服务，该服务按 Gemini 真实约束（`function_response.parts` 只允许 `inlineData`/`fileData`）返回 400 `INVALID_ARGUMENT`。6 类历史形状 × 非流式/流式共 12 格：**base 12/12 被拒**（报错文本与 PR 引用的一致：`Unknown name "text" at 'request.contents[...].function_response.parts[0]': Cannot find field.`），**head 12/12 返回 200**，且 head 发出的嵌套分片只含两个合法字段（见 `ab-table` 与图 `01-ab-wire-schema-base-vs-head.png`）。
- **信息没有丢。** 移出 `parts` 的说明文本进入 `functionResponse.response.output`（已有字符串则追加、空串不加前导换行），`output` 为非字符串对象时写入 `notes`（若该键已被非字符串占用，则改用 `_notes`…）；无合法媒体时整个 `parts` 字段省略。调用方历史在两条臂上均未被原地修改。
- **同类缺陷的兄弟入口一并堵住。** 除 `text` 外，base 还会把 `thought`、`videoMetadata` 等非 `FunctionResponsePart` 字段原样带上 wire（同一类 400），head 只保留白名单字段；新增的大小写/空白 MIME 归一化与字符串分片处理也已经被各自的用例钉住（见变体 m6/m7/m8/m9）。
- **测试承重性：10 个变体中 9 个被杀死**（含正对照 m0，杀死 6 个用例），基线与还原后均为 56/56 绿；唯一存活的是 `notes` 已有值时的**追加**分支（m4），属覆盖面缺口而非缺陷，见 S1。
- **建议（非阻塞）：** S1 补一条"`response.notes` 已有内容 + 新说明"的用例；S2 `response` 若越界为字符串/数组会被展开成 `{"0":"r",…}`（仓库内所有写入点都构造对象，当前不可达，属加固）。
- **未覆盖：** 未调用真实线上 Gemini（用回环假服务复刻拒收语义）；未做与 main 最新提交的试合（base 即 PR 记录的 `baseRefOid`）；本地 `node_modules` 为 v0.26.3 期安装（`@google/genai` 2.6.0 与 base 的 pin 一致，两条臂的**源码文件**为精确 SHA 并经 API blob 校验）；本轮在工作站直接执行，未使用凭据隔离容器；未跑全量 core 套件与 Windows/macOS CI 矩阵。

</details>

## Head movement during this round

The round started at `a8c264f7`; a first full pass (A/B, boundary probes, an 8-mutant matrix) completed there. The pre-post guard then reported the head had advanced to `b94f5917` with **production** changes — `llm-content-generator.ts` +47/−24, plus `llm-content-generator.test.ts` +52 and `llm-content-generator.compat.test.ts` +282 — and a new author comment describing an adversarial audit round. Per the move rule this is not a merge-only or test-only delta, so **every measurement below was re-run at `b94f5917`**: the arm trees were rebuilt from that commit (production and test files verified byte-identical to the GitHub blobs), and the a8c264f7 numbers are superseded and not quoted.

## Central claim and the A/B

The PR exists so that a tool response carrying unsupported media, an upstream text placeholder, a nested string, or any other non-schema field never reaches Gemini with an invalid key inside `function_response.parts`. The description names the mechanism (unsupported audio/video converted in place to `{ text }`, upstream placeholders passed through) and the symptom (HTTP 400 `INVALID_ARGUMENT`).

Instrument: the **real** `LlmContentGenerator` imported from each arm's own tree, with the **real** `@google/genai` client (`httpOptions.baseUrl` seam → `http://127.0.0.1:<port>`), against a loopback server that parses the request body and answers 400 with the upstream error shape whenever a nested `function_response.parts` entry carries a key other than `inlineData`/`fileData` (or a `displayName` inside them). Each cell asserts the outcome **its own arm is predicted to produce**, so a base rejection is a passing cell.

<a id="ab-table"></a>

| fixture | shape | base (unary + stream) | head (unary + stream) |
| --- | --- | --- | --- |
| `f1-video-only` | the reported shape: `video/webm` inlineData tool result | **400 ×2** — `parts:[{text:"Unsupported media type…"}]` | **200 ×2** — `parts` omitted, note kept in `output` |
| `f2-mixed-media` | image/jpeg + audio/wav + video/mp4 | **400 ×2** | **200 ×2** — only image/jpeg retained, both notes appended in order |
| `f3-upstream-text-and-file` | compaction placeholder + video fileData + pdf fileData, `response={error}` | **400 ×2** | **200 ×2** — pdf retained (displayName stripped), output = placeholder + video note |
| `f4-non-string-output` | placeholder + `response.output={ok:true}` | **400 ×2** | **200 ×2** — object `output` kept, note under `response.notes` |
| `f5-part-with-media-and-text` | one nested part with both media and text | **400 ×2** | **200 ×2** — media retained, text appended to output |
| `f6-non-text-unknown-fields` | nested `{inlineData, thought:true, videoMetadata}` | **400 ×2** — violations `thought`, `videoMetadata` | **200 ×2** — only inlineData reaches the wire |
| `control-plain-text` | ordinary user turn | 200 | 200 |

Totals: **head 82/82 assertions, base 44/44** (`RESULT base pass=44 fail=0`, `RESULT head pass=82 fail=0`). Cross-mode cells confirm streaming and unary send identical `functionResponse` objects (6/6 on both arms), so the fix covers both request paths. Witness: `01-ab-wire-schema-base-vs-head.png` re-runs the twelve `status`/`schema` cells on both arms.

## Findings

### S1 — the `notes` append branch is not pinned by any test (coverage gap, not a defect)

Mutant `m4` replaces the pre-existing-`notes` append with a plain overwrite:

```ts
typeof existingNote === 'string' && existingNote
  ? `${existingNote}\n${joinedText}`
  : joinedText,   →   joinedText,
```

The suite stays **56/56 green**. Behaviour at head is correct; the concatenation half of the ternary has no witness, because the only fixture that reaches `notes` supplies no pre-existing value. A test with `response.notes = 'earlier note'` plus one extracted text entry would pin it.

Reproduce: `bash tmp/pr18220-verify-20261124-120927/mutants2/run-matrix.sh` (see `02-mutation-matrix-head-tests.png`).

### S2 — a non-object `functionResponse.response` is shredded into indexed keys (hardening, currently unreachable)

Every sub-case spreads `nextFunctionResponse.response`. Boundary probes at head:

| `response` value | wire result |
| --- | --- |
| `null` + audio note | `{"output":"Unsupported media type…"}` — fine |
| `'raw-string-output'` + audio note | `{"0":"r","1":"a",…,"16":"t","output":"…"}` — **corrupted** |
| `['a','b']` + audio note | `{"0":"a","1":"b","output":"…"}` — **corrupted** |
| `{output:''}` + audio note | `{"output":"Unsupported media type…"}` — fine, no leading newline |
| `{output:'content'}`, `parts: []` | `parts` omitted (base emitted `parts: []`) |

`functionResponse.response` is typed `Record<string, unknown>` and every in-repo constructor builds an object literal (`tools/mcp-tool.ts`, `tools/agent/fork-subagent.ts`, `followup/speculation.ts`, …), so the two corrupting rows are **not reachable today** — a note about the expression's type boundary, not a live defect. A plain-object check before the spread would make it total.

Rerun: `GEN_PATH=<head arm>/…/llm-content-generator.ts ARM=head node --import tsx harness-boundary.ts`.

### Observation — the description's test count is stale

The description reports "Vitest unit suites (78/78 passed)". At the verified head the generator directory holds four files totalling **91** tests (`llm-content-generator.test.ts` 56, `compat.test.ts` 26, `index.test.ts` 6, `transport.test.ts` 3), all passing. Not a defect; the quoted number is not reproducible at this head.

## Test-quality check (mutation matrix at `b94f5917`)

The baseline gate runs with the same runner, environment and file selection as the mutants: `Tests 56 passed (56)`. Then one production clause per mutant, restored from the worktree index after each run; the restored tree ends green (56/56).

| mutant | clause changed | result | killing assertion |
| --- | --- | --- | --- |
| `m0` (positive control) | `result.functionResponse = nextFunctionResponse` → no-op | **killed (6)** | all five new/updated tests |
| `m1` | text extraction condition never true | **killed (5)** | the five text/notes tests |
| `m2` | always emit `parts`, even when empty | **killed (2)** | `drops functionResponse.parts when all nested parts are unsupported video…` |
| `m3` | overwrite `output` instead of appending | **killed (1)** | `moves unsupported audio and video notes…` |
| `m4` | `notes` append → overwrite | **survived** | — → S1 |
| `m5` | drop the `output === undefined` branch | **killed (1)** | `moves upstream text entries and unsupported fileData…` |
| `m6` | retain `converted.inlineData` whole instead of the field whitelist | **killed (2)** | `should strip displayName…`, `handles case-insensitive…unknown nested fields` |
| `m7` | drop raw string nested entries | **killed (1)** | `handles case-insensitive audio/video MIME types, raw string entries…` |
| `m8` | drop MIME `toLowerCase()` normalisation | **killed (1)** | same |
| `m9` | drop the `notes` key-collision search | **killed (1)** | same |

9/10 pinned. The positive control proves the runner can turn the suite red, and each kill names the assertion that fired. The four guards the `b94f5917` commit added (whitelist rebuild, string entries, MIME normalisation, notes key search) are each individually pinned.

## Not covered

- **No live Gemini call.** The oracle is a loopback server reproducing the upstream rejection semantics and schema constraint; compliance with the real endpoint is inferred, not measured.
- **No trial merge onto the current main tip.** The base arm is the PR's recorded `baseRefOid` (`89fe5440`); commits landing on `main` afterwards are not exercised. The PR touches one production file plus its tests, so the merge surface is small.
- **Dependency set.** The arms' *source* trees are the exact SHAs (production file verified byte-identical to the GitHub blob), but they run against this workstation's `node_modules` (v0.26.3-era; `@google/genai` 2.6.0, the version both base and head pin). Other packages' lockfile drift in the same window is not reflected.
- **Isolation.** PR code executed directly on the workstation: `verify-pr-prepare` reported `isolation  none detected`, and no credential-free container was used. The PR is first-party (author `wenshao`); the executed surface is one TypeScript module plus its test files.
- Full `packages/core` suite, Windows/macOS CI lanes, and the `Managed loop` / `TUI parity` checks were not re-run locally. CI at the previous head showed `Lint & Static` and the Managed jobs green.

## Methodology

Sparse worktrees of `89fe5440` (base) and `b94f5917` (head) under `tmp/pr18220-base` / `tmp/pr18220-head2` hold `packages/core` plus root manifests; `node_modules` is symlinked from the workstation and the generator is imported by absolute path from each arm's own tree, so no `@qwen-code/*` link can substitute one arm for the other. `harness.ts` drives the 6 fixtures × {unary, streaming} through the real SDK to the loopback oracle and asserts per-arm expectations (parts compared with a key-order-insensitive canonicalisation); `harness-boundary.ts` probes the type boundaries; `mutants2/run-matrix.sh` runs the ten mutants against the head test file. Raw logs: `mutations-head2.log`, harness stdout in the run artifacts, `evidence/01-ab-wire-schema-base-vs-head.png`, `evidence/02-mutation-matrix-head-tests.png`.
