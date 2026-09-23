## Maintainer verification — PR #12541 @ `edbda92` (real daemon + real Web Shell, Linux)

**Verdict: mergeable.** The perf claim now has a number, and the activation semantics match base byte for byte on a real daemon. The entry set does change in two ways, and both come from the catalog loader (#12153), not from anything new in this route. One of them (R1-1) needs a maintainer decision. The other (N1, new here) has a verified 17-line core fix. Neither blocks the merge.

### What I ran

- Arms: **base** = `71bf6fa` (merge-base; this PR is one commit on it), **head** = `edbda92`, **fix** = head + the core patch below. Each arm is a real `pnpm install` + `npm run build` + `npm run bundle`, then `dist/cli.js serve` with an isolated `QWEN_HOME` and three workspaces: primary (trusted), secondary (trusted), and tertiary (`DO_NOT_TRUST`, with `security.folderTrust.enabled: true`). The tertiary workspace carries a planted `.qwen/settings.json` that disables every extension. If the route ever loaded it, the result would show.
- Scenarios (every response body is saved in the evidence dir): regular + linked install with workspace overrides; duplicate manifest name; malformed manifests; 6 and 40 "heavy" extensions for latency.
- Web Shell: the daemon-served UI in headless Chromium against the same on-disk state in every arm.

### Results

| Check | Result |
| --- | --- |
| Response equivalence (regular + **linked** install; `disabled` override on secondary and on primary; untrusted tertiary) | **Identical base vs head** on all 3 workspaces: rows, versions, `default/workspace/effective/activationSource`, `trusted`, desired/applied generation. The untrusted workspace stays readable (200, `trusted:false`), ignores the planted workspace settings, and does not fall back to the primary's override. |
| Latency, 6 ext × (8 skills, 8 cmds, 3 agents), n=60 | p50 **20.4 → 3.3 ms** (6.3×) |
| Latency, 40 ext × (40 skills, 40 cmds, 15 agents), n=40 | p50 **424.4 → 4.8 ms** (88×), p90 436 → 6.0 ms |
| PR test file `workspace-qualified-extensions.test.ts` | 55/55, ×3 runs. None of the intermittent 404s from the PR body showed up on Linux. |
| Negative control (base route + PR tests) | 2 fail: the unmocked fixture test (`refreshCacheWithSnapshot` called) and the untrusted projection test (identity resolver not called). The new tests do pin the swap. |
| Build | Full build + bundle green on Linux x64 / Node 22 |

![latency](fig3-latency.png)

### Finding N1 (new): a malformed manifest becomes a phantom "enabled" row that can't be acted on

The claim in `refreshCatalogSnapshot`'s docstring and in `loadExtension`'s `manifestOnly` comment ("the head throws for the same manifests the full load's catch would reject") does not hold. Two steps of the full load that come **after** the head, and are derived from the manifest alone, can throw:

- `substituteHookVariables` → `hook.command.replace` when `command` is not a string (for example `"command": 42`)
- `getContextFileNames` → `path.join(path, 5)` when `contextFileName` is not a string

The full load's `catch` skips such an extension, so runtime sessions and `GET /workspace/extensions` never see it. The manifest head accepts it. On the real daemon:

| arm | `GET /workspaces/:ws/extensions` | full status | `PUT …/:id/activation` on the extra rows |
| --- | --- | --- | --- |
| base | `good` | `good` | n/a |
| head | `bad-ctx`, `bad-hook`, `good` (all `enabled`) | `good` | operation **failed**: `Extension "<id>" not found` |
| fix | `good` | `good` | n/a |

`GET /extensions` has shown the same phantom rows since #12153. The fix arm removes them there too. The core test at `extensionManager.test.ts:3000` states the intent directly: "otherwise the catalog advertises an id that detail/enable/update routes reject as nonexistent". That is exactly what happens here. Only malformed manifests trigger it, so it doesn't block this PR. A fix, verified as follows: RED 2/176 → GREEN 176/176 in `extensionManager.test.ts`, eslint `--max-warnings 0` and core `tsc --noEmit` clean, rebundled daemon shows no phantom rows, and the other scenarios plus latency are unchanged:

<details><summary><code>catalog-parity.patch</code> (+17 prod / +31 test, packages/core)</summary>

```diff
@@ -1836,6 +1836,23 @@ export class ExtensionManager {
         // exactly the same extensions.
+        //
+        // Two manifest-derived steps of the full load can still throw on a
+        // malformed manifest without touching subresources (a non-string
+        // `contextFileName`, a non-string hook `command`). Run them here too,
+        // pure and I/O-free, so the catalog rejects the same manifests.
+        if (head.loadedManifest.format !== 'agent-plugins-v1') {
+          getContextFileNames(extension.config).forEach((contextFileName) =>
+            path.join(extension!.path, contextFileName),
+          );
+        }
+        if (
+          head.loadedManifest.format === 'qwen' &&
+          extension.config.hooks &&
+          typeof extension.config.hooks !== 'string'
+        ) {
+          this.substituteHookVariables(extension.config.hooks, extension.path);
+        }
         return extension;
```

The test (an `it.each` over both manifests, asserting catalog names == full-load names) is in the evidence dir: [`catalog-parity.patch`](catalog-parity.patch).
</details>

This PR deliberately leaves core untouched, so the patch can equally go in a follow-up.

### R1-1 (duplicate manifest name) reproduced end to end, and it shows up in the UI

Fixture: `my-ext/` (v1.1.0) plus `my-ext-copy/` (the `cp -r` case, same name, v9.9.9, no sidecar) plus `other/`. Base returns 2 rows. Head returns 3 rows, including `my-ext@1.1.0`, a version the full load (and so the mutation routes) never keeps. Both `my-ext` rows share one `extensionId`. What the user sees, with the same disk in every arm, real daemon, real Web Shell:

![hover card A/B](fig1-hover-count-ab.png)

On head, the workspace hover card (fed by this route via `summarizeExtensions`) says **Extensions 4**. The Plugins page, joined against full status, says **"2 extensions installed"**. The core patch above removes the phantom half (4 → 3). The duplicate half still needs the deliberate yes/no that the triage and /review already asked for. If the answer is "one row per name", the `byName` last-write-wins mapping from R1-1 is correct: mutant M2 below *is* that mapping and passes the whole suite, so it would need its own pinning test.

### Mutation matrix (changed route lines, `workspace-qualified-extensions.test.ts`)

| id | mutant | result |
| --- | --- | --- |
| M1 | drop `runtime.generationGuard?.assertOpen()` after the read | **survives** (line unchanged from base; pre-existing gap) |
| M2 | collapse rows by name (the R1-1 option) | survives (no cardinality pin, as R1-1 says) |
| M3 | serve zero rows | killed (2) |
| M4 | drop rows with no store policy | survives |
| M5 | blank identity `name` | killed (2) |
| M6 | resolve against the manager's default cwd instead of `runtime.workspaceCwd` | killed (1) |
| M7 | first row only | killed (1) |

A note on R1-2: its concern holds for the three reconciliation tests, which can't tell `[extension]` from `[]`. But the specific regression it names ("this route serves zero extensions") **is** caught at suite level: M3 fails the new unmocked fixture test (`toHaveLength(2)`) and the untrusted projection test. So the refactor it suggests is test hygiene, not a hole in coverage.

### Not verified

- macOS and Windows (Linux x64 only).
- Agent Plugins v1: I tried to show that the base GET mkdirs the stdio-MCP data root and the head GET does not. Neither arm created it in my fixture, so I make no claim either way.
- The CLI `--extensions` override (`cli_override` source) wasn't exercised on the daemon. It lives inside the unchanged identity resolver.

Evidence (harness, per-arm JSON for every response, figures, patch): [`wenshao/qwen-code@asserts/pr-12541`](.)
