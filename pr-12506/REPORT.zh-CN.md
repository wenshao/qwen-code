## 维护者验证 —— PR #12506 @ `a92a8fe`(真实进程，Linux x86_64)

**结论:可合入，无阻塞项。** PR 声称的行为全部成立，覆盖了三种启动方式:发行 bundle(`dist/cli.js`)、包入口(`packages/cli/dist/index.js`)，以及 Java `ProcessBuilder` provisioner(JDK 21 和 JDK 25)。`a92a8fe` 新增的 boot 期限按描述工作。下文给出一个可选的补测补丁，以及三个协议层面的问题；这三点最好在本 PR 或 Java client PR 冻结 boot 协议之前定下来。

验证过程中 head 从 `f8dd941` 变为 `a92a8fe`(`range-diff`:第一个提交为 `=`，第二个提交只加了期限)。我在 `a92a8fe` 上重新构建并重跑了全部项目。个别数据来自 `f8dd941` 的，文中已注明。

### 运行了什么

| 检查 | 结果 |
|---|---|
| 安装后执行 `npm run build && npm run bundle` | exit 0(3m45s) |
| 聚焦测试:worker、contract、`cli.test.ts` | **136/136**(与作者一致) |
| `tsc --noEmit`(cli)/ eslint `--max-warnings 0` / 改动文件的 prettier | 0 / 0 / 通过 |
| 通过 bundle 的真实进程 E2E:21 例(图 1、图 2) | 全部与声明一致 |
| 同样 21 例改走 `packages/cli/dist/index.js` | 与 bundle 结果一致 |
| 同样 21 例在旧 head `f8dd941` 上 | 一致(harness 的 10 s 挂起探测短于新的 30 s 期限；期限另行测量，见下) |
| Java `ProcessBuilder` provisioner,JDK 25.0.2 与 Temurin 21.0.12 | ready ~90 ms → attest 200 → 旧 epoch 409 → `destroy()` exit 0 |
| 普通 CLI 与 base `591c9f4` A/B(`--help`、`-v`、`mcp --help`、`serve --help`、`channel --help`) | 逐字节一致；隐藏命令不出现在 help 中 |
| 手工变异(20 个) | 杀死 10/20，加上可选补丁后 15/20(图 3) |

- ready record 的字段恰好是 `type, version, runtimeInstanceId, runtimeIncarnation, leaseId, epoch, url`。stdout 只有一行，所有用例的 stdout 和 stderr 中都没有出现 token。
- attest 返回 200 且带 `Cache-Control: no-store`，没有 `X-Powered-By`。错误 token 得到 401。`GET /health` 和 `?x=1` 得到 404，同样带 `no-store`。JDK 请求 `GET …/v2/tools` 得到 404(JDK 探针在 `f8dd941` 上运行)。
- JDK 默认客户端(HTTP_2)在明文连接上会发送 `Upgrade: h2c`。worker 以 HTTP/1.1 返回 200，所以 Java 端不需要固定 HTTP 版本(探针在 `f8dd941`;`a92a8fe` 上的 provisioner 同样用默认客户端,`wire=HTTP_1_1`、200)。
- 保持一个 keep-alive 连接和一个空闲裸 socket 不关，发送 SIGTERM 或 SIGINT,4 ms 内以 0 退出。`closeAllConnections()` 起了作用。
- 资源占用(`a92a8fe`):worker 打开 19 个 bundle JS 文件，共 1.82 MB,占 54.7 MB 的 `chunks/` 总量的一小部分。最大的一块是 express/body-parser/iconv-lite。其中没有 `GeminiClient`、`ToolRegistry` 或 `class Config`。RSS 约 72.8 MB,在 `$QWEN_HOME` 下写入 **0 个文件**。"不加载普通 CLI 栈"这一说法成立。
- 12 种非法 boot 输入都以 exit 1 退出,stdout 为空。`strace -e listen` 显示 **`listen()` 系统调用次数为 0**,所以"在发布可用 listener 之前失败"在系统调用层面成立，而不只是在 API 层面。
- 恰好 32 768 字节(用空白填充)的输入被接受,32 769 字节被拒绝。如果身份字段使响应超过 16 KiB,也会在 listen 之前失败。
- **`a92a8fe` 的期限:** 我试了三种卡住方式:写完文档但不关 stdin、什么都不写、每秒写 1 字节。三种都在 30.5–30.7 s 以 exit 1 退出，没有 `listen()`。在第 25 s 写完并关闭 stdin 的情况仍能正常 ready。在 `f8dd941` 上，同样的挂起 10 s 后进程仍然存活。triage 的第 2 点已关闭。
- **triage 第 1 点不成立，这印证了作者的回复。** 我在不重建 `dist/` 的情况下修改源码。子进程测试依然杀死了 **M01**(删掉 SIGTERM 处理)和 **M10**(ready 行不带换行)。可见该测试通过 tsx 运行的是 `src/cli.ts`,而不是 `dist`。

