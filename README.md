# PR #9924 — local real-environment verification evidence

Verified tree: `origin/main 442951afee` + PR head `15a5fb53b5` (merge result `370a6a15af`).
Host: macOS 26.6.2 (arm64), Zulu JDK 26 / `maven.compiler.release=11`, Maven 3.9.16, Node 24.

## images/
| file | what it shows |
| --- | --- |
| `01-real-stack-ab.png` | Bundled qwen CLI 0.22.3 driven through the Java SDK `ProcessTransport`; the real `control_response` error on the wire; base silent vs head WARN |
| `02-test-discrimination.png` | `mvn clean test` on head (141 pass) and the revert-hunk run (PR tests + base `Session.java` → 3 failures) |
| `03-mutation-matrix.png` | 9 mutants against the changed hunk: 8 killed, M8 (precedence flip) survived |

## logs/
Raw captures — `wire-*.txt` are byte-level SEND/RECV transcripts through the real CLI process.

## rig/
The harness itself, so the run is reproducible:
- `RealCliControlResponseProbe.java` — drives the real CLI, tees the wire, injects
  `session.setModel("")` mid-turn via the SDK's public API, records the log outcome.
- `fake-openai.ts` — launcher for the repo-owned `integration-tests/fake-openai-server.ts`,
  holding each completion open so the control request lands mid-turn.
- `qwen-wrapper.sh` — `pathToQwenExecutable` shim onto `dist/cli.js`.
- `mutate.py` — the mutation matrix generator.
