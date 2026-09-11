## Maintainer verification — real two-workspace daemon + real Web Shell (Linux)

Verified on a real `qwen serve` daemon with two registered workspace runtimes and the real Web Shell driven by a browser. The PR body marks Linux as ⚠️ (not locally run), so this covers that gap.

**Verdict: works as described — recommend merge.** One non-blocking observation and one pre-existing gap (reproduced identically on base, so not caused by this PR) are recorded at the end.

<sub>Head `8c027e5d3a` (also re-ran the decisive checks against the earlier `4e35093986`) · Base = merge-base `2f426a64f4` · Node 22.22.2 · `npm ci && npm run build` green on both arms.</sub>

### Setup

Two workspaces `ws-a` (primary) and `ws-b` (secondary), both trusted, isolated `HOME`/`QWEN_HOME`, no model credentials needed for these routes:

```
qwen serve --workspace <…>/ws-a --workspace <…>/ws-b --port … --token …
```

Two probe extensions installed globally at user scope, each shipping one skill and one slash command:

| extension | ws-a | ws-b |
| --- | --- | --- |
| `wsprobe` | enabled (inherits global) | **disabled** (workspace override) |
| `wsprobe2` | enabled | enabled |

The whole A/B rests on that single asymmetry: with the composer/manager pointed at `ws-b`, anything that answers for `ws-a` will wrongly show `wsprobe`.

---

### 1. The defect this PR fixes, reproduced on base

With the **composer workspace set to `ws-b`**, base resolves Extension references through the primary-bound `GET /workspace/extensions`, so the `@` and `+` Extension menus list `wsprobe` even though it is disabled in the selected workspace. After the PR the same menus read `GET /workspaces/<ws-b>/runtime/extensions` and the list is correct.

![composer @ menu before/after](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11086/ab-composer-at-menu.png)

Observed network reads (captured from the browser, same store state on both arms):

| arm | composer workspace | request the client issued | `@`/`+` Extensions list |
| --- | --- | --- | --- |
| base `2f426a64` | `ws-b` | `GET /workspace/extensions` | `wsprobe`, `wsprobe2` ❌ |
| PR `8c027e5d` | `ws-b` | `GET /workspaces/<ws-b>/runtime/extensions` | `wsprobe2` ✅ |
| PR `8c027e5d` | `ws-a` | `GET /workspaces/<ws-a>/runtime/extensions` | `wsprobe`, `wsprobe2` ✅ |

Selecting `ws-a` still shows both, so this is not a blanket suppression — [screenshot](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11086/after-head-ws-a-at-menu.png).

### 2. Extension management follows the selected workspace

Base has no workspace selector on **Plugins ▸ Extensions** and reads the primary only, so `wsprobe` reads `enabled` regardless of which workspace you care about. The PR adds the selector and resolves through `/extensions` + `/workspaces/<ws-b>/extensions` + `/workspaces/<ws-b>/runtime/extensions`.

![extensions manager before/after](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11086/ab-manager-page.png)

The detail pane separates the two scopes correctly, and the live capability counts (`Commands 1`, `Skills 1`) come from the selected workspace's runtime:

![extension detail for ws-b](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11086/manager-detail-ws-b.png)

### 3. Enablement is reconciled into the *live* secondary runtime

This is the core claim, so it was driven through the real UI and read back from the daemon. Toggling **Workspace setting → Enabled** for `ws-b` in the manager page, with the runtime already live:

```
BEFORE  ws-b  runtimeEpoch=1  capabilities.extensions={state:ready, desiredGeneration:8, appliedGeneration:8}
              /workspaces/<ws-b>/runtime/extensions  wsprobe.isActive = false
              /workspaces/<ws-b>/runtime/skills      wsprobe-skill    = disabled (inactive_extension)

AFTER   ws-b  runtimeEpoch=1  capabilities.extensions={state:ready, desiredGeneration:9, appliedGeneration:9}
              /workspaces/<ws-b>/runtime/extensions  wsprobe.isActive = true
              /workspaces/<ws-b>/runtime/skills      wsprobe-skill    = ok
```

`runtimeEpoch` is unchanged at `1` across the toggle — the runtime was not replaced, the catalog was reconciled into it. `ws-a` kept `wsprobe` enabled throughout.

Installing a **new** extension while both secondaries are live behaves the same way: store generation advanced and `appliedGeneration` followed in *both* runtimes at `runtimeEpoch 1`, with `ws-b` retaining its own per-workspace override:

```
ws-a  epoch 1  {state:ready, desiredGeneration:3, appliedGeneration:3}   wsprobe isActive=true   wsprobe2 isActive=true
ws-b  epoch 1  {state:ready, desiredGeneration:3, appliedGeneration:3}   wsprobe isActive=false  wsprobe2 isActive=true
```

A live session in `ws-b` sees the extension's slash command with its `[wsprobe]` badge — [screenshot](https://raw.githubusercontent.com/wenshao/qwen-code/assets-pr11086/live-session-slash-commands.png).

