# #11485 本地验证报告 —— 真实构建、真实浏览器、真实网络故障

验证提交 `d54fcd0f18`，对照 merge-base `fbb877a48e`。环境：Linux、Node 22.22.2、无头 Chromium
（Playwright）。两条基线都是从源码构建的；下面所有浏览器结论都来自一个真实的本地 HTTP 源站提供真实构建产物 ——
**没有 CDP 路由拦截，没有 mock**，因为路由拦截恰恰会掩盖本 PR 最后一个提交所修复的那个失效模式。

## 结论速览

机制是成立的，我没能把它弄坏。剩下的是一个字节预算的取舍、一处文档回归、一个合入顺序问题，以及一个缺失的测试。

| | |
| --- | --- |
| ✅ | 剥离是**可证明无损的** —— 抽出的 CSS 与 merge-base 上 `injectCssModules` 在运行时注入的内容 sha256 完全一致，而且是**在浏览器里**测的，不只是比对源文件。 |
| ✅ | 与 merge-base **逐像素一致** —— 0 个差异像素，深色与浅色主题都是。 |
| ✅ | 我能构造的每一种真实故障都 **fail-closed**：HTTP 404、连接重置、SRI 不匹配、JS 404 —— 包括数 MB 的大导出。 |
| ✅ | 打包链路端到端闭合，两条失败分支都验证过。PR 自带的测试在本地全绿（6 + 76 + 158），当前 head 的 CI 全绿，含 `web-shell E2E Smoke`。 |
| 🔴 | `<head>` latch（`c57203fc`）是**承重的** —— 我在 `3b63662b` 上复现了它修复的那个 bug，而**PR 新增的回归测试在没有该修复时同样通过**。 |
| 🟠 | 字节棘轮不再覆盖渲染阻塞载荷的 56%。这是实测而非论证：**CSS 加 1 MB，本 PR 构建照样全绿，merge-base 则直接构建失败**。 |
| 🟠 | `docs/verification/export-renderer-delegation-mermaid/README.md` 里可直接复制的委派命令**现在会硬抛错**。已实际执行验证。 |
| 🟠 | 可测得的用户可见收益是 **~48 ms**，并且在**带宽受限的连接上完全消失**。总字节数没有变化（−2,540）。 |

---

## 1. 抽取是无损的（对应 stage-2 的质疑："在压缩产物上做正则手术"）

三个互相独立的测量，同一个哈希：

```
sha256 e0e4a14164081338ff63621c15b46c31f9298f3fbe5808be2cbaf50c09cf3a8d   2,302,905 字节
  ├─ packages/web-shell/dist/transcript.js 中 `__qwenWebShellCss` 字面量的 JSON.parse 结果
  ├─ 在真实浏览器中打开一个用 MERGE BASE 构建的导出文件（即今天读者拿到的东西），
  │  读出运行时注入的 <style data-qwen-web-shell="component"> 的 textContent
  └─ 本 PR 产出的 export-transcript-document.css（以及打包后的 dist/ 副本）
```

中间那一行才是关键：它不是把同一个输入再读一遍，而是 `main` 上 Chromium 样式表里真正存在的东西。
CSS 也确实离开了 JS：`__qwenWebShellCss` 在 merge-base 的 bundle 中存在、在 head 中消失；只可能来自样式表的
`KaTeX_Main` 同样如此。

## 2. 渲染一致性 —— 0 个差异像素

一份覆盖标题、表格、带高亮的围栏代码、行内与块级 KaTeX、mermaid、任务列表、引用块、file-diff 工具卡片和
shell 工具卡片的 transcript，在两条基线上都走完整 `/export html` 链路并整页截图：

![render parity](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11485/render-parity.png)

`compare -metric AE` 在深色主题下为 **0**，点击 *Light theme* 后仍为 **0**，输出 PNG 逐字节相同。
条件 B（层叠顺序位于内联 `<style>` 之后）得到了实测支持，而不只是代码审读。

## 3. `<head>` latch 是承重的 —— 而且没有测试钉住它

批准该 PR 的审查者是就"机制"下的结论，并明确留了一个口子：这个修复*"从未在真实的数 MB 文档上被观察到"*。
现在观察到了。

**复现方式：** 用一个真实的本地源站同时提供导出文件与两个资产，对样式表返回真实的 `404`。在 `3b63662b`
（`c57203fc` 之前）上，对一个大导出，`<link>` 的 error 事件在解析器仍被它阻塞时就被派发 —— 早于 `<body>`
脚本注册监听器 —— 因此没有任何人接住它，渲染器照样挂载：

![fail-closed A/B](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11485/fail-closed-ab.png)

面板 **B** 就是这个 bug：`data-render-complete="true"`、没有报错页，并且
`getComputedStyle('.katex').fontFamily === '"Times New Roman"'` —— 组件样式表根本没生效。
面板 **C** 是同一份文档、同一个 404 在当前 head 上的表现。

