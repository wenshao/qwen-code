## Maintainer verification — live environment, Linux

I built a real end-to-end environment for this PR (a real `qwen serve` daemon, real spawned ACP children, two OpenAI-compatible mock providers on separate ports, and the real Web Shell in Chromium) and ran the reviewer test plan plus my own probes against **both** the merge base and the PR head.

| | |
|---|---|
| PR head | `23ad39acbb` |
| Merge base | `bc6f1a015cfb5e03a078733cbcfdb8bd05425fad` |
| Platform | 🐧 Linux (Debian 13, kernel 6.12.63), Node v22.22.2 — the PR body lists Linux as *not tested* |
| Daemon | real `qwen serve --port 4581 --workspace ws-main --workspace ws-second --allow-private-auth-base-url` |
| Providers | `alpha-model` @ mock A `:4501` (seeded), `beta-model` @ mock B `:4502` (installed at runtime); each mock logs the `model` and the `Authorization` header it actually received |

**Verdict: the reported defect reproduces exactly on the merge base and is fixed by this PR. I recommend merging.** Two follow-ups below are worth a look — F1 in particular, because it leaves the original symptom reachable in a multi-workspace daemon while the response still reports `applied`.

---

### 1. The defect reproduces on the merge base

Session created → provider installed → the model is listed but the live session cannot use it:

```
### 1. install response (no runtimeSync field on main)
{ "status": 200, "body": { "v": 1, "providerId": "custom-openai-compatible", "modelId": "beta-model", ... } }

### 2. provider status LISTS the new model
[ "beta-model(openai)", "alpha-model(openai)" ]

### 3. selecting the visible route in the live session
{ "status": 500, "body": { "error": "Internal error", "code": -32603,
    "data": { "details": "Model 'beta-model' not found for authType 'openai'" } } }

### 4. SSE model_switch_failed frame
{ "type": "model_switch_failed",
  "data": { "requestedModelId": "beta-model(openai)", "error": "[object Object]" } }
```

### 2. The PR fixes it — end to end, not just in the response body

```
### 2. POST /workspace/auth/provider
{ "status": 200, "runtimeSync": { "status": "applied" } }

### 4. POST /session/:id/model beta-model(openai) on the PRE-EXISTING session
{ "status": 200, "body": { "_meta": { "qwenModelSwitch": {
    "authType": "openai", "modelId": "beta-model",
    "baseUrl": "http://127.0.0.1:4502/v1", "apiKey": "bet...t-v1" } } } }

### 6. turn after the hot switch (which mock answered?)
MOCKB:hello-after-switch
```

The mock's request log confirms the credential really travelled, not just the route:

```
[{ "label": "MOCKB", "model": "beta-model", "auth": "Bearer beta-secret-v1" }]
```

### 3. Reviewer test plan — all six steps

| Step | Result |
|---|---|
| 1–2. Install on a pre-existing session, then select the route with no restart | ✅ `runtimeSync.status = applied`; switch returns 200; the turn is served by mock B |
| 3. Install while a turn is active | ✅ install returned in **15 ms** mid-turn; the running turn finished on its original generator (`MOCKA:SLOW-DONE`), the new model was selectable afterwards |
| 4. Delete the model | ✅ `{removed:true, clearedActiveModel:true, runtimeSync:{status:"applied"}}`; gone from provider status; the live session was **not** switched and kept serving from its already-held generator (`MOCKB:after-delete`); the stale route is rejected; `alpha-model(openai)` still selectable and still routes to mock A |
| 5. Rebuild the ACP channel | ✅ `kill -9` on the ACP child → the replacement child selects the new route and presents `Bearer beta-secret-v1` |
| 6. Inject a failure | ✅ with the workspace `.env` made unreadable: HTTP **200** + `runtimeSync.status = failed`, user settings **not** rolled back, provider still listed, and the Web Shell warns (not errors) |

`qwen-oauth` models survive the `ModelRegistry.reload()` rewrite — `coder-model(qwen-oauth)` is still listed after every mutation, so the constructor's hard-coded re-registration does replace the old "preserve qwen-oauth" branch correctly.

### 4. Concurrency

8 provider installs interleaved with 8 session creations: every install returned `applied`, every session was created in ~30 ms, and **all 8** sessions created during the storm could immediately select the last-installed model. The new `while (true)` re-reload loop before session publication did not livelock or measurably slow session creation.

### 5. Evidence

**Model picker of the same live conversation, before and after**

![model picker](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr10269/pr10269/01-model-picker.png)

**The `[object Object]` fix, same failure on both sides**

![switch error](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr10269/pr10269/02-switch-error.png)

**Hot switch in a pre-existing Web Shell conversation**

![hot switch](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr10269/pr10269/03-hot-switch.png)

**The `failed` warning path**

![runtime sync failed](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr10269/pr10269/04-runtime-sync-failed.png)

---

### Findings

