# PR #12894 real-stack rig (verification only)

- MySQL 8.4.7 (own instance, port 13894), fresh schema per head (o2a = 5a45f62d, o2b = cdf056fe, o2c = 6b2bc23c).
- `spring.sh` / `up.sh`: the PR's Spring jar with session store + embedded Runtime Broker + `qwen.managed-agent.tool-publication.*`
  (endpoint `https://oss-cn-hangzhou.aliyuncs.com`, bucket `rig-bucket`); `-Djdk.net.hosts.file` + a private CA trust store point the
  real aliyun-sdk-oss 3.18.4 at `fake-oss.mjs` (0.0.0.0:443). JVM proxy properties are cleared because macOS JDKs inherit the system proxy.
- `fault-proxy.mjs` (18895 -> 18894) carries both the worker publication ingress (`service-base-url`) and the Harness Session-Store/owner
  traffic; rules: drop-reply, drop-request, 503, delay, forward-then-hold.
- Workers are real `dist/cli.js managed-runtime-worker` processes spawned by the Broker; the Harness is `dist/cli.js serve --profile hosted-harness`.
- `gen.mjs` writes deterministic bytes; `lib.mjs#rebuildStream` rebuilds each stream from the SQL catalog + stored objects and compares
  SHA-256 with an independent oracle; `readRange` uses a second writer acquired after the Harness detached.
- `jdi/ExTap.java`: attaches to the JVM (JDWP) and prints exceptions thrown in `com.alibaba.qwen.*` (publication refusals are all 400 `invalid_request`).
- `candidate-6b2bc23c.patch`: B1 (turn relabel, ported from #12848) + B2 (LocalDateTime) + B4 (FOR SHARE), 3 files +33/-4, relative to 6b2bc23c.
