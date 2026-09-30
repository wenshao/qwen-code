# Verification rig for PR #13037 (O3: durable tool results → public API → WebShell)

Everything here is a test rig. Nothing in this directory is product code, and none of it is meant to be merged.

## What runs

| Piece | How it is started | Notes |
| --- | --- | --- |
| MySQL 8.4.7 | `mysql.sh` | dedicated instance, port 23037, UTC |
| Spring server (public API, Session Store, embedded Runtime Broker, O2 publication, O3 projection) | `spring.sh <arm> <schema>` | the jar built from the PR head, unmodified; `adapter-src/` is a 40-line servlet filter that turns `X-Rig-Actor` into the trusted principal |
| Hosted Harness | `harness.sh` | `dist/cli.js serve --profile hosted-harness` from the same worktree |
| Runtime workers | spawned by the Broker | real `run_shell_command` in the Workspace directory |
| Object storage | `fake-oss.mjs` | a TLS OSS double for the real `aliyun-sdk-oss` client (hosts file + private CA, port 443); `s12-realoss.mjs` uses a real private bucket instead |
| Model | `model.mjs` | deterministic OpenAI-compatible server; a marker in the prompt selects the tool calls |
| WebShell | `vite` dev server of `packages/web-shell` with `QWEN_MANAGED_AGENT_JAVA_URL` | `o3-rig.tsx` / `o3-rig.html` mount `ManagedAgentWebShell` |
| Browser | Playwright Chromium 149 / WebKit 26.5 | `b*.mjs` |

`start.sh`, `stop.sh` and `restart.sh` manage the processes by recorded PID.

## The one intervention

The Java connector always asks the Harness for the file tool profile (`hosted-workspace-files/1`); public Shell admission is a later slice. `tap.mjs` sits between Spring and the Harness, records every request, and on session create/load swaps that profile for `hosted-workspace-shell/1` plus an O2 capture budget. Without the swap no public Session can run a Hosted Shell. The server jar, the CLI bundle and the WebShell are otherwise exactly what the PR head builds.

Two smaller substitutions, both named in the report:

- `o3-rig.tsx?save=opfs` replaces the native save-file dialog with an Origin Private File System handle, because headless automation cannot click the dialog. `fetch`, the stream, `pipeTo` and the writable are the browser's own.
- Session statuses `CLOSED` / `ARCHIVED` / `DELETING` / `DELETED` are set in SQL, because lifecycle operations on Workspace Sessions answer 409 on main.

## Scenarios

| Script | What it does |
| --- | --- |
| `s1-states.mjs` | 11 real Shell commands → result states; every artifact read back and compared with a local run |
| `s2-reads.mjs` | 37 HTTP cases: ranges, validators, empty streams, authorization precedence |
| `s3-lifecycle.mjs` | grant revocation, quarantine, Session status, mid-stream revocation, reader limit, corrupted segment |
| `s4-make.mjs`, `s5-make-gib.mjs` | 12 MiB, 99 MiB and 1 GiB outputs |
| `s5-perf.sh`, `s5-slow.sh` | 1 GiB downloads with a 256 MiB heap; a 2 MiB/s client against the 2-minute budget |
| `s6-gone.mjs` | reads after the Harness and all workers are killed |
| `s7-policy.mjs` | five deployment configurations (restart between them) |
| `s8-upgrade.mjs` | main jar → PR jar in place → enable O3 → historical back-fill |
| `s9-faults.mjs` | object-store 500s, a 25 s stall and a server SIGKILL during projection |
| `s10-dblatency.sh`, `s10b.sh`, `s10c.sh`, `db-delay.mjs` | full downloads with a database that answers ~1.75 ms later per statement; paired PR/candidate timings |
| `s11-candidate.sh` | the same measurements on `candidate-80a860ae.patch` |
| `s12-realoss.mjs`, `s12b.sh`, `RealOss.java`, `cleanup.sh` | real private OSS bucket, created for the run and deleted afterwards |
| `t-cost.mjs` | SELECT and object-store request counts per read (MySQL `Com_select`) |
| `t-abort-timing.mjs`, `t-revoke.mjs`, `t-tz.mjs` | how long a client waits after a server-side abort; bytes after revocation; JVM/DB time zones |
| `b1-live.mjs` … `b7-showcase.mjs` | browser scenarios; `figs.mjs` builds the figures |

`candidate-80a860ae.patch` is a suggestion with measurements attached, not a request to take it as is.

## Not included

The private CA and keys for the OSS double (generate your own: a CA, a leaf for `oss-cn-hangzhou.aliyuncs.com` and `*.oss-cn-hangzhou.aliyuncs.com`, a trust store), and any cloud credential. `spring.sh` reads the real-OSS credentials from a local file at start and never prints them.
