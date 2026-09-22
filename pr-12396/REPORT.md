## Maintainer verification — real daemon, head `c00d385`

I built this PR locally and drove a real `qwen serve` daemon for each arm. My main goal was to measure the two Critical findings from the Stage 3 review, which were traced but never run, and the S1 gap the sandboxed rounds have carried for five rounds. This comment only covers what earlier rounds did not establish.

**Verdict (mine): mergeable after one 5-line fix (patch below, verified).**

- Stage 3 **Finding 1 reproduces** on a real daemon. An operator stops a channel. A late workspace whose names were all already hosted is removed and registered again. The channel comes back. Base keeps the stop.
- Stage 3 **Finding 2 does not reproduce**: 0 failures in 21 paired registrations, 3 bursts of 6 concurrent registrations, and operator stop/DELETE in flight. I would not block on it. The reason it does not reproduce has a cost of its own, measured below. That cost should be written down in the PR body or tracked in #12432.

| Claim / finding | Result on a real daemon |
| --- | --- |
| Central claim: a late workspace brings up its own `serve.channels` | ✅ head: worker running, peer contacted. Base: nothing. Test plan E2E: head **6/6**, base **5/6** (only the new case fails, 3 attempts), head + patch **6/6** |
| Stage 3 F1: the once-per-daemon record is skipped when every name is already hosted | ❌ **reproduced**. Head revives the stopped `bot` (`sel [other] → [other, bot]`, owner worker restarted). Base and head + patch keep it stopped |
| Stage 3 F2: two close registrations tear each other down | ✅ **not reproduced**. The hook's existing `await restoreWorkspace()/refreshWorkspaces()` holds the second hook until the first restore commits |
| Cost of that mask: a second registration waits for the first's worker | ⚠️ **measured**. A workspace with *no channels* registered 300 ms after one whose peer hangs: `POST /workspaces` **29,725 ms** on head vs **9 ms** on base |
| Sandbox S1 (stop one of two channels → remove → re-register) | ✅ holds on head. M1 (record deleted) revives the channel, but **only** when another workspace keeps hosting enabled |

### Setup

Linux x86_64, Node v22.22.2. `pnpm install --frozen-lockfile` → `npm run build` → `npm run bundle`. The PR changes one production file, `packages/cli/src/serve/run-qwen-serve.ts`, so each arm is the head tree with only that file swapped, then `esbuild` + `copy_bundle_assets`:

| Arm | Chunk |
| --- | --- |
| head | `run-qwen-serve-3Y3UMMS2.js`. The esbuild rebuild is byte-identical to the full `npm run bundle` output, sha256 `39669f79…` |
| base | merge-base `c822995d`, `ZBOGR544` |
| M1 | head without `lateRestoredWorkspaces.add(workspaceCwd)` |
| head + patch | `4BR4CFW7` |

Every oracle is on the wire:

- a real daemon from each arm's bundle
- the real `plugin-example` adapter
- one real WebSocket peer per channel that counts connects and closes
- real folder trust through `QWEN_CODE_TRUSTED_FOLDERS_PATH`
- state read from `GET /workspace/channel`

The E2E suite swaps `dist/` per arm, because `integration-tests/globalSetup.ts` pins `TEST_CLI_PATH` to `dist/cli.js`. A first attempt that set `TEST_CLI_PATH` silently ran the same bundle twice.

### Finding 1 — reproduced, 5-line fix

**Fixture.** Two checkouts of one repo:

- `wsA` is registered at boot as a non-primary workspace.
- `wsB` registers later.
- Both have the same `.qwen/settings.json`: `bot` and `other` with no `cwd`, and `serve.channels: ["bot","other"]`.

**Sequence:**

1. `wsB` registers. Every name it lists is already hosted, so the hook returns at `pending.length === 0` and `lateRestoredWorkspaces.add()` is never reached.
2. The operator runs `POST /workspaces/:wsA/channels/bot/stop` → 200. Hosting stays enabled because `other` remains.
3. `wsB` is removed and registered again.

