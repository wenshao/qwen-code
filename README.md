# Evidence bundle for PR QwenLM/qwen-code#10357

Local verification of `fix(dingtalk): recover status cards after network failures`.

* head: `f1ce5f317f` (PR #10357)
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

---

# Round 2 — re-verification at head `90eb0a9a61`

After round 1 the author pushed three commits: `a2211707e2` (the F1 rewind fix),
`bc35af3fc4` (`pendingSnapshot` → `contentVersion` + `hasPendingWrite`, "avoid
redundant status card flushes") and `90eb0a9a61` (a test pinning the new state).
Everything under `round2/` is a fresh run against that head.

* head: `90eb0a9a61`
* base: `4b5396c69a` (merge base with `main`, unchanged)
* both trees are **dedicated worktrees** created for this run and verified to be
  at the pinned SHA with a clean status before and after every measurement
* node v24.18.1, macOS

## Layout

| path | what |
| --- | --- |
| `round2/images/` | screenshots used in the round-2 PR comment |
| `round2/results/` | raw per-scenario JSON for both trees (`m1-*` = alternative client model) |
| `round2/results/mid-*`, `round2/results/patch-*` | the intermediate commit `a2211707e2` and the candidate follow-up, same scenario |
| `round2/results/mutdedup-*` | the surviving dedup mutant re-run on the real stack (equivalence check) |
| `round2/results/mutants-round2.json` | 15 mutation probes on the head |
| `round2/candidate-skip-duplicate-first-flush.diff` | the optional follow-up discussed in the comment |
| `round2/harness/` | the harness as run in round 2 |

## What changed in the harness since round 1

* `summary()` now emits `streamWrites` (every non-finalizing `PUT /v1.0/card/streaming`
  with its payload length) and `redundantStreamWrites` (writes byte-identical to their
  predecessor — an OpenAPI call that changes nothing on the card).
* New scenario `boundary-slow-create`: a response boundary landing right after a slow
  (700 ms) card creation. This is the path `bc35af3fc4` targets.

## Reproducing

```bash
git worktree add --detach <dir>/wt-head 90eb0a9a61
git worktree add --detach <dir>/wt-base 4b5396c69a
# node_modules cloned into each tree, then:
(cd <dir>/wt-{head,base}/packages/channels/base && npx tsc --build)

round2/harness/run2.sh iso-m2 m2 "head base"          # all 11 scenarios, both trees
round2/harness/run2.sh iso-m1 m1 "head base" reconnect # alternative client model
python3 round2/harness/mutants2.py mutants-round2.json
python3 round2/harness/render2.py out/iso-m2 out/iso-dup results shots
node    round2/harness/shoot.mjs shots images
```
