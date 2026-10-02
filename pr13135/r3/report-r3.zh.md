<details>
<summary>中文版</summary>

## 真实环境验证（第 3 轮）— PR #13135 @ `d7c5c5e50e`（head 未变）

**结论：自[第 2 轮](https://github.com/QwenLM/qwen-code/pull/13135#issuecomment-5947693305)以来 head 没有变化，第 2 轮的真实栈结果仍然适用；本次更新只改了描述。** 本轮做了三件事：
- 对照证据核对新的迁移说明（准确）；
- 补测作者仍列为「未验证」的那条升级路径；
- 更正我上一轮关于 F1 的一句话。

图见英文部分。

### 另一种临时编号的升级

- **做法：** 用 `0b9ad071e5` 构建 jar；该构建在 main 的 V28/V29 之后把 close 迁移记为 **V30**。先用它初始化一个新的 MySQL 8.4.7 库，再用当前 head 的 jar 启动这个库。
- **结果：** Spring 拒绝启动，报 `Migration checksum mismatch for migration version 30`；schema 历史没有被改动（30 行，没有 V31）。
- **结论：** 两种临时编号（V28 和 V30）失败方式相同；main 的库可以正常升级（见第 2 轮）。
- **措辞建议：** 迁移说明可以写成「凡是跑过本 PR 早先构建的库（close 记为 V28 或 V30），都需要先重建或修复」。现在的写法只提了 V28，并把 V30 写成未验证。

### 更正第 2 轮

我上一轮写的是「作者同意方案 1」。按作者的[说明](https://github.com/QwenLM/qwen-code/pull/13135#issuecomment-5948174677)，方案 1 只是推荐，PR 作者还没有选定策略。

**F1 仍未解决：**
- 要么在已知原资源无法验证时，在写入 operation、CLOSING 状态或 fence 之前拒绝新的关闭；
- 要么在文档中写明容器部署的限制，以及它对同一存储可用性的代价。

当前 head 上两者都还没有落地。

### 本 head 的 CI

所有检查都已通过，包括第 2 轮时还在等待的 web-shell E2E smoke；`review-pr` 仍在运行。

新库、Spring 日志摘录和图的源码放在[这里](TREE)的 `r3/` 下。

</details>
