## 在 `c682c618` 上的本地端到端复验（真实 daemon + 真实 Web Shell，PR 与 merge base 对照）

我在 `bf4e49d` 时验证过一次（[评论 5524238558](https://github.com/QwenLM/qwen-code/pull/10885#issuecomment-5524238558)）。此后又落了 10 轮 review、10 个修复提交。最后两个提交 —— `eb86348329` *fix(cron): harden one-shot restoration* 和 `6ddb06d726` —— **落在最后一轮 review 之后**，而之后的两次 review 运行都超时了，所以没有任何一轮检查过它们。这次复验针对当前 head，重点确认这两个提交是否真的关掉了 review ledger 里仍然挂着的 Critical。

**环境。** 两个 worktree（head `c682c618`、merge base `5014a091ab`），各自 `npm ci` 构建出自己的 `dist/cli.js`；各自跑一个 `qwen serve`，隔离的 `QWEN_HOME`、两个工作区（`--workspace A --workspace B`）、三个 `modelProviders` 条目，后端指向一个会记录每次请求 `model` 字段的脚本化 OpenAI 兼容服务器；Chrome 通过 Playwright 驱动 daemon 自带的 Web Shell。下文所有模型断言都取自**线上实际请求**，分组断言取自 `session-organization.v1.json`，调度断言取自 `scheduled_tasks.json`，都不是从 UI 读的。

**结论：可以合并。** 所有功能声明都能复现，两条派发路径、两个工作区都成立。review ledger 里仍未关闭的 5 条 Critical 中，**3 条在当前 head 已经关闭**（其中两条由 `eb86348329` 修复，而这个提交落在最后一轮能看到它的 review 之后），我没能把它们中的任何一条重新打开。另外 2 条确实可复现；两条都是 fail-closed，都不丢数据，影响范围见下。另外，我在第 1 轮提出的那个行为至今未变，也是我最希望修掉的一条。

---

## 1. ledger 中仍未关闭的 5 条 Critical

| ledger 条目 | 在 `c682c618` 的状态 | 依据 |
| --- | --- | --- |
| `Session.ts:8845` —— 模型应用失败时被消费的 one-shot 被静默销毁 | **已关闭** | 真实时钟触发（1a） |
| `cronScheduler.ts:903`（R8-1 第 10 轮）—— 恢复后的 one-shot 在首次编辑或重启时被误判为 missed | **已关闭** | 实测，并带阳性对照（1b） |
| `cronScheduler.ts:1375`（R10-1）—— `removeCronTasks` 不推进代数，导致 restore 复活已删除任务 | **已关闭** | 跨进程观察到持久化 tombstone；否决逻辑由变异测试钉住（1c） |
| `cronScheduler.ts:1387` —— 恢复后的 one-shot 会在之后每一个 cron 匹配点重新触发 | **可复现** | 实测，4 分钟 4 次（F2） |
| `scheduled-tasks.ts:1433` —— PATCH 拒绝对话框回传的过期 `groupId` | **可复现** | 通过真实 UI 端到端复现（F3） |

### 1a. 模型无法应用的 one-shot 会被恢复，而不是被消费

一个持久化的 `recurring: false`、`sessionMode: per_run` 任务，指定 `coder-model(qwen-oauth)`（已配置但无凭据的 provider），由真实时钟触发：

```
[serve] method: 'session/set_model'  modelId: 'coder-model(qwen-oauth)'
[reconcile] session=91a319f3… target=model action=skipped reason=roundtrip_failed
qwen serve: create_sub_session failed: sub-session model selection failed: coder-model(qwen-oauth)

触发后的 scheduled_tasks.json：
  { "id": "iah7aikp", …, "recurring": false, "lastFiredAt": 1788805920000,   ← 触发的那一分钟
    "sessionMode": "per_run", "modelServiceId": "coder-model(qwen-oauth)" }   ← 仍在
会话列表：只有控制器会话 —— 没有孤儿子会话，没有孤儿 transcript
```

任务带着已盖章的时间槽存活下来，任何地方都没有真正执行，回滚也没有泄漏会话。这同时关闭了 R8-1 报告的输入和 R2-1 的 transcript 泄漏。

### 1b. 恢复后的 one-shot 能扛过编辑和重启，而 missed 检测本身仍然有效

第 10 轮的阻塞点是：抑制标记只存在于进程内存里，所以一次仅改 prompt 的编辑、或一次会话重启，都会把恢复的任务重新判为 missed、再次删除，并投递一条虚假的「missed while Qwen Code was not running」载荷。在当前 head 上，`eb86348329` 加的持久化时间戳挡住了：

```
PATCH { prompt }（只改 prompt，不动 cron / enabled） → 200
+4s（超过 FILE_DEBOUNCE_MS）后读盘：任务仍在，prompt 已更新，无 missed 载荷
重启 daemon（全新 CronScheduler，restored-id 集合为空）
重启后读盘：任务仍在
```

**阳性对照** —— 同一次加载必须仍然会删除一个真正错过的 one-shot，否则上面的结果就是空的。我手工注入了 `ctrlmiss`（绑定同一会话、`lastFiredAt: null`、cron 槽在 10 分钟前）后重启：

```
加载前：["das6gfn5", "iah7aikp", "ctrlmiss"]
加载后：["das6gfn5", "iah7aikp"]            ← ctrlmiss 作为 missed 被删除
```

说明 missed 检测确实跑了并且生效；恢复的任务是被新增的 `lastFiredAt >= nextFire - jitter` 守卫跳过的，而不是走进了一段死代码。

### 1c. 删除 tombstone 跨进程可见

R10-1 的入口 B 是：代数计数器是模块级的进程内状态，而 DELETE 路由跑在 daemon 里，唯一的读取方却跑在派生的 `qwen --acp` 子进程里。`eb86348329` 把它换成了持久化的 `scheduled_tasks.json.deletions` 文件。实测两个进程都会写它：

```
$QWEN_HOME/tmp/<hash>/: scheduled_tasks.json  scheduled_tasks.json.deletions  scheduled_tasks.lock

ACP 子进程删除 missed one-shot 之后 : {"version":1,"entries":[["ctrlmiss",1]]}
daemon DELETE /scheduled-tasks/abworti0 之后: {"version":1,"entries":[["ctrlmiss",1],["abworti0",1]]}
```

竞态本身我没有实机复现 —— 模型选择失败的窗口是亚秒级的，手工够不着。否决逻辑改由会在变异下变红的测试来钉（下文 M2/M3）。

---

## 2. 功能本身

![表单前后对比](https://raw.githubusercontent.com/wenshao/qwen-code/95b244c57cf5c5830262d9b6fa8994844867bd7e/imgs/01-form-before-after.png)

![表单状态](https://raw.githubusercontent.com/wenshao/qwen-code/95b244c57cf5c5830262d9b6fa8994844867bd7e/imgs/02-form-states.png)

模型下拉由真实 daemon 填充；分组下拉支持不分组 / 已有分组 / **新建分组…**（内联填名称与颜色）；把「运行于」切到「固定会话」后两个下拉都消失（5 个 `<select>`，展开新建分组行时 6 个，→ 3 个）；重新进入「编辑」能正确回显所选值。

![路由后的运行](https://raw.githubusercontent.com/wenshao/qwen-code/95b244c57cf5c5830262d9b6fa8994844867bd7e/imgs/03-routed-run.png)

**两条派发路径都会路由，两个工作区都成立。**「立即运行」（`spawnOrAttach`）与真实时钟触发（ACP `createSubSession`）是两段不同的代码，我都跑了。在**次级**工作区（本轮新加 `runtimeBaseDir` 作用域的那条路径）上，一个 `* * * * *` 任务连续三次真实触发，线上全部是 `fake-max`，三个子会话全部写进 B 的分组，A 的分组存储没有被碰：

```
创建之后的线上模型 : ["fake-max","fake-max","fake-max"]
B 的会话           : 3 × "B minute task · …"  groupId=8b445570…
A 中带 B 分组的会话 : []
```

**校验、持久化与作用域**（全部针对真实 daemon）：

| 检查项 | 结果 |
| --- | --- |
| `POST` 按次运行 + 模型 + 分组 | 201，视图回显且写入 `scheduled_tasks.json` |
| `POST` 固定会话 + 路由字段（显式，或省略 `sessionMode`） | 400 `session_routing_requires_per_run` |
| `POST` 按次运行 + 未知 / 跨工作区 `groupId` | 400 `group_not_found` |
| `POST` 按次运行 + 空串分组 / 129 字符模型 id / 模型 id 含 `\n` | 400 `invalid_group_id` / `invalid_model_service_id` ×2 |
| `POST` 按次运行 + **未知** `modelServiceId` | **201** —— 不做存在性校验，改为在运行时失败 |
| `PATCH {modelServiceId: null, groupId: null}` | 200，视图清空**且**从磁盘删除 |
| 对已路由任务 `PATCH {sessionMode: "persistent"}` | 200，两个路由字段一并从磁盘剥离 |
| daemon 重启 | 路由字段完整重新加载 |
| 任务建好后删掉分组，再运行 | 照常触发、落为无分组、daemon 打日志说明原因 —— fail-open |
| merge-base 对照 | 同样三个 POST 全部被接受（201）且字段被静默丢弃；表单里根本没有这些控件 |

**不可用的模型现在会 fail-closed 并且说得出来** —— 这是我上一轮提的 N2。「立即运行」返回 `500 scheduled_task_session_dispatch_failed`，运行记录带 `sessionDispatchFailed: true`，Web Shell 会渲染出来，并且不留孤儿会话：

![运行失败](https://raw.githubusercontent.com/wenshao/qwen-code/95b244c57cf5c5830262d9b6fa8994844867bd7e/imgs/06-run-failure.png)

---

## 3. 发现

### F1 —— 给某一个任务选模型，仍然会改写整个工作区的默认模型（自第 1 轮起未变；这是我最想修的一条）

![默认模型泄漏](https://raw.githubusercontent.com/wenshao/qwen-code/95b244c57cf5c5830262d9b6fa8994844867bd7e/imgs/04-default-model-leak.png)

同一个 daemon 上跑三次，其它什么都没动：

```
起始 settings.model                              {"name":"fake-plus"}
1) 运行任务 X —— 模型 =「工作区默认模型」          线上: fake-plus   settings: fake-plus
2) 运行任务 Y —— 模型 =「Fake Max」                线上: fake-max    settings: fake-max  ← 被改写
3) 再次运行任务 X —— X 从未被编辑过                线上: fake-max    settings: fake-max
```

问题在第 3 步：任何一个带路由的任务触发之后，表单自己提供的「工作区默认模型」选项就不再有意义了。写入落在**用户级**设置文件，所以在 `--workspace A --workspace B` 下，B 里的任务会连 A 的默认值一起改掉；交互式输入框会在下一次加载时读到新值。而且这在**每一次**时钟触发都会发生，不只是手动点一次。

机制（全部是既有代码，本 PR 只是让它可以被一个循环的无人值守任务触达）：`spawnOrAttach({modelServiceId})` → `applyModelServiceId` → `unstable_setSessionModel` → `Session.setModel`，其 `persistDefault` 默认为 `true`。`acpAgent.setSessionConfigOption` 的 `case 'model'` 早就为同样的理由传了 `{ persistDefault: false }`，所以修法的形状就是把一个不持久化的变体透传下去。

### F2 —— 恢复后的 one-shot 会在之后每一个 cron 匹配点重新触发，且不会自己停（对应 `cronScheduler.ts:1387`）

恢复 one-shot 时会带着已盖章的时间槽写回磁盘，这挡住了同一分钟内的重触发循环 —— 但没有任何东西记录它「已尝试过」，所以它的 cron 表达式下一次匹配时还会再触发。在一个 `recurring: false`、`* * * * *`、模型不可用的任务上实测：

```
t+1min  在盘上=true  lastFiredAt=…807600000   模型选择失败累计=2
t+2min  在盘上=true  lastFiredAt=…807660000   模型选择失败累计=3
t+3min  在盘上=true  lastFiredAt=…807660000   模型选择失败累计=3
t+4min  在盘上=true  lastFiredAt=…807720000   模型选择失败累计=4
```

每一轮都是一次真实的 spawn → 模型失败 → 回滚 → 两次任务文件写。它是收敛的 —— 我确认了**不会累积孤儿会话**（整个过程中会话列表始终只有那一个控制器会话）—— 并且模型一旦可解析、或用户删掉任务，它就停。但 one-shot 从不累积运行历史，所以 UI 上**什么都看不到**：没有运行记录、没有报错，除了 daemon stderr 之外没有任何痕迹。对一个现实中的每日 one-shot（其 provider 后来被移除）来说，这就是每天静默重试一次，永远。

重试确实会在成功时终止。我在循环中途把同一个任务 PATCH 到一个可用模型：

```
PATCH { modelServiceId: "fake-max(openai)" } → 200
下一个匹配点的线上请求 : ["fake-max", "fake-max"]
之后的磁盘状态         : 已消失 —— 恰好被消费一次
产生的运行会话         : "OneShot recover · 09-08 03:06"
```

所以这是一次真正的重试，不是失控。对从未执行过的工作做重试是站得住的；我想改的是「无上限、无退避、且用户完全看不见」这部分 —— 至少应该把失败的尝试记录到 UI 能显示的地方。

### F3 —— 分组被删掉之后，任务就完全无法编辑了（对应 `scheduled-tasks.ts:1433`）

![过期分组阻塞编辑](https://raw.githubusercontent.com/wenshao/qwen-code/95b244c57cf5c5830262d9b6fa8994844867bd7e/imgs/05-stale-group-blocked.png)

通过真实 UI 端到端复现：删掉一个按次运行任务正在用的分组，重新打开该任务，只改 prompt，保存 →

```
PATCH /scheduled-tasks/1hc45ccg: Group not found: bb4e4ae0-a4d0-4bb2-8ad7-344d0efc1c88
之后磁盘上的 prompt：未变
```

`startEdit` 会把 `task.groupId` 回填进选择器，而该 `<select>` 会把它渲染成一个裸 UUID 选项，于是之后每一次保存都会把这个已死的 id 再发一遍。名称、prompt、调度的编辑全部被挡住，直到用户自己想明白要先把**会话分组**改成「不分组」—— 而没有任何提示这么说。它是 fail-closed、不丢数据的，但这是一个由「删除一个分组」这种日常操作就能走进去的死胡同。最省事的修法：PATCH 时把与任务自身已存值相同的 `groupId` 当作 no-op，而不是重新校验（或者让对话框在 `groupId` 未变时干脆不发这个字段）。

### F4 —— POST 拒绝在固定会话任务上设路由，PATCH 却静默丢弃（未变；ledger 上已有）

`POST` 带 `sessionMode: "persistent"` + `modelServiceId` → `400`。同样的组合走 `PATCH` → **`200`**，字段被悄悄丢掉。存储两边都是一致的，所以这是 API 契约层面的小问题 —— 但客户端会被告知写入成功了。

### F5 —— 任务卡片仍然不显示任务路由到哪里

卡片显示工作区 / 调度 / *每次新会话* / 下次运行，唯独不显示模型和分组。有多个带路由的任务时，只能逐个打开「编辑」才能看到。在*每次新会话*旁边加一个 chip，就能把信息放到用户真正会扫的地方。

### F6 —— 一条手工写坏的条目仍然会让整个调度文件失效（未变）

`isValidTask` 带了跨字段不变式（路由字段要求 `sessionMode === 'per_run'`），而 `readCronTasks` 刻意不丢弃非法条目。我手工注入了一条这样的条目：`GET /scheduled-tasks` → `500 scheduled_tasks_read_failed`，另外 11 个无关任务全部从 UI 消失并停止调度。删掉这条之后一切恢复。产品内没有任何写入方会产生这种组合，所以只有手工编辑 / 外部写入方才碰得到。

### F7 —— DELETE 路由写 tombstone 这件事没有测试

daemon 的 `DELETE /scheduled-tasks/:id` 正是让 R10-1 跨进程否决生效的写入方，而把它的 `deletionIds` 参数删掉之后，**122 个**路由测试全绿（下文变异体 M4）。core 那一侧钉得很牢，daemon 这一侧没有 —— 也就是说日后一次重构可以静默地重新打开 `eb86348329` 刚刚关掉的那个入口。这正是 review 自己在 `scheduled-tasks.ts:1757` 记下的延后项，我确认它是真的。

---

## 4. 测试、变异、构建

**`c682c618` 上的聚焦测试 —— 2,444 通过，0 失败：**

| 包 | 文件 | 测试数 |
| --- | --- | --- |
| `core` | `cronScheduler`、`cronTasksFile` | 190 |
| `acp-bridge` | `bridge`、`bridgeClient` | 1046 |
| `cli` | `Session`、`create-sub-session`、`routes/scheduled-tasks`、`standalone-session-service` | 1126 |
| `web-shell` | `ScheduledTasksDialog`、`scheduledTasks.actions` | 82 |

四个包 `tsc --noEmit` 全部干净；八个改动源文件 `eslint` 干净；`prettier --check` 干净；`git merge origin/main`（`f1ed3bc31a`）**0 冲突**。

**变异测试 —— 8 个杀掉 7 个。** 每个变异体只移除一个修复要素，右侧那个测试正是 review 当初要求的验收用例。

| 变异体 | 移除的东西 | 结果 |
| --- | --- | --- |
| M1 | missed 检测中的持久化「已触发槽」跳过 | **被杀** —— `keeps a restored one-shot after an edit and session restart` |
| M2 | `removeCronTasks` 预检未命中时写 tombstone | **被杀** —— `does not restore after a delete observes the fired task already gone` |
| M3 | 对 `.deletions` 的持久化回读 | **被杀** —— 3 个测试，含 `shares deletion generations across module instances` |
| M4 | DELETE 路由上的 `deletionIds` | **存活** —— 122/122 依旧全绿（F7） |
| M5 | 启动器的 `modelApplied === false` 抛错 | **被杀** —— 2 个测试 |
| M6 | 手动运行路径的 `modelApplied === false` 抛错 | **被杀** —— `fails a per-run dispatch when the selected model is not applied` |
| M7 | 恢复快照上的「触发分钟」盖章 | **被杀** —— 4 个测试 |
| M8 | ACP 子进程模型失败时的 `restoreOneShot()` | **被杀** —— `restores a consumed one-shot when model selection fails` |

**关于变红的 `review-pr`：** 那是 review workflow 自己超时（三条 `qwen-review-fallback` 评论，各 21600 秒），不是测试失败。其它所有 lane 都是绿的，包括 `Test (ubuntu-latest, Node 22.x)`、`Real daemon E2E`、`web-shell E2E Smoke` 和 `Lint & Static`。

---

## 5. 我的意见

**可以合。** 这个 PR 在 10 轮里长出来的这套机制 —— one-shot 恢复、持久化删除 tombstone、fail-closed 的模型应用 —— 在当前 head 上，在我能驱动到的范围内行为都是对的，而且现在有一批「把修复拿掉就会红」的测试托着。ledger 里仍未关闭的 5 条 Critical 中有 3 条在 `c682c618` 已经关闭；其中两条是被 `eb86348329`/`6ddb06d726` 修掉的，而这两个提交落在最后一轮能看到它们的 review **之后**，之后的三次 review 又全部超时。所以实际残余风险比 ledger 读起来要小。

把 review 要求 maintainer 填的残余风险清单补上：

| 未决 Critical | 攻击面 | 攻击者依赖 | 影响范围 |
| --- | --- | --- | --- |
| F2 `cronScheduler.ts:1387` —— 恢复的 one-shot 重复触发 | 无 —— 由一个无法解析的 `modelServiceId` 自伤 | 无 | 每个 cron 匹配点一次 spawn+回滚、两次文件写；不产生孤儿会话；成功或删除即止；UI 上不可见 |
| F3 `scheduled-tasks.ts:1433` —— 过期 `groupId` 的 PATCH | 无 —— 由「删掉任务在用的分组」触达 | 无 | 该任务在清空分组字段前无法编辑；不丢数据 |

两条都不可被利用、都不丢数据，所以我认为都不该卡住合并。

我希望跟进的三件事，按优先级：

1. **F1** —— 把 `persistDefault: false` 透传到定时任务的模型应用里。一个无人值守的后台任务跨工作区静默改掉人类下一条交互消息用的模型，与新表单自己提供的语义是矛盾的。这是我最想修的一条，也是我第 1 轮就提过、至今仍开着的那条。
2. **F3** —— 别让过期 `groupId` 的回传阻塞无关字段的编辑（PATCH 时把未变的 `groupId` 当 no-op）。
3. **F7** —— 给 DELETE 路由的 `deletionIds` 补一个测试，它守着的是一个刚刚才落地的修复，而现在没有任何测试会在它消失时报警。

F2、F4、F5、F6 值得跟踪，但我不会因为它们卡住合并。
