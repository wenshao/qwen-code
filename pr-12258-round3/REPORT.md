# PR #12258 — Maintainer verification, round 3 (head `adc3c22803`)

**Verdict: B1 is fixed; the PR is merge-ready from my side.**

Round 2 ([comment](https://github.com/QwenLM/qwen-code/pull/12258#issuecomment-5769709588), head `8a2b0a6d3b`) found one blocker, **B1**: in WebKit a rendered App could strip its own iframe `sandbox` attribute (the App shares one per-render origin with its proxy) and then drive the top-level Qwen tab / open pop-ups, contradicting the design's isolation promise. This round re-tests only that fix and re-confirms the properties the fix could have broken.

## Setup

New head `adc3c22803` and prior head `8a2b0a6d3b`, each fully built (`pnpm install --frozen-lockfile` + `npm run build` + `npm run bundle`) and served via `dist/cli.js serve`. Real **Chromium 149** and **WebKit 26.5** (Playwright) load the bundled WebShell against a real daemon → real ACP child → real stdio MCP server running the official `@modelcontextprotocol/ext-apps` 1.7.5 App SDK (`app.callServerTool`). A separate local "vendor" origin mimics Tableau's `startSession` (rejects `Origin: null`) and doubles as the attacker landing page. Linux x86_64, Node.

## B1 — fixed

The dedicated sandbox route now delivers the sandbox policy in the **HTTP response header**, not just as a mutable iframe attribute:

```
Content-Security-Policy: sandbox allow-scripts allow-forms allow-same-origin; default-src 'self' 'unsafe-inline'; …
```

A header-delivered `sandbox` directive is applied to the document by the browser and cannot be removed by DOM manipulation, and its flags are inherited by the nested App frame. `allow-same-origin` is kept (so the App↔proxy postMessage/DOM bridge still works) but `allow-top-navigation*` / `allow-popups*` are withheld.

Same App-driven attack in all three arms — the App reaches its proxy DOM (same-origin, expected), strips the inner iframe's `sandbox` attribute, then from a fresh `srcdoc` child tries `top.location =` and `window.open()` to the attacker origin:

| Arm · engine | CSP `sandbox` header | App stripped the attr | Top tab navigated | Pop-up | Attacker hits |
| --- | :--: | :--: | :--: | :--: | :--: |
| **new head `adc3c2280` · WebKit 26.5** | ✅ present | yes | **no** | **no** | **none** |
| new head `adc3c2280` · Chromium 149 | ✅ present | yes | no | no | none |
| **prior head `8a2b0a6d3` · WebKit 26.5** | ❌ absent | yes | **yes → attacker page** | **yes** | `/topnav-by-app`, `/popup-by-app` |

![B1 three-arm](imgs/fig1-b1-three-arm.png)

The prior-head arm is the negative control: the identical probe still reproduces B1 in WebKit, so the test discriminates. On the new head the attack is neutralized in **both** engines, and it is the header CSP doing it — the App demonstrably still strips the iframe attribute (`strippedSandboxAttr: "allow-scripts allow-forms allow-same-origin"`), yet nothing escapes. A visible side effect confirms the header is active on the App document: `document.domain = 'localhost'` now throws `SecurityError: Assignment is forbidden for sandboxed iframe` (it succeeded at the prior head).

The unit tests pin both header variants (`mcp-app-sandbox.test.ts`): the primary route asserts `/^sandbox allow-scripts allow-forms allow-same-origin;/`, the opaque-fallback route asserts `/^sandbox allow-scripts allow-forms;/` (no `allow-same-origin`).

## Re-confirmed on the new head (things the fix could have broken)

- **App→server bridge stays gated & scoped.** App-initiated `get_embed_token` raises the WebShell approval dialog; on approval the raw token/JWT returns only to the App. `model_only_tool` and `no_such_tool` are rejected with no prompt and no server execution; the deny path cancels with no execution; `isError` is surfaced. ![matrix](imgs/fig2-app-tools-and-approval.png)
- **No secret leak.** The returned `SECRET-FIXTURE-*` token appears in **0 of 25** model requests and in **no** session transcript / chat ledger.
- **Per-render isolated origins + sibling isolation.** Two Apps in one page get distinct `<uuid>.localhost` origins; cross-App DOM access throws `SecurityError`; the nested vendor frame keeps its real origin and `POST /api/startSession` returns 200. ![siblings](imgs/fig3-sibling-isolation.png)
- **Cancel-on-reload** still fires (slow App tool aborted ~15 ms after reload); **after reload** the replayed App gets a fresh origin and can still call tools.
- **Changed unit tests green** at this head: `mcp-app-sandbox.test.ts` 14/14, `McpApp.dom.test.tsx` 15/15, `eventBus.test.ts` + `compactionEngine.test.ts` 200/200.

## Notes / not in scope

- The opaque-origin fallback (`mode=opaque`, dropping `allow-same-origin` when the isolated origin is unavailable) is present and unit-covered; I exercised the primary same-origin path end-to-end but did not force the origin-unavailable branch in a real browser.
- No authenticated Tableau/Amplitude live-service run; the fixture reproduces the App SDK wire behavior, not a specific vendor.

Rig + raw JSON under `harness/` and `data/`.
