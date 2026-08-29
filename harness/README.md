# Heredoc permission-projection differential

A verification harness for the heredoc handling in
`packages/core/src/permissions/rule-parser.ts` (#9381 / PR #9417).

It exists to replace *"here is one more shape the parser gets wrong"* with a
**measurable, falsifiable acceptance bar**, so a change in this area can be
argued about with numbers instead of witnesses.

## What it measures

Ground truth is the same shell qwen-code actually runs on Linux —
`bash -c <command>`, see `getShellConfiguration()` in
`packages/core/src/utils/shell-utils.ts`.

Every command is executed for real inside a sandbox whose `PATH` front holds
shims: a harmless marker binary `pwned` that records its own invocation, and a
`git` shim that records the cwd it was invoked from. The permission layer is
then asked for a verdict on the **identical string**. That gives an oracle no
unit test can fake:

> bash really executed this, therefore the rule engine must have seen it.

Verdicts are taken under a permissive-but-guarded config — every ordinary
command in the corpus is allowed, `pwned` is explicitly denied — so a verdict
of `allow` on a command that really executes the marker means **the deny rule
was bypassed and no prompt was shown at all**.

## The bar

1. **Security.** No arm may silently auto-approve a command that the baseline
   arm did not (`new vs main` must be 0). This is a *relative* bar on purpose:
   it does not require the parser to be complete, only to never lose ground.
2. **The fix.** Inert heredocs fed to a known interpreter must auto-allow under
   a matching `Bash(<receiver> *)` rule, including #9381's literal repro
   `python - <<'PY' … PY`.

`run.mjs` exits non-zero when bar 1 is violated, so it can be wired into CI.

## Usage

```sh
# each arm is a qwen-code checkout with packages/core built:
#   npm run build --workspace @qwen-code/qwen-code-core
node harness/run.mjs \
  --arm main=/path/to/main-worktree \
  --arm pr=/path/to/pr-worktree \
  --fuzz 1500 --out ./out
```

Two extra differentials run under vitest, because they need the workspace
module graph. Copy them in and run them from their package:

```sh
cp harness/guard-differential.test.ts  packages/cli/src/serve/
cp harness/fileop-differential.test.ts packages/core/src/permissions/

( cd packages/cli  && npx vitest run src/serve/guard-differential.test.ts --coverage.enabled=false )
( cd packages/core && npx vitest run src/permissions/fileop-differential.test.ts --coverage.enabled=false )
```

* `guard-differential` — 20 cwd-laundering shapes against
  `createDaemonToolGuard()`; ground truth is the `git` shim's recorded `$PWD`.
  Whenever bash really runs `git` outside the workspace, the guard must deny.
* `fileop-differential` — 7 shapes against `extractShellOperationsAcrossCommand`;
  ground truth is which files bash really wrote. **One case,
  `shell-fed-body-writes`, fails identically on main and on PR #9417** — a write
  inside `bash <<EOF … EOF` is invisible to file-operation rules because the
  state-tracking projection strips every simple-command body by design. It is a
  standing gap, not a regression; it is left failing so it stays visible.

## Files

| File | Purpose |
|---|---|
| `run.mjs` | orchestrator; prints the tables and enforces the bar |
| `corpus.mjs` | 283 hand-built heredoc shapes (data consumers, shell-fed bodies, phantom `<<` from arithmetic, mid-word `#`, CRLF, tab-stripping, multi-line quotes, receiver redirection via `PATH=`/`hash`/`eval`/`alias`, path-qualified receivers, concurrent heredocs, backslash continuations) |
| `fuzz.mjs` | seeded generator; same seed ⇒ same corpus |
| `ground-truth.mjs` | the sandbox and the `bash -c` oracle |
| `guard-differential.test.ts` | daemon git-worktree guard, cwd-laundering |
| `fileop-differential.test.ts` | shell file-operation extraction |

## Notes for anyone extending it

* Drive rule A/Bs with `getApprovalMode: () => 'default'`. Under `auto`, an
  explicit `Bash(python *)` allow rule still yields `ask` because `python`
  routes through the classifier — you would be measuring auto mode, not rules.
* Keep corpus ids unique. Several delimiter spellings sanitise to the same
  slug, and a colliding id silently joins ground truth to the wrong command.
* Use a neutral marker name, never a real `rm`. It keeps the run safe and keeps
  `dangerousRules.ts` from interfering with what is being measured.
* Report hole **set differences**, not counts. Two arms can have near-identical
  totals while the sets differ; `new vs baseline` is the number that matters.