| after re-registering wsB | selection | peer `bot` | wsA worker |
| --- | --- | --- | --- |
| base `c822995d` | `[other]` | 1 connect / 0 open | pid unchanged |
| **head `c00d385`** | **`[other, bot]`** | **2 connects / 1 open** | **restarted** (2973747 → 2973759) |
| head + patch | `[other]` | 1 connect / 0 open | pid unchanged |

This contradicts the guarantee in `docs/users/qwen-serve.md` and the design docs: "registering it again later … does not repeat the restore, so a channel you stopped in between stays stopped".

**Fix.** Record the workspace once it has asked for anything, before the already-hosted names are filtered out. A workspace with no `serve.channels` returns before the record, so the trade-off Stage 3 raised does not apply: a workspace that gains `serve.channels` later still restores when it registers again. That follows from the code; I did not drive it.

```diff
         const requested = startupChannelsForWorkspace(workspaceCwd);
+        if (requested.length === 0) return;
+        // Recorded before the hosted names are filtered out: a workspace whose
+        // every name was already hosted has had its restore, and coming back
+        // later must not bring up a name an operator stopped in between.
+        lateRestoredWorkspaces.add(workspaceCwd);
         const committed =
           committedSelection?.mode === 'names' ? committedSelection.names : [];
         const pending = requested.filter((name) => !committed.includes(name));
         if (pending.length === 0) return;
-        lateRestoredWorkspaces.add(workspaceCwd);
```

**Regression test.** I added `counts a registration whose names were all hosted as its one restore`, built on the fixture from your `does not move a hosted channel…` test. The operator's stop is `PUT /workspace/channel` narrowing to `[other]`. Results:

| Run | Result |
| --- | --- |
| New test on head | **red**: `names: ["other", + "shared"]` |
| New test with the patch | green |
| `run-qwen-serve` / `channel-startup-restore` / `channel-workspace-grouping` / `channel-worker-manager` with the patch | **543/543** |
| `tsc --noEmit` (packages/cli) | exit 0 |
| `eslint --max-warnings 0` | exit 0 |
| `prettier --check` | clean |
| Patch with the record deleted (M1) | the new test **fails**; `restores a workspace's channels once per daemon…` still passes |

The last row matters because M1 survives today's suite (the sandboxed round's 457/457). This test is the one that pins it. The full diff, including the test, is in `fix-f1.patch` in the evidence directory.

### Stage 3 Finding 2 — not reproduced, and why

**Fixture.** `wsA` and `wsB` each list one channel they own. The daemon boots with none.

| wsB registered after wsA | both workers running | wsB `POST /workspaces` |
| --- | --- | --- |
| concurrent | 3/3 | 961–987 ms |
| 0 ms | 3/3 | 727–733 ms |
| 250 ms | 3/3 | 480–495 ms |
| 500 ms | 3/3 | 238–244 ms |
| ≥ 1000 ms | 9/9 | 15–16 ms |
| base, 0 / 250 ms | nothing restored | 8–9 ms |

**Other shapes:**

- 6 concurrent registrations: 6/6 running, three times.
- Operator stops `q` (still in flight), and a workspace registers 150 ms later: the selection ends at `[p, b]` and `q` stays stopped.
- Operator `DELETE /workspace/channel` (still in flight), and a workspace registers 30 ms later: hosting stays off.

**Why it does not reproduce.** When the manager already exists, the same hook first awaits `channelWorkerManager.restoreWorkspace()` and `refreshWorkspaces()`. Both are queued on the manager lane behind the in-flight restore. So `wsB` reads `state()` only after `wsA`'s selection has committed. In all 12 overlapping runs, the second registration's POST returned 10–11 ms after the first workspace's peer connected.

