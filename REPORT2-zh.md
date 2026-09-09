# 第二轮 —— 在 `328feb43f8` 上重新验证

装置与上一轮相同：两条基线都从源码构建，浏览器结论来自真实的本地 HTTP 源站（无 CDP 路由拦截）。
merge-base 未变（`fbb877a48e`），因此第一轮的数字在注明处继续有效。**下文凡是写"实测"的，都在本机跑过。**

## 先更正我上一份报告里的一处错误

我写过：*"如果明天有人删掉 `<head>` latch，整个测试套件不会有任何反应。"* **这是错的。**
`scripts/tests/export-transcript-document-template.test.js`（由 latch 提交本身引入）在模板被还原成
latch 前的形态时会 **6 条全红**：

```
latches stylesheet failures in <head>, ahead of the <link>        ×
nonces the latch script, because the CSP allows no inline script  ×
listens for error in the capture phase                            ×
only records the failure while the parser is still in <head>      ×
acts on the latch from the body script                            ×
compares the failing element id both listeners agree on           ×      Tests  6 failed (6)
```

第一轮真正成立的是更窄的那句：**浏览器**门禁没有见证它 —— 新增的
`fails closed when the CDN stylesheet is unavailable` 用例在 latch 前的构建上依然通过。所以我当时的第 1 条
诉求说重了：静态那条流水线是实打实的覆盖，缺的只是行为层面的那一半。

## 新提交确实做到了它声称的事 —— 用变异测试在静态与浏览器两侧都核对过

产物与 `d54fcd0f18` 逐字节相同（`export-transcript-document.js` sha256 `d87a95d4…`、`.css` `e0e4a141…`），
因此第一轮的体积、渲染一致性与 fail-closed 矩阵原样成立。这里仍然重跑了一遍：**241 条测试全绿**
（159 scripts + 76 cli + 6 浏览器门禁），12 格 fail-closed 矩阵在每个故障格都是 `closed`，
与 merge-base 的渲染差异在两种主题下仍是 **0 个像素**。

**这条 id 契约测试瞄得很准，而且它钉住的两个监听器都是承重的。** 我先复现了提交自己的静态结果，
再问了一个静态流水线回答不了的问题：它现在能抓到的这种漂移，真的会坏事吗？

| 变异 | 旧测试文件（`d54fcd0f`） | 新测试文件（`328feb43`） | 真实源站下的浏览器行为 |
| --- | --- | --- | --- |
| latch 比对了错误的 id | `5 passed` | `1 failed \| 5 passed` | 4.0 MB 导出 + 瞬时 CSS 404 → **无样式渲染**（小导出仍 fail-closed） |
| body 监听器比对了错误的 id | `5 passed` | `1 failed \| 5 passed` | 小导出 + 404 / 延迟 404 / SRI 不匹配 → **无样式渲染**；4.0 MB 导出 + 延迟 404 → **无样式渲染** |

也就是说，两者覆盖的是**互不相交的时间窗**——latch 接住"在 body 脚本存在之前派发"的失败，body 监听器接住
"之后派发"的失败——谁都不多余。有一点值得说清楚：这条测试是目前唯一钉住这两者的东西，它对得起自己的位置。

**`build.mjs` 里被更正的注释在事实上是对的。** 在导出文档里实测：经文档 `createElement` 垫片创建的
`<style>` 会被打上 nonce 并**生效**（`rgb(1,2,3)`）；绕过垫片创建的同样的 `<style>` 会被 **CSP 拦截**，
报 `Applying inline style violates ... 'style-src-elem 'nonce-…''`。旧注释所说"CSP 会拦掉未被剥离的重复注入"
是错的，这次更正才是准确的。

**设计文档确实同步了**，两个语种都是：第 1 节引用了实际发布的 `TRANSCRIPT_CSS_ENTRY_FILTER` 并点名
`transcript-css-entry.mjs`；第 2 节描述了 `<head>` latch（位置、nonce、捕获阶段、只记录、由 body 消费）；
第 3 节点名了模块级渲染守卫；"Files affected" 补齐了此前遗漏的三个文件。

## 被推迟的发现 —— 在这里替作者跑完，因为浏览器流水线在其主机上跑不动

PR 上的回复把若干发现推到下一轮，理由是它们需要 Playwright/Chromium 加一次构建。这两样我都有，所以我跑了。
下表每一行都是：对 head 树施加一个变异 → 重跑测试 → 在真实浏览器里打开这个变异体。

