### Maintainer verification, round 2: PR #12447 at `7980d55` (delta over [round 1](https://github.com/QwenLM/qwen-code/pull/12447#issuecomment-5772128515))

**Verdict: nothing I ran at this head blocks the merge.** `7980d55` applies the round-1 patch as posted. The fixtures, the schema and the test file are byte-identical to [`suggested-fix-b1ff554.patch`](https://github.com/wenshao/qwen-code/blob/b13440f08cee738da493998a7619a768abe01dc6/pr-12447/suggested-fix-b1ff554.patch). The production change is the same `inflate: false` line, with the comment reworded. I re-ran everything at this head, and both round-1 findings are closed:

- **Fixture coverage:** the fixtures now kill 39 of the 43 round-1 mutants (17 before).
- **Compressed bodies:** none of them reaches Express's HTML error page any more.

The `/review` round on `b1ff554` posted nine suggestions. I ran each one at this head. This commit closes the substance of R1-4 and part of R1-1 and R1-2. The rest are non-blocking, and the table below gives each one's measured status.

I also wrote an optional follow-up patch. It touches only the fixtures and the test, and it kills all 18 of the R1-1 and R1-2 mutations I could express, plus M37. I left M25 out. M31 (R1-1's route-level `no-store`) is equivalent, because the gate sets the same header. The direction question from triage is still the maintainers' call: should this land before #12380 is settled?

#### What I re-ran at `7980d55`

All runs used Linux x86_64 and Node v22.22.2, in the same worktree as round 1 (`pnpm install --frozen-lockfile`), with the harness from round 1 unchanged.

| Check | `b1ff554` (round 1) | `7980d55` |
| --- | --- | --- |
| Focused TS suite | 24/24 | **49/49** |
| `mvn clean checkstyle:check verify` in `runtime-broker`, `eclipse-temurin:21-jdk` 21.0.12 | 29/29, 0 violations | **29/29, 0 violations** |
| `npm run build` / `npm run typecheck` / `eslint --max-warnings 0` on the two TS files | exit 0 | **exit 0** (0 TS errors) |
| `prettier --check` on the 2 TS files, the 2 contract JSON files and the 2 design docs | not run | **exit 0** |
| `npm run bundle`, then grep `dist/` for the route, the gate and the error codes | no match | **no match**: the contract is still inert |
| Black-box raw-TCP probe, 44 requests | 41/44 | **44/44** (D5 valid gzip and D10 gzip bomb now expect 400) |
| Real JDK 21 `HttpClient` replaying the shared fixtures, with `HTTP_1_1` and with the default `HTTP_2` preference | 17/17 each | **37/37 each**. This is cleartext, so every exchange actually ran on HTTP/1.1. |
| Round-1 mutants M01–M43 against the PR's own suite | 17 killed | **39 killed** |
| M44, reverting `inflate: false` (negative control for the fix) | n/a | **killed**: `gzip-content-encoding` goes red |
| CI at `7980d55` | | all green: 23 pass, 21 skipped, none failing |

Round 1 predicted the 4 surviving mutants:

- **M25, M37:** 1-byte limit boundaries.
- **M27, `strict: false`:** equivalent, because the closed-shape check rejects non-objects anyway.
- **M31, route-level `no-store`:** equivalent, because the gate sets the same header.

The English and Chinese design docs changed in step, in the same 3 passages. I agree with deferring UTF-8-only JSON and the h2c question to the transport slice.

![PR's own gates at 7980d55](fig1-r2-gates.png)

#### The `/review` round-1 suggestions at `7980d55`

The author replied only on R1-4. I drove every live item through the same harness at both heads (figure 3). I also turned the mutations that R1-1 and R1-2 describe into X01–X18 and ran them against each arm's own suite (figure 2).

| | Status at `7980d55` | What I measured |
| --- | --- | --- |
| **R1-1** error body and headers not in the contract | **Partly closed** | Every 400, 401, 409 and 413 case now pins `expected.code` (a schema enum) and asserts a JSON content type. The six 404 `incompatible` cases carry no code, and the gate's 404 has no body. Renaming any of the three codes other than 401 now fails 1–16 tests (X01–X03); on `b1ff554` all 24 stayed green. **Still open:** the 200 response's media type isn't asserted. Dropping `.type('application/json')` serves the success body as `text/html`, and all 49 tests stay green (X04). The route-level `no-store` can't be observed behind the gate (M31), which is equivalent in this topology. |
| **R1-2** one case per dimension | **Partly closed** | **Now pinned:** credentials, all 7 identity comparisons, blank and mistyped body fields, the case-variant path, non-JSON `content-type`, `OPTIONS`, the whole registration throw (M38) plus 5 of its 13 conditions, and a `workspace` isolation class on the wire (X09 is killed). **Still unpinned** (each item is a surviving mutant): a present-but-wrong `Cache-Control` (X05); an uppercase-hex digest in the request (X06); a non-canonical epoch such as `"04"` (X07); an absent lease-id or lease-epoch header (X08, X10); the 8 per-field non-empty checks at registration (X11–X18); and the 1-byte limit boundaries (M25, M37). |
| **R1-3** harness ignores `request.headers` / `request.body` | **Open, test-only** | I appended a schema-valid case whose `request.headers` is a whole header set with a wrong token. The runner sends the canonical request instead, so it expects 401 and gets 200. A schema-valid `"method": "HEAD"` case makes the runner throw `TypeError: Request with GET/HEAD method cannot have body`. There is no production impact. Either honour the two keys in `materializeRequest`, or drop them from the schema and the type. |
| **R1-4** hand-listed parser-error mapping | **Closed for everything a peer can send** | With `inflate: false`, every compressed request now gets a JSON 400. On `b1ff554`, a valid gzip body got 200, the gzip bomb got 413, and corrupt gzip, deflate and br, as well as truncated gzip, got the HTML page. `identity, gzip` already got a JSON 400 on `b1ff554`; `identity` and `IDENTITY` still get 200. I read body-parser 2.3.0 and raw-body 3.0.2. The remaining error types (`request.aborted`, `request.size.invalid`, `stream.encoding.set`, `stream.not.readable`) need the client to vanish mid-body or another middleware to consume the stream first. A peer that half-closes mid-body gets Node's own bare 400, which I measured; it does not get the Express page. The data file has a `Content-Length: 999999999` row that shows "no response" on both heads. That is not an escape: raw-body raises the 413 at once, but body-parser's `dump()` drains the declared length before calling `next`, and the probe gave up after 3 s. Mapping by status, as R1-4 suggests, would still guard against future body-parser changes, but nothing needs it today. |
| **R1-5** an earlier JSON parser disables the cap and the auth-first order | **Open; belongs to the PR that mounts the route** | With `express.json({limit:'10mb'})` mounted first, a 17,289-byte body gets 200. With no credentials and a malformed body, the response is the host parser's 400 HTML page instead of 401. Nothing mounts this route yet. The mounting PR should keep app-wide body parsers off the owned listener, which fixes both halves; one sentence in Integration Order would record it. A `Content-Length` check in the raw gate would restore the cap only for bodies that declare a length (not chunked ones, probe F3). As R1-5 itself measured, it would not restore the auth-first order. |
| **R1-6** `Bearer ` matched case-sensitively | **Open; a design choice** | `bearer`, `BEARER`, a double space, and SP+HTAB all get 401, while `serve/auth.ts` accepts them. The only intended peer is the Java transport, so exact matching is defensible. No fixture pins either choice, though. One `bearer <token>` case would keep the Java side from choosing differently. |
| **R1-7** no 512-character / NUL bound | **Holds; low impact** | A 513-character `tenantId`, a 4 KiB `workspaceCwd` and a NUL-bearing `tenantId` all register and attest with 200. Java already rejects over-512 or NUL values for these fields: `RuntimeScope` for `tenantId`, `workspaceId` and `canonicalCwd`, and `RuntimeLease` for `runtimeInstanceId`, `token` and `leaseId` (both through `BrokerValues.requireId`). So a broker built on that model can't produce such values to provision. `provisionRequestId` and `runtimeIncarnation` have no counterpart in `runtime-broker` and are unbounded on both sides. In the other direction, `RuntimeLease` accepts epoch 0, which the TS registration and the schema reject. Pinning `maxLength: 512` would also force a rewrite of the two ~16 KiB response-cap tests. |
| **R1-8** Jackson 2.20.0 vs 2.22.0 | Unchanged | `jackson.version` is 2.20.0 and test-scoped. The sibling module's `jackson-core.version` is 2.22.0. |
| **R1-9** schema `$id` resolves to nothing | Unchanged | The URL still returns HTTP 404. The other two schemas in the repo use `https://qwen-code.invalid/…`. The fix is one line. |

![The /review round-1 findings, executed at b1ff554 and 7980d55](fig3-r2-review-status.png)

The triage bot's sandboxed verification was posted while round 1 was in flight. Its five findings, at this head:

- **F1, decode failures escape to HTML:** closed (see R1-4).
- **F2, error bodies absent from the shared files:** the code is now part of the contract. The `error` text and the closed `{code, error}` shape are not, because `toMatchObject({ code })` tolerates extra fields.
- **F3, six identity comparisons unpinned:** closed (M07–M13 are killed).
- **F4, encodings accepted beyond the schema:** closed for `Content-Encoding`. Every encoding other than `identity` is now rejected. The other half of F4 is unchanged: `application/json; charset=utf-8` gets 200 while `$defs/headers` pins `content-type` to exactly `application/json`. That belongs to the deferred UTF-8 question.
- **F5, the `incompatible` 404 carries no body:** unchanged. That is a design choice.

#### Optional follow-up: fixtures and test only, +77/−2

[`followup-7980d55.patch`](./followup-7980d55.patch) applies cleanly to `7980d55` and changes no production code. It adds:

- **5 fixture cases:** `wrong-cache-control` → 400, `uppercase-capability-digest` → 400, `non-canonical-epoch` → 409, `missing-lease-id` → 409 and `missing-lease-epoch` → 409.
- **8 registration rows:** one for each per-field non-empty check the registration `it.each` does not cover yet.
- **A media-type assertion:** a JSON media type whenever `expected.body` is set.
- **An exact-limit response:** the exact-bytes test now builds a response of exactly 16 384 bytes instead of `limit - 32`, which kills M37.

Results:

- **Suite:** 62/62, with eslint and prettier clean.
- **Mutants:** the `/review` set goes from 4/18 to 18/18 killed. The round-1 set goes to 40/43. The only survivors are M25 and the equivalent M27/M31.
- **Java:** `ManagedRuntimeAttestationConformanceTest` passes 3/3, and the module passes 29/29 with 0 Checkstyle violations. The log records the sha256 of the 42-case fixtures file it ran against.
- **JDK replay:** 42/42 with both HTTP settings.

Two choices are left to the author:

- **Missing lease headers:** the two cases pin today's classification (409 identity). If a missing lease header should be a 400 protocol error, change the fixtures and the code together.
- **M25:** a `replaceBody` case with a ~16 KiB `workspaceCwd` that expects 409 would kill it. I left that out to keep a 16 KiB literal out of the shared file.

![Mutation matrix across b1ff554, 7980d55 and the follow-up](fig2-r2-mutants.png)

**Evidence:** [`wenshao/qwen-code@asserts` → `pr-12447-round2/`](.) contains:

- the three figures;
- `REPORT.md` and `REPORT.zh-CN.md`;
- `harness/`: the live `/review` probe, the round-2 mutant generator (M01–M44 plus X01–X18), the R1-3 case writer and the figure scripts;
- `data/`: the raw logs, including eslint and prettier, and the per-arm mutant summaries;
- the follow-up patch.
