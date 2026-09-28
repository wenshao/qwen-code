# Reproducing the PR #12894 real-stack rig

Pieces (all under `r4/harness/` plus the earlier `harness/`, `r2/harness/`, `r3/harness/`):

1. MySQL 8.4: `mysql.sh` (own datadir, port 13894; `--log-bin-trust-function-creators=1`), root password set once
   via `ALTER USER`; `sql.sh` wraps the client (`DB=<schema> sql.sh -e ...`).
2. Java: `build-java.sh` (qwencode + runtime-broker install into an isolated `-Dmaven.repo.local`, then the server jar;
   use `clean package` after migration renames). `adapter/build-adapter.sh <server.jar>` builds `adapter.jar`, which
   `spring.sh` puts on `-Dloader.path` so `X-Rig-Actor` becomes an authenticated tenant actor for the public API.
3. TLS/OSS: `tls/tls-gen.sh` creates the CA, leaf cert, `trust.jks` and `hosts`; `fake-oss.mjs` (in `harness/`) serves
   the bucket on 0.0.0.0:443 with an admin port on 127.0.0.1:18994 (faults, versioning, corruption, ledger).
4. `fault-proxy.mjs` (r3) sits on 18895 in front of Spring 18894 for both the worker publication ingress
   (`PUB_PORT=18895` -> `service-base-url`) and the Harness Session Store traffic.
5. `up.sh <jarArm> <workerWorktree>` starts Spring with storages `s01..s80`, JDWP on 15894, and the JDI tap
   (`harness/jdi/ExTap.java`) that prints exceptions hidden behind 400/500 envelopes.
6. Scenario drivers use the packaged Harness (`dist/cli.js serve --profile hosted-harness`) from the PR worktree and the
   repo's `integration-tests/fake-openai-server.ts`; `s2-real-model.ts` uses a real provider from `~/.qwen/settings.json`.

Paths inside the scripts are this machine's (macOS arm64, `~/Install/...`); adjust `R`, `WT`, the JDK and MySQL paths.