#### F1 — the sync stops at the primary workspace, but the status still says `applied` *(recommend addressing)*

`DaemonClient.installAuthProvider` / `deleteModel` always call the unqualified `/workspace/auth/provider` and `/workspace/models`, and `createServeApp` wires `syncModelProvidersRuntime` only to `primaryWorkspace.reloadModelProviders(...)`. `modelProviders` is persisted at **user** scope, so every workspace's provider status lists the new model — but only the primary workspace's ACP child is refreshed.

Reproduced 2/2 with the daemon bound to `ws-main` (primary) and `ws-second`, both with a live warmed session:

```
### install (unqualified route = primary workspace)
{ "status": 200, "runtimeSync": { "status": "applied" } }

### switch in PRIMARY workspace session
{ "status": 200, ... }

### switch in SECONDARY workspace session
{ "status": 500, "body": { "error": "Internal error", "code": -32603,
    "data": { "details": "Model 'beta-model' not found for authType 'openai'" } } }
```

That is issue #10184 verbatim, still reachable, and because the status is `applied` the Web Shell shows no warning at all. The scope note says qualified multi-workspace mutation routes are out of scope — that is fine, but the *unqualified* route mutates state that is global to the daemon, so either the sync should iterate every live workspace runtime, or the status should not be `applied` when other live children were left stale.

Partial mitigation that already works: a session created in `ws-second` **after** the install resolves the model correctly — the new pre-publication reload path covers new sessions. Only pre-existing sessions in non-primary workspaces are stuck.

#### F2 — after installing from the Web Shell, the open conversation's model picker only updates on a page reload

On the PR build: live conversation → `/auth` → Custom Provider wizard → save → `Successfully configured Custom Provider.` Then opening the model picker at t+0 s, t+5 s and t+10 s shows only `alpha-model`. After `F5` and reopening the same conversation the picker lists `beta-model` and switching works.

The daemon is genuinely fixed here (`POST /session/:id/model` succeeds immediately over REST), but `AuthMessage.save()` only calls `onMessage()` / `onClose()` — unlike `handleDeleteModel`, which does call `reloadProviders()` / `reloadWorkspaceSettings()`. So the flow the PR is aimed at ("install a model, then use it in the conversation I already have open") still needs a manual reload. Not a regression — `main` behaves the same and then also fails the switch — but it blunts the user-visible half of the fix, and it is a small change next to what this PR already does.

#### F3 — `failed` over-warns when only the parent environment is degraded

With the parent env-file read failure injected, the **child** reload still succeeded, so the live session could select and use the new model right away — yet the response is `failed` and the Web Shell says *"running sessions could not be refreshed. Restart qwen serve…"*. This matches the documented fail-closed intent (the parent snapshot for future children really was not refreshed), so I am not asking for a change; just noting that the user-facing wording claims something stronger than what actually failed.

#### F4 — the two mutations now have no client-side deadline at all

`withActionTimeout` was removed from `installAuthProvider` / `deleteModel` in `packages/webui/src/daemon/workspace/actions.ts`, and `DEFAULT_PROVIDER_MUTATION_TIMEOUT_MS = 0` disables the SDK fetch timer, so the browser has no bound of its own. Measured with the ACP child(ren) `SIGSTOP`ped: `POST /workspace/auth/provider` returned **200 after 25.7 s** (single child) and **24.3 s** (three children) — inside the daemon's own 30 s `invokeWorkspaceCommand` budget, so the change is defensible and the spinner does terminate. Worth considering a generous client bound (60–90 s) rather than none, so a daemon-side path that misses the budget (e.g. a `withSettingsLock` held by a slower operation) cannot spin the UI forever.

### Incidental improvement worth calling out

`LoadedSettings.reloadScopeFromDisk` now clears the workspace scope when `workspaceSettingsActive` is false instead of re-reading it from disk. That closes a real hole beyond this PR's title: previously, a reload in an untrusted / `skipWorkspaceSettings` workspace would merge the workspace settings file back in. `settingsWatcher` benefits from the same fix.

### Static gates (PR head, clean `npm ci` + `npm run build`)

| Gate | Result |
|---|---|
| `npm run typecheck` | ✅ exit 0 |
| `npm run lint` | ✅ exit 0 |
| `packages/cli` (10 affected files incl. `acpAgent`, `Session`, `settings`, `settingsWatcher`, `environment`, `workspace-models`, `run-qwen-serve`, `server`, `facade`) | ✅ 3072 passed |
| `packages/acp-bridge` `bridge.test.ts` | ✅ 804 passed |
| `packages/core` `config` + `modelRegistry` | ✅ 667 passed |
| `packages/sdk-typescript` `DaemonClient.test.ts` | ✅ 360 passed |
| `packages/web-shell` `App` + `AuthMessage.dom` | ✅ 556 passed |
| `packages/webui` `workspace/actions.test.ts` | ✅ 18 passed |

**5477 tests, 0 failures.**
