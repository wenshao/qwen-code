# Evidence for the local verification of QwenLM/qwen-code#10465

Screenshots and reproduction artifacts referenced from the verification report
comment on PR #10465. Captured on macOS 15 (Darwin 25.6.0), Node 24.18.1,
against PR head `a6cab44148` merged onto `origin/main` `1db18fefdb`.

| file | what it shows |
| --- | --- |
| `01-mutation-matrix.png` | 11-mutant matrix: PR head (640 tests) vs pre-PR suites (638 tests) |
| `02-live-mutation-D-M1.png` | live vitest run: the circuit-breaker latch mutant green at pre-PR, red at PR head |
| `03-ab-ledger-drain-exit.png` | A/B of the removed drain-side `sessionIdContext.exit` across 6 entrances |
| `04-readlink-leak-arm-ab.png` | whether the round-1 helper's `readlink` spy is load-bearing |

`repro/` holds the artifacts needed to re-run the checks:

- `zz-als-probe.test.ts` — the AsyncLocalStorage ledger probe (drop into
  `packages/cli/src/services/housekeeping/`, run with `ALS_PROBE_OUT=<file>`)
- `mutate.py` — applies mutants `C-M1..C-M4`, `D-M1..D-M7` by exact-string edit
- `shot1-mutation.sh` — the live mutation script behind screenshot 02
- `ledger.BASE.txt` / `ledger.HEAD.txt` — the two raw probe ledgers
- `mutants-at-PR-head.txt` / `mutants-vs-pre-PR-suites.txt` — raw matrix output
