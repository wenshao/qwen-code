# PR #12881 verification evidence (head a32bd7976b)

Real stack: `qwen-managed-agent-server` jar (PR and main 3f5ae3ffeb) with its Hosted Harness
connector on, the packaged Hosted Harness (`dist/cli.js`, `serve --profile hosted-harness`),
MySQL 8.4.11 and MariaDB 10.11.18 in Docker, a fake OpenAI-compatible model, and
`harness/proxy.mjs` on the Java -> Harness and Harness -> Store links (request ledger +
fault injection). JVM on UTC (`-Duser.timezone=UTC`) as in CI.

| Scenario | Script | Result |
| --- | --- | --- |
| main under a Harness close outage | `s0-base.mjs` | `results/s0-base-mysql.txt` |
| PR reviewer test plan, both surfaces | `s1-plan.mjs` | `results/s1-pr-{mysql,mariadb}.txt` |
| Upgrade main -> PR with waiting commands | `s5-upgrade.mjs` | `results/s5-upgrade-{mysql,mariadb}.txt` |
| Races on one Session | `s2-race.mjs` | `results/s2-race-mysql.txt` |
| kill -9 / SIGSTOP of the worker | `s3-takeover.mjs` | `results/s3-takeover-mysql.txt` |
| Two servers, two Harnesses | `s4-multiserver.mjs`, `s4d-phase.mjs`, `s4e-backoff.mjs` | `results/s4*.txt` |
| Store outage overlapping a close | `s6-latch.mjs` | `results/s6-latch-{mysql,mariadb}.txt` |
| Bound Sessions, SSE, contract capture | `s7-extra.mjs`, `s7b-sse.mjs`, `validate.cjs` | `results/s7*`, `results/s7-responses-*.json` |
| Mutants on the real stack / PR suites | `s4-mut.mjs`, `mutate-ab.sh` | `results/s4-mut-*.txt`, `results/mutant-ab-*.txt` |
| Trial merge with #12839 | `trial.sh` | `results/trial-merge-12839.txt` |
| Concurrent first Turns (pre-existing, main too) | `s2b-*.mjs` | `results/s2b-*.log` |
