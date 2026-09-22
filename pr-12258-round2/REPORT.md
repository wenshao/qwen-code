# PR #12258 — maintainer verification, round 2 (head `8a2b0a6d3b`)

**Verdict: needs one more fix before merge.** The MCP-Apps additions since round 1 hold up well in real browsers against a real daemon — App→server tool calls, per-render isolated origins, sibling/daemon isolation, and the resource-limit + degrade paths all behaved as designed. One boundary is weaker than the design doc claims: **B1 — in WebKit (Safari), a rendered App can navigate the top-level Qwen tab and open pop-ups.** It is engine-specific (Chromium blocks it) and PR-introduced. I'd hold the merge on B1; everything else is a pass.

Round 1 ([comment](https://github.com/QwenLM/qwen-code/pull/12258#issuecomment-5743184356), head `e59d0f0`) only exercised the core resource-limit layer. This round covers what was added afterward — the App→server tool bridge, the dedicated one-time-origin sandbox listener, and the replay/degrade code — plus the WebShell rendering, cold-restart replay, and `settings.json` paths round 1 left uncovered. Findings are **delta only**.

## How this was tested

| Piece | What ran |
| --- | --- |
| Arms | head `8a2b0a6d3b` vs merge-base `e1213d57d9`; each got a clean `pnpm install --frozen-lockfile`, full `npm run build` + `npm run bundle`, and `dist/cli.js serve` under its own `QWEN_HOME` |
| Browsers | real **Chromium 149** and **WebKit 26.5** (Playwright), loading the bundled WebShell the daemon serves |
| MCP server | a real stdio server on `@modelcontextprotocol/sdk` 1.30.0; its App HTML runs the official `@modelcontextprotocol/ext-apps` 1.7.5 App SDK (`app.callServerTool`). Tools: an App renderer, App-only `get_embed_token`/`failing_app_tool`/`slow_app_tool`, a model-only tool, and a `visibility:null` tool |
| Vendor origin | a separate local server that mimics Tableau's `startSession` and rejects `Origin: null` — the nested third-party frame case the PR is about |
| Model | only tool selection is scripted (an OpenAI-compatible fake that logs every request body); the full browser E2E ran 3× on head with identical results, plus a 4th run with recording hooks |
| Platform | Linux x86_64, Node 24 |

Real browser → real bundled WebShell → real daemon → real ACP child → real stdio MCP server. No mocked daemon, no `page.route` on the code under test.

## Finding B1 (blocking) — WebKit: an App can drive top-level navigation and pop-ups

The design of record promises the App stays walled off from the Qwen page: *"Both iframe layers … retaining sandbox restrictions on top navigation, popups and other ungranted capabilities"* (`docs/design/mcp-app-server-tools.md:27`). In WebKit this does not hold.

Because head grants `allow-same-origin` to **both** iframe layers (`packages/cli/src/serve/mcp-app-sandbox.ts:81`, `packages/web-shell/client/components/messages/McpApp.tsx:279`) and the App document and its proxy share one per-render origin, script inside the App document is same-origin with the frame element that sandboxes it. That lets the App's own script clear the restriction its frame relies on, and once the frame is no longer sandboxed, WebKit permits it to reach outside the card. Measured outcome, 4 s after the App's script runs:

| Arm · engine | App script reached the proxy DOM | top-level Qwen tab left the app | pop-up opened |
| --- | :--: | :--: | :--: |
| **HEAD · WebKit 26.5** | yes | **yes → attacker page** | **yes** |
| HEAD · Chromium 149 | yes | no (blocked) | no |
| BASE · WebKit 26.5 | no (`SecurityError`) | no | no |
| BASE · Chromium 149 | no (`SecurityError`) | no | no |

Controls in the same run confirm the discriminator: an App that leaves its frame untouched cannot navigate top or open pop-ups in **either** engine (both arms of the "App frame, sandbox unchanged" and "proxy frame" rows in `data/sandbox-boundary-matrix.json`). On base the App origin is opaque (`null`), so the App cannot reach the proxy DOM at all — this is a capability the PR's same-origin sharing newly introduces. Chromium's stricter cross-origin top-navigation-without-activation policy blocks the end effect, so today the user-visible impact is WebKit/Safari only; but the sandbox attribute being removable by the App is engine-independent, so the attribute is not a dependable isolation control on its own.

Impact: a malicious or compromised MCP App bundle can, for a Safari user, replace the whole Qwen tab (phishing / drive-by) or spawn pop-ups — the exact "App isolated from Qwen's UI" property the feature sells. Sibling-App and daemon-API isolation are **not** affected (see B-pass below); this is specifically the top-navigation/pop-up leg.

Figure 6 shows the three head/base engine states side by side. No reproduction steps or probe code are included in this bundle; the outcome matrix and screenshots are sufficient to confirm the class.

**Fix direction (a maintainer call):** the "no top navigation / no pop-ups" property has to sit on a layer the App cannot rewrite. Options, roughly in order of robustness: (a) deliver the sandbox policy as an HTTP `Content-Security-Policy: sandbox …` header on the App document from the listener — a header-delivered CSP sandbox cannot be undone by editing the element attribute; (b) give the App document its own origin distinct from the proxy so App script can't reach the proxy DOM (this keeps the nested-vendor-origin win but costs the proxy↔App same-origin channel the bridge currently uses); (c) at minimum, re-word `mcp-app-server-tools.md:27` and the zh-CN doc so they stop asserting a top-navigation guarantee that WebKit does not deliver. (a) or (b) is the real fix; (c) alone would only make the docs honest.

## Everything else verified — pass

**B-pass — the App→server tool bridge is correctly gated.** A real App calling `app.callServerTool` on an App-only tool (`get_embed_token`) raises the WebShell approval dialog through the session's own permission pipeline; on "allow once" the raw `content` + `structuredContent` (embed token / JWT) is delivered **only to the App**. Across all 7 runtime dirs (7 daemons, 81 model requests, every transcript / telemetry / debug log), the token value appears **zero** times outside the fixture's own `settings.json` — it never reaches a model request or the transcript; the model side sees only the fixed `"MCP App tool completed."` summary. Figures 1–2.

**Rejections (REST matrix, `data/rest-matrix-head.json`).** Against the live route: no client id → 403; unknown / other-session client id → 400 `invalid_client_id`; unknown session → 404; `resourceUri` not `ui://`, or `arguments` an array → 400; model-only tool, foreign server, unadvertised resource, prefixed (`mcp__…`) name, and `visibility:null` tool → all refused, server never executes. A concurrent model approval and App approval stay independent: aborting the App call leaves the model's approval answerable and the model turn completes; no ghost App approval is left behind.

**Policy layers apply to App calls (`data/policy-deny-head.json`).** A `PreToolUse` deny-hook blocks the App's tool (returns the hook's reason, server executes 0×); a `permissions.deny` rule returns `"… is disabled."` with no prompt and 0 executions; a `tools.exclude` entry likewise returns `is disabled`; an un-restricted control call on the same server reaches the prompt and, once approved, executes exactly once. `PostToolUse`/`PostToolUseFailure` hook payloads carry only the fixed summary, never the raw App result (`data/hook-payloads.jsonl`).

**Cancellation.** Approving `slow_app_tool` (30 s) then reloading the page aborts the in-flight call; the stdio server logs `aborted` ~15 ms after reload, and telemetry records the call as `cancelled`. Composer never sticks in *Processing* after a background App call.

**Per-render isolated origins & sibling isolation (Chromium + WebKit).** Each rendered App gets a fresh `uuid.localhost:<port>` origin on the dedicated listener. From an App origin, `GET /capabilities`, `POST /session`, and the `/terminal` WebSocket to the daemon are all rejected (daemon logs the 403 / `origin-not-allowed`); the consumed sandbox URL re-fetches as 404; `top.document` / `top.location` read as `SecurityError`. With three Apps in one page, every cross-App DOM pair is `SecurityError` in both engines (`data/siblings-*.json`). The listener answers only the exact registered Host + `GET /mcp-app-sandbox`; `POST`, other paths, `/session`, `/capabilities`, and a wrong Host all 404, and a minted URL serves exactly once (2nd GET → 404). `hostOrigin` must be loopback (`a.localhost`, `evil.com` → 400).

**The premise reproduces.** Same fixture App, same nested vendor frame: on **base** the vendor frame runs as `Origin: null` and the vendor's `startSession` fails; on **head** the frame keeps `http://127.0.0.1:<vendor>` and the call returns 200. Figure 1.

**Resource limits end-to-end + cold restart (Figure 4).** A 1.66 MB App under the default limit is dropped with an actionable warning naming `mcpServers.big.appResourceMaxBytes`, and the successful tool text is retained; the same App under `appResourceMaxBytes: 2 MiB` renders. After stopping the daemon and restarting it, the transcript replays the oversized-App warning and the configured-App render unchanged, each under a fresh isolated origin. Configuration survives the SDK/CLI/daemon round trip.

**Sandbox load failure (Figure 7, non-blocking, matches open thread R3-7).** When the sandbox document 404s or the `*.localhost` host can't resolve, the card renders as an empty box — the documented text fallback does not appear, because an HTTP-error iframe body fires no `error` event. This is exactly the still-open R3-7 suggestion; confirmed reproducible.

**Gates.** The 25 changed test files pass on head (**5,276 / 0**) and base (**5,195 / 0**). A 17-mutant sweep on the new logic (`data/mutation/`) killed **12** on the PR's own targeted suites; the **5** survivors (M3, M10, M11, M12, M14) stayed green even against the whole package suites, so they are genuinely unpinned, not just narrowly. Four map onto the open R3-13 coverage-gap thread: the App-call-id↔permission binding (`bridgeClient.ts:999`, M11), the disconnect-cancel (`session-control-plane.ts:3911`, M12), the ACP-child trust gate (`acpAgent.ts:11148`, M14), and the read-time `isToolDisabled` re-check (`tool-registry.ts:1194`, M3). The fifth, M10, deletes the registration-expiry check and no sandbox test turns red — its only "kills" on the broad `src/serve` run are 3 pre-existing root-only failures, identical on the unmutated control (`data/mutation/M10-broad-unmutated-control.json`), so the expiry branch is unpinned too. None of the five is a live defect (the disabled/deny/expiry behaviours all worked in the running daemon above); they are missing regression coverage, which is R3-13's point.

## Not covered
- Real Tableau / Amplitude services (author's own screenshots stand for those; out of scope here).
- Windows.
- The open Suggestion threads other than the two I touched above (R3-7 reproduced, R3-13 survivors measured) keep their disposition.

---

Figures: `01` origin + App-tools A/B · `02` App-initiated call → approval → private result · `03` two Apps, distinct origins · `04` resource limits after cold restart · `05` App on isolated origin in WebKit · `06` sandbox-boundary state, head/base × WebKit/Chromium (B1) · `07` blank card on sandbox load failure (R3-7). Harnesses and raw records under `harness/` and `data/`.

*Maintainer local verification. Claude Code — Claude Opus 4.8.*
