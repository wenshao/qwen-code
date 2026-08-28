# Evidence bundle for PR QwenLM/qwen-code#10357

Local verification of `fix(dingtalk): recover status cards after network failures`.

* head: `b7f629a7b5` (PR #10357)
* base: `4b5396c69a` (merge base with `main`)

## Layout

| path | what |
| --- | --- |
| `images/` | screenshots used in the PR comment |
| `harness/` | the fault-injection harness (see below) |
| `results/` | raw per-scenario JSON, both trees |
| `results/mutants.json` | mutation probe verdicts on the PR head |
| `results/mutant-lastContentSyncSecond-*.json` | cost run with the unpinned `lastContentSyncSecond` reset deleted |

## What the harness is

`harness/server.mts` is a local stand-in for the DingTalk Card OpenAPI plus a model of
the DingTalk client cache. The Qwen Code side of the wire is the real thing: the
production `DingtalkInteractionPresenter`, `StatusCardController` and
`DingtalkInteractiveCardClient` are loaded from the worktree under test and issue real
HTTP requests; only the API host in the URL is rewritten to `127.0.0.1`. Faults are
injected as destroyed sockets or HTTP status codes, so the client's own error
classification runs unmodified.

Two simulated clients subscribe to the same card:

* `PUT /v1.0/card/streaming` frames reach only clients that are online at that moment
  and are **not** replayed on reconnect (client model `m2`, the behaviour implied by
  issue #10354). `CLIENT_MODEL=m1` models the opposite assumption.
* `PUT /v1.0/card/instances` (`updateCardDataByKey`) reaches whoever is online.

## Reproducing

```bash
# two worktrees, both with node_modules and packages/channels/base built
git worktree add ../qwen-10357 <pr-head>
git worktree add --detach ../qwen-10357-base 4b5396c69a
(cd ../qwen-10357/packages/channels/base && npx tsc --build)
(cd ../qwen-10357-base/packages/channels/base && npx tsc --build)

# adjust the two TREE paths at the top of harness/run.sh, then
./harness/run.sh myrun m2            # all scenarios, both trees
./harness/run.sh myrun m1 reconnect  # the alternative client model
python3 harness/mutants.py           # mutation probes on the head tree
python3 harness/render.py out/myrun  # HTML pages for the screenshots
```