| 导出体积 | 故障 | `3b63662b`（latch 前） | `d54fcd0f`（head） |
| ---: | --- | --- | --- |
| 10 KB | CSS 404 / 重置 / SRI 不匹配 | fail-closed | fail-closed |
| 0.40 MB | CSS 404 | fail-closed | fail-closed |
| 1.20 MB | CSS 404 | fail-closed | fail-closed |
| 2.41 MB | CSS 404 | fail-closed | fail-closed |
| **3.21 MB** | CSS 404 | **无样式渲染 3/3** | fail-closed 3/3 |
| **4.0 MB** | CSS 404 | **无样式渲染 3/3** | fail-closed 3/3 |
| **4.0 MB** | 连接重置 | **无样式渲染 3/3** | fail-closed 3/3 |
| **4.0 MB** | SRI 不匹配 | **无样式渲染 3/3** | fail-closed 3/3 |
| **4.81 / 7.22 MB** | CSS 404 | **无样式渲染 3/3** | fail-closed 3/3 |
| 任意 | JS 404 | fail-closed | fail-closed |

本机的翻转阈值在导出 HTML 的 2.4 MB 与 3.2 MB 之间。`EXPORT_TRANSCRIPT_LIMITS_V1` 允许 32 MB 信封、
1,000 个 block，所以这个区间是完全够得着的 —— 而 SRI 不匹配那一行意味着：一个被损坏或被篡改的 CDN 响应，
在修复前会以无样式的方式渲染出来，而不是 fail-closed。这个修复是对的，值得保留。

**由此引出两点。**

1. **新增的回归测试并没有钉住这个修复。** 我用 `3b63662b`（latch 前）的模板重新构建后，跑 PR 自己的用例：
   `chat-transcript-document.test.ts -t "fails closed when the CDN stylesheet is unavailable"` → **1 passed**。
   该用例用的是 `page.setContent` + `route.abort`，中止经 CDP 回来时文档早已解析完毕，所以它只可能覆盖慢路径。
   如果明天有人删掉 `<head>` latch，整个测试套件不会有任何反应。要钉住它，需要真实源站 + 一份大到能让解析器
   让出主线程的文档；assets 分支上的 harness 约 120 行，做的正是这件事。
2. **triage 里建议的替代修复不会奏效。** 当时建议用 `link.sheet === null` 作为更简单的判据。在真实 404 上实测：
   `link.sheet !== null` 且 `cssRules.length === 0`，这个判据根本不会触发。latch 的形状才是对的。

## 4. 字节棘轮 —— 对称的实测反证

我在两条基线上都把 `__qwenWebShellCss` 字面量精确加长 1,000,004 字节后重新构建：

| | merge-base | 本 PR |
| --- | --- | --- |
| CSS +1 MB | ❌ 构建失败：`Document export runtime is 5142389 bytes; expected <= 4200000` | ✅ **构建全绿**，`renderer JS is 1833944 bytes; component CSS … is 3302909 bytes` |

`<link>` 位于 `<head>`，是渲染阻塞的 —— 这一点我也测了：把样式表拖延 2.5 s，`first-paint` 就变成
**2,544 ms**（期间什么都不绘制，连背景都没有）。也就是说，Tailwind 扫描范围变宽、或 KaTeX 再内联一种字体格式，
都可能给读者必须等待的字节加上数百 KB，而每次构建仍然是绿的。给 CSS 再加一对常量大约 4 行；如果"只对 JS 设预算"
是有意为之，那也值得显式地做出并承担这个决定，而不是从设计文档里继承下来。

另外提醒下一个重新收紧棘轮的人：日志里的数字是在渲染器版本占位符替换**之前**取的，因此比实际写盘的资产大 3 字节
（日志 `1833944` vs 磁盘 `1833941`）；而 merge-base 曾计入的那约 3 KB 内联文档 CSS，现在完全不在预算之内了。

## 5. 性能 —— 诚实的数字

构建体积（我的构建，略高于 PR 正文，因为 `main` 已经前进）：

| | merge-base | 本 PR | Δ |
| --- | ---: | ---: | ---: |
| `export-transcript-document.js` | 4,139,386 | 1,833,941 | **−55.7 %** |
| `export-transcript-document.css` | — | 2,302,905 | 新增 |
| 磁盘总计 | 4,139,386 | 4,136,846 | −2,540 |
| gzip −9 总计 | 1,538,709 | 1,536,599 | −2,110 |
| 构建余量 | 距 4,200,000 上限仅 57,609 B，且**已超过**警告线 | JS 距新上限 96,059 B | — |

merge-base 的构建今天就会打印 `Document export runtime exceeds the 4100000-byte warning threshold`，
这独立于作者给出的数字，佐证了 #11478 的前提。

从导航到 `data-render-complete` 的耗时（中位数，无头 Chromium，本地源站）：