**The window that is left.** A second activation can still read stale state if it enters the hook before the daemon's *first* manager exists, between `wsA`'s hook returning and `ensureChannelWorkerManager` assigning the manager. I traced this; I did not observe it. TLS mode adds a live handshake probe to manager creation, which could widen it; I did not test TLS.

### The cost of that mask — registrations wait behind another workspace's channel startup

**Fixture.** `wsA`'s channel points at a peer that accepts TCP and never answers the upgrade. `wsC` configures **no channels at all** and registers 300 ms after `wsA`.

| Arm | wsC `POST /workspaces` |
| --- | --- |
| base | **9 ms** |
| head | **29,725 ms** |
| head + patch | 29,726 ms |

The daemon log shows `wsC`'s request completing 1 ms after `serve.channels … were not restored: Channel worker did not become ready within 30000ms`.

This is the rev1 bystander stall (29.9 s), still present one registration later. The `void` protects the workspace that registers. The next registration's hook still awaits the lane while it holds the runtime-topology gate. That is the situation the new comment says the detach avoids ("every other registration … queues behind it, including workspaces that configure no channels at all").

With a healthy peer the stall is the rest of one worker startup: 0.2–1 s in the table above. So I would not block on it. But the PR body's "`POST /workspaces` itself is not slower" is only true for the first registration, and it should be corrected or tracked in #12432.

The two issues are linked. Detaching the existing awaits would remove the stall, but it would also remove the barrier that currently hides F2. A fix for the stall needs the selection delta computed inside the manager lane at the same time.

### Non-blocking observations

- **A failed late restore reads as "hosting stopped".** `wsA`'s channel points at a closed port and its restore fails. Afterwards a healthy `wsD` is skipped with `skipping serve.channels … channel hosting is stopped`, and `d` never connects. Nobody stopped hosting. Base does not restore `wsD` either, so this is a gap in the new feature, not a regression. It is Stage 3's point that the guard "cannot tell an operator's stop from this feature's own startup", measured in its failure form rather than the in-flight form.
- **A never-seen sibling checkout revives the stopped channel.** This uses the same fixture as Finding 1, but a new `wsC` registers after the stop. Head *and* head + patch bring `bot` back; base keeps it stopped. This is the per-channel-intent limitation you already listed in #12432, and I am not asking for it here. If you want a cheap narrowing later: restore only names whose resolved owner is the registering workspace. That also fixes Finding 1 on its own.
- **S1 on a real daemon.** With the primary also hosting `p`, head keeps `a1` stopped after removal and re-registration. M1 revives it (`a1` 2 connects / 1 open).
  - The single-workspace two-channel fixture the sandboxed round proposed but did not build does **not** separate M1 from head. Permanent removal drops `wsA`'s names, the selection empties, and `stopSelectionNow()` runs. The hook then exits at the stopped-hosting guard, and M1's log shows `hosting is stopped`.
  - As documented, `a2`, which the operator never stopped, also does not come back after removal and re-registration.
- `restoring channels from workspace serve.channels` logs `requestedByWorkspace="[object Object]"`. This predates this PR (it came with #12385).

### Not covered

- macOS and Windows.
- TLS mode.
- The trust-re-materialization activation path, which I did not drive.
- Real third-party adapters; I used `plugin-example` only.
- The F2 residual window: I did not inject a delay to force it.
- SIGTERM with a startup in flight: not re-measured.

### Evidence

Evidence directory: `pr-12396/` on the `asserts` branch of `wenshao/qwen-code`. It holds `harness/probe.mjs` (12 scenarios), the per-arm build scripts, `facts.json` (every number above), and every per-run JSON. The figures are generated from `facts.json`, not typed in.

![central claim](01-central-claim-and-e2e.png)
![finding 1](02-finding1-stopped-channel-revived.png)
![S1 and M1](03-s1-once-per-daemon-and-m1.png)
![finding 2 and the bystander stall](04-finding2-masked-and-bystander-stall.png)
![patch](05-patch-red-green-gates.png)
