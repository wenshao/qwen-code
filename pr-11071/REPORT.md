## Maintainer verification: real `qwen serve` daemon, base vs head vs a narrowed guard (head `39f8072927`)

**Verdict: the central fix works on a real daemon and is worth merging, but I'd narrow one condition first.** The mid-transition guard that `3130436fc` moved above the branch split is load-bearing: I reproduced on base two races it closes. But `transition` is a single value for the whole daemon, so head also refuses *ordinary* configured-Channel `DELETE`s that no transition can affect. That includes a channel that is running in its own workspace, and a channel that isn't running at all. In both cases head returns a false `409 channel_runtime_owner_mismatch` whenever **another** workspace is mid-transition.

The §4 patch keeps head's guard and only narrows it on the configured branch (service +22/−2, mostly comments). It is identical to head wherever the in-flight transition may be starting the channel, and identical to base elsewhere. Everything below was measured.

**Setup.** Linux, Node 22.22.2. Full `npm run build && npm run bundle` for **base** `8c914ebe03` (merge-base) and **head** `39f8072927`, plus a third bundle **fix** = head + the §4 patch. Each run starts a real daemon (`dist/cli.js serve`) with real `channel daemon-worker` child processes running the plugin-example adapter. Each channel gets one real WebSocket peer that records connects and closes. Worker PIDs are checked in `/proc`. Nothing below the HTTP route is mocked. I ran 18 scenarios per arm; raw JSON for every run is linked at the end. Three rounds of independent adversarial audit went into the patch.

### 1. Central claim: confirmed on a real daemon

![Config loss → DELETE, real daemon, base vs head](01-config-loss-real-daemon-base-vs-head.png)