| 场景 | merge-base | 本 PR | Δ |
| --- | ---: | ---: | ---: |
| 小导出，不限速（7 次） | 383 ms | 335 ms | **−48 ms（−12.5 %）**，两组区间不重叠 |
| 900 block / 7.2 MB 导出，不限速（5 次） | 1,609 ms | 1,561 ms | −48 ms（−3 %） |
| 小导出，40 Mbps / 20 ms RTT（5 次） | 1,193 ms | 1,185 ms | −8 ms |
| 小导出，10 Mbps / 40 ms RTT（5 次） | 3,591 ms | 3,585 ms | −6 ms |

所以 PR 正文的定性是准确的 —— 这是一次 JS 解析/编译的收益 —— 但它的量级是 ~48 ms，且与 transcript 大小无关，
**一旦带宽成为瓶颈就淹没在噪声里**，因为同样的 4.1 MB 还是要传完，而且样式表是渲染阻塞的。还有一点这次拆分
**没有**买到：两个 URL 都取自同一个 `exportTranscriptRendererVersion.split('+')[0]`，因此每次发版都会同时让两个
资产失效 —— 不存在可以指望的差分缓存收益。

这些都不构成反对合入的理由。它们说明的是：#11478 的条件 F（base64 内联的 KaTeX 字体、transcript 根本不会引入的
组件所产生的 Tailwind 工具类）才是读者可感知收益的真正来源，应该变成一个有跟踪的后续 issue，而不是被本 PR 顺手
关掉。

## 6. 文档回归 —— 用执行确认

那份存在意义就是这个配方的 runbook，在
`docs/verification/export-renderer-delegation-mermaid/README.md:106-107` 仍然是两开关形态。原样执行：

```
merge-base ：Document export delegates its renderer to …@0.23.1-preview.0/… ✅
本 PR      ：Error: QWEN_EXPORT_RENDERER_CSS_INTEGRITY must be set together with the renderer
             delegation … ❌ exit 1
```

补上第三个开关就能跑通（用构建出的 CSS 计算 `sha384-…` → 构建成功），所以这是文档要改，不是代码要改。
`build.mjs:188-210` 仍写着 "Set both or neither"；`docs/users/features/commands.md:39` 仍描述只有一个版本固定资产；
`docs/verification/export-html-runtime-size/README.md` §6 仍引用本 PR 改名掉的 `Document export runtime is N bytes`。
这四处此前都已被报告过 —— 我只补充一点：其中一条是可执行的命令，现在是坏的。

## 7. 打包与发布顺序

链路闭合，已实测：`copy_bundle_assets` → `dist/export-transcript-document.css` 与构建产物逐字节一致（同一 sha256）
→ `prepare-package` 的 `verifyBundleArtifacts` 硬性要求它（删掉后报
`Error: Required package artifact not found: …/dist/export-transcript-document.css`）→ dist `package.json` 的
`files` 带上了它 → standalone 排除列表也带上了它。`copy_bundle_assets` 中"只缺 CSS"的分支会准确点名缺失文件，
符合 `d54fcd0f` 的意图。

线上 CDN 实测（这是发布顺序提醒，不是缺陷）：

```
https://unpkg.com/@qwen-code/qwen-code@0.23.2/export-transcript-document.js  → 200，4,136,297 字节
https://unpkg.com/@qwen-code/qwen-code@0.23.2/export-transcript-document.css → 404
npm dist-tag latest = 0.23.2
```

其中 4,136,297 与 PR 正文的 "before" 数字完全吻合。由于导出文件里的 URL 由仓库版本号推导，在发布一个晚于 0.23.2
且同时携带两个资产的版本之前，本分支产出的导出都渲染不出来 —— 这在预期之内也已披露，但也意味着它不能被夹带进
一次只跑了部分打包链路的发布。

## 结论

技术上我没有阻断项。抽取无损、渲染逐像素一致、fail-closed 路径在真实故障下确实是密封的 —— 包括最后一个提交
修掉的那个，我确认了它是一个真实可达的 bug，而不是理论风险。

合入前我希望看到：

1. **一个钉住 `<head>` latch 的测试**。目前这个修复自己的回归测试在没有修复时也能通过。配方和 harness 在
   assets 分支上。
2. **对 CSS 预算做一次显式决定**。如果答案是"两个都守"，大约 4 行。
3. **修好委派 runbook 里的命令** —— 它是可直接复制的，而现在是坏的。
4. **把 #11372 排好顺序**。它仍然开着、仍然反方向改同样那两个常量；本 PR 先合，它的立论就没了。

另外建议把 PR 正文的性能表述改成可测量的口径：快连接下约 48 ms 的解析/编译收益、慢连接下没有收益、总字节不变 ——
并把条件 F 作为真正"删字节"的后续跟踪项。

<sub>Harness、原分辨率截图与原始探针输出：https://github.com/wenshao/qwen-code/tree/assets-pr11485</sub>
