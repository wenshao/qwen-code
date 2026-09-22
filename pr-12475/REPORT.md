## Maintainer verification: real DingTalk, GitHub and Web Shell runs at `1713e95`

**Verdict: don't merge as pushed. It's mergeable after two mechanical fixes.** On a real daemon the design holds up. The new axis decouples in both directions, the default is unchanged, invalid values fail closed, and a group message can no longer create or satisfy a DM pairing. Both blockers are ones Stage 2 already raised. I reproduced each by execution and attach a verified patch for the second. Separately, the PR's docs note about the Web Shell editor is wrong: the editor keeps both keys. There are also three non-blocking items.

| | At `1713e95` | Evidence |
| --- | --- | --- |
| **B1** `Lint & Static` is red | Prettier fails on 6 files. `prettier --write` on those 6 files puts every churn hunk back to base byte for byte, taking the diff from +289/−64 to +268/−13 | Fig 5 |
| **B2** mixed-case `allowedGroupUsers` on GitHub/GitLab | Reproduced end to end on the real adapter. A 15-line patch goes RED→GREEN | Fig 2 |
| **N1** docs: "the Web Shell editor rewrites the config" | Not true. The browser's PUT echoes both keys, `settings.json` keeps them, and the running channel still enforces them | Fig 3 |
| **N2** shared group sessions | Admitted members can trigger a tool call but can't `/approve` it. The same check blocks `/cancel`, `/clear` and loops | Fig 1, S7 |
| **N3** GitHub/GitLab | Every thread counts as a group, so `open` admits any commenter. That includes an unmentioned comment on the aggregate lane | Fig 2, G3/G4 |
| **N4** test coverage | 9 of 19 mutants survive. An optional test patch brings that down to 1 of 19 | Fig 4 |

### How it was run

- **Two arms, real install, full build.** Base is `f5beafb` (the merge base) and head is `1713e95`. Each ran a full `npm run build`, which runs `tsc --build` for every package including `packages/cli`, then `npm run bundle`. Both exited 0. The head bundle contains `groupSenderGate` and the base bundle doesn't. A third arm, **fix**, is head plus the patch in B2.
- **DingTalk.** I ran a real `qwen serve --channel dingtalk`: channel worker, DingTalk adapter, vendor stream SDK and ACP sessions. It talked to a TLS-spoofed DingTalk OpenAPI and stream gateway (loopback only, through temporary `/etc/hosts` entries and a private CA, both removed afterwards). The model was a scripted OpenAI-compatible server that replies `ANSWER <token>`. That's 10 scenarios on each of 2 arms, with a fresh daemon for every row. A probe counts as "answered" only if the reply carrying its token reached the DingTalk webhook.
- **GitHub.** Real `qwen serve --channel github` with real Octokit, pointed at a fake GitHub REST API through `baseUrl`.
- **Web Shell.** A real daemon and the Web Shell it bundles, driven in headless Chromium through Playwright, with no mocks.
- **Unit suites at head.** `ChannelBase.test.ts` 712 passed, `channels/dws` 392, `channels/github` 209, and `config-utils` + `channel-settings-store` 193. These match the PR body. The full `channels/base` package is 1403/1403. `eslint --max-warnings 0` on the 13 changed files is clean.

### Fig 1: DingTalk, base vs head

![DingTalk A/B matrix](fig1-dingtalk-ab-matrix.png)

- **S0/S3** (keys absent, or an explicit `inherit`): identical on both arms.
- **S1/S2**: the two axes separate in both directions. Bob and carol are answered in the group and still denied in DM. Under the group allowlist, alice (DM-only) is denied in the group.
- **S4**: with `groupSenderPolicy: "pairing"`, head refuses to start: `Channel "dingtalk" field "groupSenderPolicy" must be one of: inherit, open, allowlist.` Because I passed `--channel dingtalk`, the whole `qwen serve` startup fails. The daemon API also rejects the value, with `400 channel_settings_invalid_config` for `pairing` and `200` for `open`.
- **S5** (`senderPolicy: "pairing"` + `open`): on head, dave is answered in the group. The DM still gets a pairing code, and the pairing store holds one request, created by the DM, so group admission doesn't unlock DMs. On base, the pairing code is posted into the group chat.
- **S6**: group history is recorded and replayed on the new axis. Bob's unmentioned line reaches the next prompt only on head with `open`.

### B1: formatting churn (Stage 2 #1, confirmed)

The CI `Lint & Static` job fails at `node scripts/lint.js --prettier` on exactly the 6 files Stage 2 listed. Locally, the same 13 files pass on base and the same 6 fail on head. Running `npx prettier --write` on those 6 files is enough. I checked that the result is byte-identical to base in every churn hunk and changes no semantic line, which takes the PR from **+289/−64** to **+268/−13**.

![Prettier gate](fig5-prettier-gate.png)

### B2: mixed-case `allowedGroupUsers` (Stage 2 #2, reproduced by execution)

![GitHub case normalization](fig2-github-case-normalization.png)

In G1, `allowedGroupUsers: ["Alice"]` never matches the lowercased login, so Alice's `@qwen-bot` comment goes unanswered. The only trace is a generic `preflight rejected reason=sender_denied`, the same line a real stranger produces. With `["alice"]` (G2) it works. `allowedUsers: ["Alice"]` (G0) works too, because the adapter already normalizes that list. The patch below mirrors the existing `allowedUsers` normalization in both adapters.

<details>
<summary>Patch: normalize <code>allowedGroupUsers</code> in GitHub/GitLab <code>connect()</code> (+15 lines, verified)</summary>