| Step (A and B each host one channel; A's `channels.botA` removed from disk) | base | head |
| :-- | :-- | :-- |
| `DELETE /workspaces/A/channels/botA`, current revision | `404 channel_instance_not_found`; A's worker PID alive; `serve.channels` still `["botA"]` | `200` (30 ms); A's worker PID exited, peer closed; `serve.channels: []`; **B's worker keeps the same PID** |
| Repeat with the current revision | `404` again, cannot converge | `200` (idempotent) |
| Stale revision | `404` | `409 channel_settings_conflict`; worker alive, settings file byte-identical |
| Ordinary configured delete (regression control) | `200`, worker exits | identical |

The PR body undersells one thing: **#11063's stuck state affects the whole daemon.** While the lost-config channel stays committed, starting *any other* channel in *any* workspace re-resolves the whole selection and fails with `400 channel_workspace_mismatch` ("Channel "botA" is not configured in any registered workspace…"). On base that is permanent, because DELETE stays 404. On head, one DELETE clears it and the other start then succeeds (`200`, 527 ms).

### 2. Finding: the guard refuses deletes that no transition can affect (reproduced; should fix)

This reproduces sandboxed-verification Finding 1 and deferred D8-3, now on a real daemon with ordinary lifecycle triggers. See the first group in the figure below.

Workspace **C** is registered at runtime. Its `serve.channels` restore starts a channel whose peer never answers, so the manager sits in `reconciling` for the 30 s startup budget. During that window:

- **A's running `botA`**, deleted with the correct revision: base returns `200` after **29.1 s**, queued in the manager lane, and the worker exits. Head returns `409 channel_runtime_owner_mismatch` in **9 ms**: "does not have one confirmed runtime owner in this workspace. The channel runtime is mid-transition." A's single owned worker was alive the whole time.
- **A's `botS`, configured but not running:** base returns `200` in 5 ms. Head returns `409`.
- **Control:** `POST /workspaces/A/channels/botA/stop` during the same transition waits about 29.5 s and succeeds on **all three** arms. On head, the two sibling mutations therefore disagree: `stop` queues, `delete` refuses.

The machine-readable `code` claims an ownership problem, so a client cannot tell "busy, retry" from a genuinely ambiguous owner. The window opens whenever any other workspace starts, restores or reloads a channel.

### 3. The guard is load-bearing, so it can't just be moved back

It closes two base races in which the DELETE lands after the worker has read its config but before the manager commits:

- **Late-registration restore of the same channel** (R6-1). Workspace A is registered at runtime and restores `serve.channels: ["botA"]`; the peer answers after 6 s. Base returns `200` in 11 ms and deletes the config. Six seconds later the restore commits anyway, leaving an **orphan**: A's worker alive, peer connected, list shows `[]`, and DELETE again returns `404`. That is #11063 produced from a clean start. Head returns `409`, and a retry after the manager settles returns `200`.
- **`--channel all` reload bringing up a channel just added on disk.** One of my audit rounds found this. Base returns `200` and leaves the `botN` worker connected with no config; head returns `409` and converges on retry.
- If the DELETE lands *before* the worker reads its config, base happens to be safe: the worker exits with "Channel "botA" not found in settings" (`data/base-inflight-early.json`).

Keeping the guard only in the missing-config branch (the sandboxed-verification suggestion) leaves the configured branch identical to base, so both races come back as **hidden** orphans. The delete answers 200 and the list is empty, but the worker keeps running and blocks other starts. It is recoverable through the PR's convergence path, but only by deleting a name the list no longer shows. Three of the patch's tests fail for that variant (§5).

### 4. Suggested fix: fire the configured-branch guard only when the transition may be starting that channel

A worker the manager is still starting is invisible: it is neither in `committedChannelNames()` nor in the worker snapshots. The only published trace is the transition's `pendingSelection`.

So on the configured branch the patch keeps head's 409 unless one of these three cases applies:
- **(a) this workspace already runs the channel** (committed and owned here). The existing stop goes through `setChannelEnabled`, which queues behind the transition and re-checks the owner inside the manager lane, and the config is removed only after the stop settles.
- **(b) the candidate selection leaves the name out**, so nothing in flight starts it.
- **(c) the transition has no candidate selection at all.** That is `stopping` only, which starts nothing.

The missing-config branch is untouched.

<details>
<summary>Patch (applies cleanly to <code>39f8072927</code>; service +22/−2, test +91/−0)</summary>

```diff
--- a/packages/cli/src/serve/channel-management-service.ts
+++ b/packages/cli/src/serve/channel-management-service.ts
@@ -284,6 +284,22 @@
     throw runtimeOwnerMismatch(name, reason);
   };
 
+  // Whether a mid-transition manager may be bringing this channel up. It
+  // publishes neither a committed name nor a worker for a channel it is still
+  // starting, so any name in its candidate selection that this workspace does
+  // not already run is unknown until it settles. A channel this workspace
+  // runs is safe to act on — its stop queues behind the transition and
+  // rechecks the owner inside the manager's lane — and so is one the
+  // candidate selection leaves out.
+  const mayBeStarting = (name: string): boolean => {
+    const { transition, pendingSelection } = opts.manager.state();
+    if (transition === 'idle' || !pendingSelection) return false;
+    if (workspaceCommittedNames().includes(name)) return false;
+    return (
+      pendingSelection.mode === 'all' || pendingSelection.names.includes(name)
+    );
+  };
+
   const runtimeFor = (name: string): ChannelRuntimeState => {
     const retainedError = diagnostics.get(name);
     if (retainedError) return { state: 'error', lastError: retainedError };
@@ -510,8 +526,13 @@
       // workers and nothing committed, which reads as silent without being
       // it; the caller retries once the manager settles. Guarded above the
       // branch split because the configured branch reads the same
-      // mid-transition committed set.
-      if (opts.manager.state().transition !== 'idle') {
+      // mid-transition committed set, but only for a channel the transition
+      // may be starting: `transition` is one value for the whole daemon.
+      if (
+        configured
+          ? mayBeStarting(name)
+          : opts.manager.state().transition !== 'idle'
+      ) {
         throw runtimeOwnerMismatch(
           name,
           'The channel runtime is mid-transition.',
--- a/packages/cli/src/serve/channel-management-service.test.ts
+++ b/packages/cli/src/serve/channel-management-service.test.ts
@@ -1033,6 +1033,7 @@
     vi.mocked(manager.state).mockReturnValue({
       ...state,
       transition: 'starting',
+      pendingSelection: { mode: 'names', names: ['bot'] },
       workers: [
         {
           enabled: true,
@@ -1057,6 +1058,108 @@
     expect(store.remove).not.toHaveBeenCalled();
   });
 
+  it('queues a configured deletion behind an unrelated transition instead of rejecting it', async () => {
+    // `transition` is one value for the whole daemon: another workspace
+    // starting its channel must not turn this workspace's ordinary delete of
+    // a channel it runs into a 409. The stop queues behind that transition,
+    // and the configuration is removed only once the stop has settled.
+    const { service, store, manager } = setup({ committedNames: ['bot'] });
+    const state = manager.state();
+    vi.mocked(manager.state).mockReturnValue({
+      ...state,
+      transition: 'reconciling',
+      pendingSelection: { mode: 'names', names: ['bot', 'other'] },
+    });
+    let settleStop!: () => void;
+    vi.mocked(manager.setChannelEnabled).mockReturnValueOnce(
+      new Promise<void>((resolve) => {
+        settleStop = resolve;
+      }),
+    );
+
+    const removal = service.remove('bot', { expectedRevision: 'rev-1' });
+    await vi.waitFor(() =>
+      expect(manager.setChannelEnabled).toHaveBeenCalledWith(
+        { name: 'bot', workspaceCwd: WORKSPACE },
+        false,
+      ),
+    );
+    expect(store.remove).not.toHaveBeenCalled();
+    settleStop();
+    await removal;
+    expect(store.remove).toHaveBeenCalledTimes(1);
+  });
+
+  it('deletes a configured channel the in-flight transition leaves out without waiting', async () => {
+    const { service, store, manager } = setup({ committedNames: [] });
+    const state = manager.state();
+    vi.mocked(manager.state).mockReturnValue({
+      ...state,
+      transition: 'reconciling',
+      pendingSelection: { mode: 'names', names: ['other'] },
+    });
+
+    await service.remove('bot', { expectedRevision: 'rev-1' });
+
+    expect(manager.setChannelEnabled).not.toHaveBeenCalled();
+    expect(store.remove).toHaveBeenCalledTimes(1);
+  });
+
+  it('rejects a configured deletion of a name another workspace runs while a transition lists it', async () => {
+    // Selection names are not workspace-qualified, and a worker the
+    // transition is still starting is not visible yet, so a name another
+    // workspace runs cannot be told apart from one moving to this workspace.
+    const { service, store, manager } = setup({
+      committedNames: ['bot'],
+      workspaceCwd: '/tmp/other-workspace',
+    });
+    const state = manager.state();
+    vi.mocked(manager.state).mockReturnValue({
+      ...state,
+      transition: 'reconciling',
+      pendingSelection: { mode: 'names', names: ['bot', 'other'] },
+    });
+
+    await expect(
+      service.remove('bot', { expectedRevision: 'rev-1' }),
+    ).rejects.toMatchObject({ code: 'channel_runtime_owner_mismatch' });
+    expect(store.remove).not.toHaveBeenCalled();
+  });
+
+  it('rejects a configured deletion while an all-channels selection is starting', async () => {
+    const { service, store, manager } = setup({ committedNames: [] });
+    const state = manager.state();
+    vi.mocked(manager.state).mockReturnValue({
+      ...state,
+      transition: 'starting',
+      pendingSelection: { mode: 'all' },
+    });
+
+    await expect(
+      service.remove('bot', { expectedRevision: 'rev-1' }),
+    ).rejects.toMatchObject({ code: 'channel_runtime_owner_mismatch' });
+    expect(store.remove).not.toHaveBeenCalled();
+  });
+
+  it('stops and deletes a configured channel while the manager is stopping everything', async () => {
+    // A stopping transition starts nothing, so it has no candidate
+    // selection; the stop queues behind it.
+    const { service, store, manager } = setup({ committedNames: ['bot'] });
+    const state = manager.state();
+    vi.mocked(manager.state).mockReturnValue({
+      ...state,
+      transition: 'stopping',
+    });
+
+    await service.remove('bot', { expectedRevision: 'rev-1' });
+
+    expect(manager.setChannelEnabled).toHaveBeenCalledWith(
+      { name: 'bot', workspaceCwd: WORKSPACE },
+      false,
+    );
+    expect(store.remove).toHaveBeenCalledTimes(1);
+  });
+
   it('rejects a missing-config deletion when the configuration reappears during the worker stop', async () => {
     // The revision token covers only this scope's files, so a configuration
     // written back to another scope while the worker stop is in flight must
```

</details>

![Mid-transition guard, three arms](02-mid-transition-guard-three-arms.png)

Measured on a real daemon:
- **Cases (a) and (b):** fix = base. Running `botA` returns `200` after 29.5 s, like `stop`; non-running `botS` returns `200` in 7 ms.
- **Both races:** fix = head. It returns `409` and converges on retry, with no orphan.
- **Everything else:** loss, stale, normal, poison, twin-loss and missing-config-during-transition are identical to head.
- **Arm validity:** after normalizing chunk hashes and paths, a statement-level diff of the head and fix bundles contains only the patched statements.

How this relates to the triage review, which I read after measuring:
- **"Await the transition instead of rejecting"** (stage 2): I built and measured two drafts of that approach before this one. Deferring whenever the manager isn't idle made a non-running channel's DELETE wait **29.5 s** and gave a same-named channel a **late** 409 after 29.3 s. Deferring only for pending, uncommitted names still produced a 409 after **6.0 s** while a same-named channel was starting in another workspace, and a 5.9 s wait under `--channel all`. Rejecting only where the start is possible, and answering immediately everywhere else, gave the cleanest measured behavior. Those runs are in `data/superseded-*`.
- **"Scope it to the first-start window"** (stage 3): that alone would miss the race I measured, which happened in `reconciling` because the primary already hosted `botP`. `pendingSelection` covers both.
- **Error code:** I agree the remaining refusal would read better with its own retryable code (for example the existing `channel_service_conflict`, already a 409) than with `channel_runtime_owner_mismatch`. The patch doesn't change it, to keep the published contract and the PR's tests stable. After the narrowing, every remaining 409 genuinely means "this channel may be starting, retry".

Three consequences to accept knowingly:
- **Same-named channels and `--channel all` stay conservative.** Selection names aren't workspace-qualified, so a channel whose name another workspace runs or is starting, and any non-primary channel during an `all` start, still gets head's retryable 409. Fix = head in those rows. An owner moving to this workspace looks exactly like that, so relaxing it would reopen the race.
- **The narrowing re-exposes one base availability gap that head only masks.** Suppose workspace A registers late while an unrelated transition runs, with its `serve.channels` restore `[botA, botW]` queued in the lane. A `DELETE botA` in that window succeeds at once on base and fix. The queued restore, whose names were read at registration, then fails as a whole: **`botW` was not deleted but never starts**, and A lists it as `error` with botA's message. Head's blanket 409 delays the delete until everything is up, so `botW` survives. Head has the same gap whenever the lane is busy with an operation that leaves the transition `idle`, such as another `restoreWorkspace` (traced). The root cause is that the late restore is all-or-nothing on a name snapshot. The better fix belongs there (tolerant grouping, or re-reading `serve.channels` inside the lane), as a small follow-up rather than a wider guard.
- **A running channel's DELETE during a transition waits in the lane**, as on base and as `POST …/stop` already does. The lane is FIFO, so several slow operations queued ahead add up, and later mutations for the same workspace queue behind it in the service lane. During daemon shutdown this path gets `setChannelEnabled`'s `503 daemon_draining` instead of a 409, which covers deferred item D8 ("settle guard also fires on `stopping`"). I traced that path but did not measure it.

### 5. Tests

![Tests and mutation matrix](03-tests.png)

- **Unit, head:** the 5 changed unit files pass 2130/2130. With the patch (5 tests added, and the existing configured-delete test given a realistic `pendingSelection`): 2135/2135.
- **Mutation:** each clause of the patch, and its `await`, is pinned by its own test. The head variant and the missing-config-only variant each fail 3 of the 7 transition tests.
- **Integration:** the `Integration Tests (CLI, No Sandbox)` job was **skipped** for this PR, so `qwen-serve-routes.test.ts` has never run in CI. Locally it passes **42/42** on the head bundle. Run against the **base** bundle, head's version of the file fails only on `advertises all baseline capabilities` (the new tag), so that test line is load-bearing.
- **Static checks on the patch:** `tsc --noEmit -p packages/cli`, `eslint --max-warnings 0` and prettier are all clean.

### 6. Other observations (non-blocking)

- **Two channels losing config at once** (the limit the PR discloses): on head, DELETE of each returns `400 channel_workspace_mismatch` naming the *other* channel, so neither converges. I measured an escape: `DELETE /workspace/channel` (which stops **all** hosting on the daemon), then both DELETEs return `200` and both startup selections are cleared. On base both stay `404` even after hosting is stopped. This operator recipe is worth one sentence in the docs.
- **Pre-existing on every arm (traced, not reproduced):** a `restoreWorkspace` that runs while the transition is `idle` with an `all`-mode selection can start a worker whose snapshot lists `['all']` without `requestedChannels`. A configured delete landing then skips the stop. Head and fix recover with a second DELETE through the convergence path; base can't.
- **Docs:** the sentence "a delete arriving mid-transition is rejected with `channel_runtime_owner_mismatch`…" in `15-channel-adapters.md` sits in the config-loss paragraph and stays accurate. After convergence the startup selection is written as `serve.channels: []` rather than removing the key, which is harmless.
- **Not covered:** macOS and Windows, real messaging providers, and the daemon-shutdown path (traced only).

**Evidence** (harness, raw JSON for every run, mutation reports, logs, patch, figures; superseded drafts of the patch and their runs are kept under `data/superseded-*`): [this directory](.) — `harness/probe.mjs` (real-daemon scenarios), `harness/render.cjs` (figures, every number read from `data/`), `data/SUMMARY.txt`, `fix-scoped-transition-guard.patch`