| 发现 | 结论 | 见证 |
| --- | --- | --- |
| **R1-8** 发布门禁没有反向测试 | **在 head 上已修复** | 删掉 `prepare-package.js` 那一行会让 `package asset scripts > fails packaging when the published stylesheet is missing` 变红（`1 failed \| 35 passed`） |
| **R1-7** `<link>` 的 nonce 未按元素定位 | **成立，而且比原文更严重** | 删掉 `<link>` 的 nonce 后 `html.test.ts` 仍 **3 passed**、scripts 流水线 **42 passed**；而真实浏览器里样式表被 CSP 拦截，**每一个导出文件都只会显示加载失败页** |
| **R1-6** 渲染器门禁被混淆 | **成立** | 把 `transcript-renderer` 从 body 监听器里删掉后，`fails closed when the CDN renderer is unavailable or fails integrity` 依然**通过**；而此时"只有 JS 404、CSS 正常"会得到一个**完全空白的页面** —— `data-render-complete` 未设置、没有 alert、body 文本 0 字符 |
| **R1-18** 两个 `renderComplete` 守卫，其一无测试 | **已定论** | **模块级**守卫才是承重的，而且**已被钉住**（删掉它 → 新增的样式表用例变红；行为上会把无样式 transcript 盖在报错页上）。**rAF** 守卫是**死代码**：删掉它门禁仍 **6 passed**，文档照样 fail-closed |
| **R1-13** 层叠顺序无测试 | **成立，但今天没有实际影响** | 把 `<link>` 放到内联 `<style>` 之前，所有套件仍全绿（静态 6、html 3、门禁 6/6），渲染**逐像素一致**（`compare -metric AE` = 0） |
| **R1-21** `sheetLoaded` oracle | **成立，但需要一处更正** | 在带 `integrity` 的情况下：404 → `sheet !== null`、0 条规则；连接重置 → `sheet !== null`；但**空响应与截断响应读到的是 `sheet === null`**，因为 SRI 先把它们拦了。真正能骗过这个 oracle 的只有 404 和重置，而不是"空/截断/404" |
| **R1-5** 发布门禁只校验 JS | **成立** | `grep -rn export-transcript-document .github/workflows/` 只有 2 处命中，都是 `release-vscode-companion.yml` 里的 JS 拉取及其 `cmp`；全局没有 `.css` |
| **R1-4** 该窗口内委派不可用 | **成立** | unpkg：`.css` 在 `0.23.2`、`0.23.1`、`0.23.1-preview.0` 上都是 404；npm `latest` = `0.23.2`；runbook 里的两开关命令仍会抛错 |

![mutation matrix](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11485/mutation-matrix.png)

面板 1、2 是两个"测试全绿也能发出去"的变异。面板 3 是新增样式表用例确实抓到的那个 —— 注意它同时满足
`data-render-complete === 'error'` **却仍然显示了 transcript**，因为 React 在 `showLoadError` 写入之后又替换了
`#app`；也就是说，只读这个标记的检查会通过，而读者看到的是一个无样式的导出。

## 与第一轮相同的部分

体积（`4,139,386` → JS `1,833,941` + CSS `2,302,905`；总量 −2,540 字节；gzip −2,110）、字节棘轮反证
（CSS +1 MB：本 PR **全绿**，merge-base 报 `Document export runtime is 5142389 bytes; expected <= 4200000`
—— 在本轮 head 上重跑，仍然全绿），以及渲染阻塞实测（样式表拖延 2.5 s → `first-paint` 落到 2,544 ms）。
渲染耗时在本轮 head 上重测：**中位数 326 ms，对 merge-base 的 383 ms**，即本轮 −57 ms（上轮 −48 ms）；
10 Mbps 限速下仍然约等于 0。

四处文档缺口在本轮 head 上没有变化：runbook 里可复制的委派命令仍会抛错（刚刚重跑确认）、
`build.mjs:200` 仍写着 "Set both or neither"、`docs/users/features/commands.md:39` 仍描述只有一个版本固定资产、
`docs/verification/export-html-runtime-size/README.md` §6 仍引用被改名掉的日志行。

## 更新后的结论

我此前标为"最希望在合入前解决"的那一项，现在基本已被覆盖，而且我当时的说法过重 —— 上文已更正。
本轮新增的信息是：新的 id 测试守住的是一个在两侧都真实可利用的回归，我认为这一轮用得很值。

修订后的合入前清单（最短版）：

1. **R1-7 与 R1-6** —— 我建议现在就并进来，而不是留到下一轮。两者都只是很小的测试改动，而实测的影响面
   都比发现原文更严重：一个让**所有**导出都打不开，另一个悄悄弄丢了渲染器分支唯一的见证。都不需要重写，
   只要一处按元素定位的断言，以及在现有 route handler 里补上 `RENDERER_CSS_URL` 的 fulfil。
2. **委派 runbook 里的命令** —— 它是可执行的，而且是坏的。
3. **CSS 预算** —— 显式做一次决定；如果答案是"两个都守"，大约 4 行。
4. **#11372 的先后顺序** —— 仍然开着，仍然在同样那两个常量上反方向改。

R1-18 里的 rAF 守卫在我能构造的所有路径上都是死代码；R1-13 今天没有实际影响。这两条属于后续跟进，
不是合入阻断项。R1-8 可以按"已修复"关闭。

<sub>Harness、原分辨率截图与原始探针输出：https://github.com/wenshao/qwen-code/tree/assets-pr11485</sub>