```diff
--- a/packages/channels/github/src/GithubAdapter.ts
+++ b/packages/channels/github/src/GithubAdapter.ts
@@ -618,6 +618,14 @@
       );
     }
     this.gate.replaceAllowedUsers(allowed);
+    // The decoupled group axis is matched against the same lowercased login.
+    if (this.config.allowedGroupUsers) {
+      const allowedGroup = this.config.allowedGroupUsers.map((u) =>
+        u.toLowerCase(),
+      );
+      this.config.allowedGroupUsers = allowedGroup;
+      this.groupSenderGate?.replaceAllowedUsers(allowedGroup);
+    }
     this.migrateLegacyPublicationState();
--- a/packages/channels/gitlab/src/GitlabAdapter.ts
+++ b/packages/channels/gitlab/src/GitlabAdapter.ts
@@ -99,6 +99,13 @@
     );
     this.config.allowedUsers = allowed;
     this.gate.replaceAllowedUsers(allowed);
+    if (this.config.allowedGroupUsers) {
+      const allowedGroup = this.config.allowedGroupUsers.map((u) =>
+        u.toLowerCase(),
+      );
+      this.config.allowedGroupUsers = allowedGroup;
+      this.groupSenderGate?.replaceAllowedUsers(allowedGroup);
+    }
 
     this.startPollLoop();
```

Here is how I verified it. I added two tests, `normalizes allowedGroupUsers to lowercase for the group sender gate` in GitHub and `normalizes allowedGroupUsers to lowercase` in GitLab. On head's adapters they fail (`expected false to be true` and `expected [ 'Alice' ] to deeply equal [ 'alice' ]`). With the patch they pass. The full suites pass too: github 212/212 and gitlab 62/62. End to end, G1 goes from no reply to answered (Fig 2, **fix** column). The patch is Prettier- and ESLint-clean. The tests are in `patches/tests-group-axis.patch` in the artifacts.

</details>

### N1: the Web Shell editor keeps both keys, so the docs note should change

The paragraph added to `overview.md` doesn't match what happens, and neither does the Risk & Scope bullet. The paragraph says "saving a channel there rewrites its config from the rendered fields — set both keys in `settings.json` until the editor learns them". But `buildChannelUpsertRequest` (`packages/web-shell/client/components/channels/channel-editor-state.ts`) starts from `...(instance?.config ?? {})`, and the daemon's instance snapshot passes every non-secret key through. So the PUT the browser sends already contains `groupSenderPolicy` and `allowedGroupUsers`. The store does replace the entry, as Stage 2 said, but it replaces it with a body that already contains both keys.

![Web Shell editor keeps keys](fig3-webshell-editor-keeps-keys.png)

I edited only Instructions, then pressed Save and then Start. The PUT body carries both keys, `settings.json` keeps them, and the running channel still answers carol in the group and denies alice there. I only tested an edit to an unrelated field, not a rename. Suggested wording: *"The Web Shell channel editor does not show `groupSenderPolicy` or `allowedGroupUsers` yet. Set them in `settings.json`; saving the channel from the editor keeps them."*

### N2: shared group sessions (extends Stage 2's shared-session note)

This is Fig 1, S7 vs S7u. With `sessionScope: "thread"` (a shared group session), bob gets in through `open` and triggers a tool call. When bob sends `/approve`, the reply is *"Only authorized members can answer permission requests in this shared session."* Only alice, who is in `allowedUsers`, can approve it. With a per-user scope (S7u), bob can approve. The same `allowedUsers` check covers `/cancel`, `/clear`, `/who`, loops and `/btw`, and it turns a steer into a queued message. That's the safe direction and I'd keep it. Still, a group member whose own turn stalls on an approval they can't give will be surprised, and GitHub defaults to `chat_thread`, which is shared. One sentence under "Group Sender Policy" would cover it.

### N3: on GitHub/GitLab the group axis is the only axis

Every GitHub envelope has `isGroup: true`, so on GitHub/GitLab `groupSenderPolicy` replaces `senderPolicy` for all traffic. In G3 and G4, `open` admits any commenter on a watched thread. G4 is an **unmentioned** drive-by comment on a `reason: "comment"` notification, and it triggered a model turn and a public reply. On a public repo that means anyone on GitHub, while the GitHub descriptor tells operators to use Allowlist on public repos. I'd add a line to the GitHub and GitLab docs, or a connect-time warning like the existing one for a bot-only allowlist. This isn't blocking, because `open` is an explicit opt-in.

### N4: test coverage

![Mutation matrix](fig4-mutation-matrix.png)

The three new ChannelBase tests pin the resolver itself, and they catch both mutants the PR body lists. 9 of 19 mutants still survive:

- the deferred-pairing guard in preflight (M03, near-equivalent, see below)
- the group-history record and replay filters
- stored loop-target authorization
- both GitHub lanes
- both DWS redelivery branches
- an explicit `inherit` value

The E2E runs above cover history, the GitHub lanes and `inherit`. Nothing covers loops or DWS. The optional `tests-group-axis.patch` adds 8 tests: 2 for B2 and 6 for these sites. It brings the surviving mutants down to 1 of 19. The one left, M03, is near-equivalent: Feishu replies, the only caller that sets `deferPairingRequests`, run the full preflight again anyway. The patch is Prettier- and ESLint-clean, and the full suites stay green (base 1406, github 212, gitlab 62, dws 393).

### Artifacts

The figures, harness (fake DingTalk gateway, fake GitHub API, scripted model, scenario drivers, mutation runner, Playwright editor script), raw result JSON and both patches are in this directory (`harness/`, `data/`, `patches/`).