### 可选：纯测试补丁(+76/−33,只改一个文件)

最重要的存活变异是 **M03**:把监听改成 `listen(0, '0.0.0.0')` 后所有测试仍然通过，因为 ready URL 是写死的 `127.0.0.1` 字符串，并不来自 `server.address()`。"只绑定 loopback"是这个切片的安全属性，目前没有任何测试钉住它。补丁新增四项:

- 连接 `127.0.0.2:<port>` 必须失败的探测(darwin 上跳过，因为 macOS 默认没有配置 127.0.0.2);
- 子进程测试用 `it.each` 覆盖 SIGTERM 和 SIGINT;
- 恰好 32 KiB 的接受用例;
- 错误 `version` 和错误 `type` 的 boot 用例。

加上补丁后:13/13 测试通过，连跑 3 次稳定,eslint 通过，变异杀死 15/20。剩下的存活者是 M11–M13(连接与超时加固，没有低成本的断言方式)和 M19/M20。M19/M20 在 CLI 路径上等价，因为 `handleCriticalError` 会调用 `process.exit(1)`。

### 给 Java provisioner 的协议问题(不阻塞合入，但最好在协议冻结前定下)

1. **版本错配会把 token 发给模型提供方。** 我用完全相同的命令行 `qwen managed-runtime-worker < boot.json` 调用不含本 PR 的二进制(base `591c9f4`)。它把 `managed-runtime-worker` 加上 stdin 内容当成 prompt,**向配置的 OpenAI 兼容端点发了 2 次请求，bearer token 就在 user 消息里**;同时把 token 写进了 `$QWEN_HOME/projects/…/chats/<id>.jsonl`,打印 `ok`,以 0 退出。任何不含此命令的 `qwen` 构建都会这样(实测:base `591c9f4`)。因此 provisioner 必须在写入凭据**之前**确认目标二进制支持这个协议。可选做法有两种：固定版本校验；或者让 worker 在读 stdin 之前先输出一行不含 token 的 `{"type":"hello",…}`,Broker 看到它之后才写 boot 文档。
2. **ready 之后没有父进程存活信号。** 我用管道启动 worker,然后 SIGKILL 掉 provisioner。worker 被 PID 1 收养,30 s 后仍在 loopback 端口上提供服务。boot 协议会把 stdin 读到 EOF,所以 stdin 不能再用作存活信号。一种做法是改成以换行分帧的 boot 文档，之后保持 stdin 打开，读到 EOF 即视为父进程已退出并自行关闭(在 Windows 上同样可用)。另一种做法是在设计文档里明确把回收孤儿进程写成 Broker 的职责。triage 提出的是 ready 之前的那一半,`a92a8fe` 已经修掉;ready 之后的这一半仍然存在。
3. **小问题。**
   - `managed-runtime-worker -v` 和 `--version` 会打印版本号并以 0 退出，因为全局的版本拦截先于 worker 路由执行。这与"任何额外参数都会失败"的说法不符；只要 Java 端把 stdout 第一行不是 `ready` 记录的情况一律视为失败，就不会有害。
   - 所有启动失败都是 exit 1,输出通用的 `An unexpected critical error occurred:` 加堆栈。Broker 除了解析 stderr 之外，无法区分协议错误和身份错误。目前可以接受；如果 Broker 需要对失败分类，建议使用不同的退出码。

### CI

`a92a8fe` 上的 `Test (ubuntu-latest, Node 22.x)` 是红的,`f8dd941` 上的 `Lint & Static` 也是红的。两者都是 runner 基础设施故障(`ecs-qwen-hk4-19`,`fatal: detected dubious ownership`,失败在 "Verify checkout includes expected head commit" 步骤),一个测试都没跑。需要的是重跑，而不是改代码。上面的本地运行覆盖了相同的测试套件。

证据(截图、harness、原始 JSONL、变异汇总、补丁):[`wenshao/qwen-code@asserts:pr-12506/`](.)
