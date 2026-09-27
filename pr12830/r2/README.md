# PR #12830 round 2 (head 6a587ad1, base 57bede94)

- `r2-0*.png`: figures in the round-2 comment.
- `candidate/candidate-r2-all.patch` applies cleanly on 6a587ad1 and combines:
  `candidate-r2-units.patch` (F1: 8 timestamp descriptions + design note EN/zh-CN),
  `candidate-r2-route-guard.patch` (method-less mappings recorded as `ANY`, +6/-2),
  `candidate-r2-test.patch` (PlannedTaskContractTest, +50).
- `harness/spec-mutants.mjs` + `run-spec-mutants.sh`: 22 spec mutants run against PlannedTaskContractTest
  by swapping `target/classes/openapi/...json` and calling `surefire:test`.
- `output/`: raw outputs quoted in the comment. Paths are placeholders.
