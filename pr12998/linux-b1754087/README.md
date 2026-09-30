# PR #12998 real verification evidence (Linux, head b1754087cd)

Independent re-verification of [QwenLM/qwen-code#12998](https://github.com/QwenLM/qwen-code/pull/12998)
`fix(managed-agent): Settle task event and cancel semantics` at head `b1754087cd`
(main at `e8fc540be7`), on Linux x86_64, 2026-09-30. Complements the earlier
round in `..` (head `05047ae6`).

Environment: Node v24.14.0, pnpm 11.24.0 (corepack), Temurin JDK 21.0.12.1, Maven, Ajv 8.20.0 (draft 2020-12).

## Files

- `01-gates.png` / `gates.log` — frozen-lockfile install, Java contract suites
  (`mvn test -Dtest='*Contract*'`: 29 tests, 0 failures across 5 suites incl.
  `PlannedTaskContractTest` 7/7), Checkstyle 0 errors, WebShell vitest 2/2,
  contract regeneration drift-free, typecheck / ESLint / Prettier clean.
- `02-before-after.png` / `before-after.log` — key `task_cancel` instances
  validated with Ajv against main's contract (v1.22.0) and the PR contract
  (v1.23.0): the four outcome tightenings flip ACCEPT → REJECT on both
  operation unions; valid outcomes stay accepted.
- `03-validation.png` / `validate.log` — independent schema validation:
  90 behavioral checks pass against the baseline contract and 90 against the
  updated contract (each check has per-version expectations), covering both
  public surfaces and the camelCase WebShell mirrors, task invariants,
  `artifact_refs` bounds, event field totality probes and event-page cursor
  rules. 10/10 hand-written schema mutations are caught by a behavioral
  assertion.
- `04-parity.png` / `parity.log` — the published WebShell client regenerated
  from main's spec and from the PR spec differs only inside two shared
  `@description` strings (zero structural change); planned routes/schemas and
  the new planned conditional do not reach the generated client.

## Harness

`harness/` holds the drivers: `validate.mjs` (behavioral checks + mutation
suite), `before-after.mjs` (before/after table), `shots.mjs` (screenshot
renderer). The baseline spec is `git show origin/main:packages/sdk-java/
managed-agent-server/src/main/resources/openapi/managed-agent-public-api.openapi.json`.
