# PR #12345 第 2 轮验证(增量)@ `abaf6e85`

**结论：仍可合并。** 新 head 上没有阻塞项。唯一的新发现是一条非阻塞的范围说明：在 `allowAdd:false` 下，用户仍能在输入框里用 `/config` 把 daemon 指向未登记的模型和端点（详见下文）。公共 API 的形态仍需维护者拍板，这一点和 PR 描述一致。

第 1 轮（[5791836687](https://github.com/QwenLM/qwen-code/pull/12345#issuecomment-5791836687)，head `60a8d458`，macOS，daemon 路由为 mock）的内容这里不再重复。本轮只覆盖两类内容：一是自那以后的变化，二是第 1 轮列为"未覆盖"的项，即 Linux、**真实 `qwen serve` daemon**（不用 mock 路由）、light/dark 视觉 spec，以及 `abaf6e85` 中与 `main` 的同步。

**1. 合并提交审计。** 分别比较 `git diff <merge-base> a9429c26`（合并前）和 `git diff 62f298c8 abaf6e85`（合并后）：两份补丁都是 3,906 行；去掉 `index`/`@@` 行后，只有 `App.tsx` 两处**上下文行**不同，就是 main 新加的导航 import 和 ref。PR 自身的每一行 `+`/`-` 都逐字节保留。`60a8d458..a9429c26` 只给 4 个 e2e 标题加了 `@smoke` 标签。

**2. 真实 daemon A/B（图 1）。** 测试链路为 Chromium → PR 源码（vite dev）→ 真实 daemon（隔离的 `QWEN_HOME`，两个 openai provider）→ 带请求日志的假 OpenAI 服务器。每个单元格都在网络层（`POST /prompt` 计数）和模型端（假服务器日志）实际测量。
- 在 D 臂（两个开关都关闭）里，欢迎页 `/auth` 和会话内 `/auth`、`/login`、`/connect`、`/  auth`、`/auth openai` 全部在本地被拒：**0 次 POST，0 次模型调用**。之后普通对话照常到达模型。
- C 臂（未传选项）中，`/auth` 会打开鉴权弹框，`/login`、`/connect`、`/  auth` 会转发给 daemon，daemon 返回 "Authentication configuration is only available in interactive mode…"。
- 在 C 和 D 两臂里，`/AUTH` 都会被转发，daemon 把它当普通文本发给模型。原因是 daemon 的 `findCommandByName` 区分大小写，与客户端分类器一致，所以这不是绕过。
- **负对照**：把 `isModelSetupCommand()` 改成恒返回 `false` 后，`/login`、`/connect`、`/  auth` 都泄漏到 daemon。裸 `/auth` 仍被 App 本地路由的第二道门拦下，这是文档写明的纵深防御。

**3. 保留的操作真实写入 daemon（D 臂）。**
- Set current 会发出 `POST /session/:id/model {"modelId":"fake-b(openai)"}`，下一轮请求确实发往 `fake-b`。
- `/model` 弹框切回 A 后，请求发往 `fake-a`。
- Edit context window 会发出 `PATCH /workspace/models`，`settings.json` 中写入 `generationConfig.contextWindowSize: 65536`。
- 模型区块里：C 臂有 `+ Add Model` 和 3 个 Delete；D 臂两者都没有（图 2）。

**4. 与 main 的语义交互。** main 在 #12499 引入了 URL 导航，新增了 `/settings` 深链入口。用 `/agentic-code/settings` 深链直接打开设置页，结果和上面一致：D 臂 0 个 Add、0 个 Delete，C 臂 1 个 Add、3 个 Delete。新入口没有绕过策略。

**5. 动态收紧（图 4）。** 在 `/auth` 弹框打开时，把策略切换为 `allowAdd:false`：弹框关闭，普通对话仍能到达模型（输入框没有卡住），再输入 `/auth` 会被拒。恢复允许后旧弹框不会重新出现，新输入的 `/auth` 可以正常打开。

**6. 项目命令覆盖（真实命令快照）。** 在工作区放一个 `.qwen/commands/auth.toml`：
- 主输入框的 `/auth` 仍由 App 本地路由处理：C 臂打开弹框，D 臂弹出 toast。README 写明了"App 本地 `/auth` 路由仍是配置弹框入口"。
- 内置命令被项目命令覆盖后，`/login` 这个别名不再解析，客户端放行，daemon 也把它当普通文本处理，两边一致。

**7. 门禁（Linux，Node 22.22.2，pnpm 11.24.0）。**
- 真实 `pnpm install` + 全量 `npm run build` + `npm run bundle` 通过。
- `web-shell.model-management.spec.ts` + `web-shell.url-navigation.spec.ts`：**21/21**。
- 第 1 轮没跑的 **视觉 spec `screenshots.spec.ts`：54/54**（light/dark 均含新增的 "settings panel with model management disabled"）。
- 受影响的 11 个单测文件（含完整 `App.test.tsx`）：**1,801/1,801**。
- 新 head 上 CI 的 Lint/Test/web-shell E2E Smoke/visuals 全部是绿的。

**8. 发现（非阻塞）：`/config` 仍可在 `allowAdd:false` 下重配 provider（图 3）。** 在 D 臂的输入框里依次提交：
- `/config model.name=unlisted-model`
- `/config model.baseUrl=http://127.0.0.1:18345/injected/v1`
- `/config security.auth.baseUrl=…`（`security.auth.apiKey=…` 同样可写）

这些命令会被转发给 daemon，并写入 `settings.json`。**daemon 重启后**，下一轮请求变成 `POST /injected/v1/chat/completions model=unlisted-model`，而这个模型和端点都不在宿主下发的 provider 列表里。

PR 文档写的是"配置文件写入……不受影响"，但 `/config` 是在 WebShell 输入框里输入的，对以"防止在嵌入 UI 中误改"为目标的宿主来说，这是 `/auth` 之外的另一个 setup 入口。建议二选一：
- 在 README/设计文档的范围说明里点名 `/config`（一行即可）；
- 对 `security.auth.*` 和 `model.baseUrl` 这几个 `/config` 键做窄门控。

合并与否由维护者决定，不影响本轮结论。

**未覆盖**：Windows/macOS 本轮未跑（第 1 轮是 macOS）；分屏（pane）输入框和侧任务面板只用了单测覆盖，没有接真实 daemon 跑。

## 图

![图1 真实 daemon A/B 与负对照](./01-real-daemon-ab.png)

![图2 模型区块 A/B](./02-model-section-ab.png)

![图3 /config 重配 provider](./03-config-bypass.png)

![图4 动态收紧](./04-dynamic-tighten.png)
