# PR #12441 maintainer verification

## Maintainer verification: real browser, real daemon, real `Voice chat` session

**Verdict: merge-ready.** On a daemon serving one project (the reported topology), the merge-base client will not open a real `Voice chat` session. It sends no `/load`, logs the reported error, and leaves an empty pane. This PR's client opens it: `/load` → 200, full transcript, clean console. Each result held in 3 of 3 runs, including a cold reload of the session URL. The PR adds no failing request and changes nothing on the two-project path. The opened session also accepts a typed turn, which lands in the Live session's own transcript. Nothing blocking. Two older Live-session issues are listed at the end for follow-up; neither comes from this PR.

This round covers the gap that both the description ("Not captured: a browser before/after screenshot") and the triage report ("Not covered 1: a full end-to-end Live session open in a browser") left open. I did not repeat the triage comment's unit-level A/B or mutation matrix.

Verified head `4d1a7ab` (`e997170` merged with main `5f713a2`). Against the merge base, the client diff is exactly `session-context.ts` plus its test.

### Environment
- **Daemon.** `qwen serve` bundled from the PR head (`qwenCodeVersion` 0.24.3), with an isolated `HOME`/`QWEN_HOME`, `experimental.liveVoice.enabled: true`, and one workspace. The PR changes no daemon code, so both arms share this daemon.
- **Client arms**, both served by that daemon:
  - The PR head's Web Shell. Its vite build reproduces the bundled `index-DNf-0JQB.js` exactly.
  - The same tree with only `session-context.ts` restored to the merge base (`index-CwnEx9lP.js`).

  The daemon restarted before every run, and I checked the served asset hash each time.
- **The `Voice chat` session is real, not a fixture.** In Chromium with a fake microphone I clicked *Open Live Voice → Talk in this browser → New conversation*. Audio went through `/live/web` to the daemon's Live coordinator, then to a realtime provider and back. Then I clicked *Stop Live*.
  - The provider is the only scripted piece: a DashScope-shaped `wss://` server that answers the incoming audio with two scripted exchanges. The daemon trusts it through a local CA (`NODE_EXTRA_CA_CERTS`), and DNS is pinned to loopback for that one hostname only.
  - The daemon wrote the session itself: `session_source realtime_voice:<callId>`, `custom_title "Voice chat"`, and four `realtime_message` records.
  - Typed turns go to a local OpenAI-compatible stub.
- **`/capabilities`** on that daemon has exactly the shape in the description:
  - `multi_workspace_sessions` absent (142 features); `realtime_voice_web` present.
  - `workspaces[]` = the project (primary) and `…/Documents/Qwen Code/Conversations` (`kind:"live"`, `primary:false`, `trusted:true`).

![real Live call that produced the session](./02-real-live-call-seed.png)

### Result

![before/after on a single-project daemon](./01-ab-single-project-open.png)

| Scenario | merge-base client | PR client |
|---|---|---|
| 1 project, click `Voice chat` in the sidebar (×3) | no `POST /session/:id/load`; console `Daemon does not advertise multi-workspace session routing`; 0/4 lines rendered | `/load` → 200; 4/4 lines; no console error or warning |
| 1 project, cold reload of `/session/<id>?context=live` (×3) | no `/load`; empty pane | `/load` → 200; transcript restored |
| 2 projects (control: `multi_workspace_sessions` present) | opens (`/load` 200, 4/4) | opens, same requests |
| Live Voice disabled, deep link with `?context=live` | no `/load` | no `/load` (still fails closed) |
| 1 project, typed message in the opened Live session | n/a (cannot open) | `POST /prompt` → 202, reply rendered. Records appended to the same Live session file (cwd under `…/Conversations/conversation-<hash>`); nothing written under the project |

The four open cells are both arms × one or two projects. In all four, the only non-2xx response is the same older `GET /workspaces/<live cwd>/sessions/live-state → 400`, sent at page load. The PR adds no failing request.

![two-project control and a typed turn after opening](./03-control-and-typed-turn.png)

### On claims made earlier in the thread
- **Git-branch prefetch.** The author predicted it would get a 400 against the Live cwd (`DaemonSessionProvider.tsx:2033-2036`). It did not fire in any of the 8 opens captured with the PR client (0 git requests), which is consistent with the triage trace.
- **The `workspace_mismatch` sibling is not specific to one project.** On the two-project daemon, `GET /workspaces/<live cwd>/sessions/live-state` and the bare `GET /workspaces/<live cwd>/sessions` also return 400 `workspace_mismatch` (`workspaceCount: 2`).
  - The sidebar can still list the Live section because it requests with `?sourceType=default`, and that form returns 200 with the sessions.
  - The `live-state` 400 fires on every page load when Live is on, on either arm, and logs a `[session-live-state] request failed` warning.

### Older issues this PR makes reachable for single-project users (not blocking)

![pre-existing Continue execution behaviour](./04-preexisting-continue-execution.png)

1. **"Continue execution" replaces the spoken reply.** Every `Voice chat` transcript I opened showed *"The previous request was interrupted before the response completed. [Continue execution]"*.
   - Pressing it makes one backend model request and appends the answer to the spoken reply ("…next time we talk.Typed reply #7…").
   - After a reload the spoken reply no longer renders, only the backend answer. The record is still on disk.

   I reproduced this with the merge-base client on the two-project daemon, so it predates this PR. I did not trace where the banner comes from. It deserves its own issue next to #12440.
2. **Header title.** An opened Live session's header reads "New session" instead of "Voice chat". Same on both arms and both topologies.

### Gates
- `session-context.test.ts` + `transcript-page-table.test.ts`: 44 passed.
- `tsc --noEmit` (web-shell): clean.
- `eslint --max-warnings 0` on both changed files: clean.
- CI on `4d1a7ab`: 11 pass, 3 skipped. The earlier corepack failure cleared once the main merge brought in #12446.

### Not covered
- macOS and Windows (I ran on Linux only).
- The real DashScope provider. The provider here was scripted, and the open path under test makes no provider calls.
- The native macOS Live Host (`realtime_voice`, `/live/host`).

Evidence (harness, per-run JSON, `/capabilities` payloads, the session file the daemon wrote): this directory (`harness/`, `data/`).