### 4. Documented contracts spot-checked

| contract (from `qwen-serve-protocol.md`) | result |
| --- | --- |
| `workspace_extensions_config_runtime` + `workspace_extension_mentions` advertised when the workspace runtime is available | both present on PR, both absent on base |
| `GET /workspace{,s/:ws}/runtime/extensions` gated behind the feature | `404` on base, `200` on PR |
| the runtime-catalog read "does not start or prepare a cold runtime" | on a never-ensured `ws-b`: `initialized:false`, answered in **15 ms**, `runtime/status` still `cold` afterwards |
| runtime-catalog reads require a trusted target | untrusted `ws-b` → `403 untrusted_workspace` |
| the projection stays readable without trust and reports it in the body | untrusted `ws-b` → `200` with `trusted:false` |
| trusted target unaffected | `ws-a` → `200` |

### 5. Tests

All PR-touched suites pass locally at `8c027e5d3a`:

| package | files | tests |
| --- | --- | --- |
| `cli` (`workspace-runtime-coordinator`, `workspace-qualified-extensions`, `workspace-extensions-controller`, `acpAgent`, `server`, `run-qwen-serve`) | 6 | 2586 ✅ |
| `web-shell` (extensions, `useComposerCore.dom`, `useAtMentionMenu`, `AtMentionPanel`, `PluginManagerPage`) | 6 | 227 ✅ |
| `core` (`extension-store`) | 1 | 97 ✅ |
| `sdk-typescript` (`DaemonClient`) | 1 | 426 ✅ |

**Non-vacuity — four mutations, all killed.** Each reverts one specific guard this PR adds:

| mutation | killed |
| --- | --- |
| `GET /workspaces/:workspace/runtime/extensions` resolves `registry.primary` instead of the request's runtime | 3 route tests fail — **and the live E2E regressed to exactly the base defect**: with the mutated build the `ws-b` composer listed `wsprobe` again, from a workspace-qualified URL |
| `useComposerCore` always uses the primary-bound legacy loader | 7 `useComposerCore.dom` tests fail |
| `mergeExtensionCatalog` drops the runtime/coordinator epoch-agreement gate | 1 `extensions-manager-logic` test fails |
| `appliedGeneration` no longer re-certified against the live runtime epoch in `status()` | 1 coordinator test fails |

The first mutation is the important one: it proves the E2E oracle above is sensitive to the fix itself and not to incidental setup. Three of the four mutated files are byte-identical between `4e35093986` and `8c027e5d3a`; the route mutation was re-run at the tip.

---

### Findings (neither blocks merge)

**1 · Pre-existing, not caused by this PR — re-enabling an extension does not restore its slash command in an already-live session.**

Same session, same runtime, `ws-b`:

```
initial (enabled)   /wsprobe → /wsprobe-skill, /wsprobe-cmd   ✅
after disable       /wsprobe → (no matches)                   ✅  live refresh works
after re-enable     /wsprobe → (no matches)                   ❌  command does not come back
```

At that last point the daemon is correct — `/workspaces/<ws-b>/runtime/extensions` reports `isActive:true` and `runtime/skills` reports `ok` — and a **newly created** session in `ws-b` immediately shows `/wsprobe-cmd`. Only the pre-existing session is stale. **The identical sequence produces the identical result on base `2f426a64`**, so this is a pre-existing asymmetry in session-scoped re-activation refresh, not a regression from this PR. Worth a follow-up issue rather than a change here.

**2 · Observation — the new composer loader is not wrapped in the client action timeout.**

`workspace.actions.loadExtensionsStatus` (the loader being replaced) goes through `withActionTimeout(..., 30_000)`. The inline loader added in `useComposerCore.ts` does not, and it retries `ensureRuntime()` up to `COMPOSER_EXTENSIONS_MAX_ATTEMPTS = 3` on `503 runtime_still_starting`. Because the coordinator's own ensure deadline is 60 s and answers that exact 503 on expiry, a persistently slow secondary could hold the `@`/`+` Extensions menu on *Loading* for roughly `3 × 62 s + 2 × 2 s ≈ 190 s` instead of failing at 30 s.

This is bounded and narrow, and I did **not** reproduce it — on a genuinely cold `ws-b` the menu settled in **1.77 s**. Flagging it only because the timeout wrapper was dropped in the move, and a `withActionTimeout` around the whole loop (or a total budget across attempts) would restore the old bound cheaply.

**3 · Note, no action needed — the untrusted-secondary client branches are defence-in-depth.**

`useComposerCore`'s "omit the loader for an untrusted non-primary target" branch and the manager page's untrusted handling cannot be reached through the UI: with folder trust on, an untrusted workspace renders `aria-disabled` in *both* the composer workspace chip and the Plugins workspace selector, so it cannot be selected in the first place. The enforced boundary is the server's `403 untrusted_workspace`, which is verified above. The branches are unit-tested; this is just a note that they are belt-and-braces rather than the live path.
