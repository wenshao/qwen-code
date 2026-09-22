# Exact invocations at 15d395bc

JDK 21. Probe classpath = the module's `target/classes` + fastjson2 2.0.60 + h2 2.3.232 + mysql-connector-j 8.4.0 (see `env.sh`);
the probes live in package `com.alibaba.qwen.code.runtimebroker` so they can reach package-private API.
Servers: `docker run -d -e MYSQL_ALLOW_EMPTY_PASSWORD=yes -p 127.0.0.1:34584:3306 mysql:8.4` (8.4.11, UTC) and the same with
`-e TZ=Asia/Shanghai -p 127.0.0.1:34585:3306` (CST, time_zone=SYSTEM). `Q='?allowPublicKeyRetrieval=true&useSSL=false'`.

- Gate: `mvn -o -B clean checkstyle:check verify` in `packages/sdk-java/runtime-broker` (head; head + fence-tests-15d395bc.patch;
  head + service-owner-check-15d395bc.patch). Logs: `logs/gate-*.log`.
- fig A: `java … TzProbe "jdbc:mysql://127.0.0.1:34584/tz_e$Q" "jdbc:mysql://127.0.0.1:34584/tz_e$Q&connectionTimeZone=Asia/Shanghai&forceConnectionTimeZoneToSession=true" delta`
- fig C part 2: `java … ConsistentZoneProbe <url>` with, in turn,
  `jdbc:mysql://127.0.0.1:34584/czp_e$Q` (UTC server), `jdbc:mysql://127.0.0.1:34585/czp_e$Q` (CST server),
  `jdbc:mysql://127.0.0.1:34584/czp_f$Q&connectionTimeZone=America/New_York&forceConnectionTimeZoneToSession=true`.
- fig C part 1: `java … TakeoverRaceProbe {jdbc|memory} {claim-only|executing}`; the fixed arm puts the classes compiled from
  RuntimeBrokerService with `service-owner-check-15d395bc.patch` applied first on the classpath.
- H2 check: `java -cp .:h2-2.3.232.jar H2Utc` (jdbc:h2:mem:t;MODE=MySQL). Log: `logs/h2-utc-timestamp-2.3.232.log`. With the module's `DATABASE_TO_LOWER=TRUE` the same error prints the name in lower case.
- `logs/c18-under-load.log`: at `f724def` (mutant id C18 there = M50's transform), the same 6x32 race block, six copies of the C18 tree run concurrently, three rounds.
- fig B: `GEN=<pr-12445-round2/harness/mutants66.py from https://github.com/wenshao/qwen-code/tree/36ccb678aaecc07dc0b718776dbb5a7e636ce452/pr-12445-round2> run_round2_mutants.sh <tree> <out>` for 15d395bc and for
  15d395bc + fence-tests-15d395bc.patch (mutants66.py imports its sibling mutants.py). Figures: `LOGS=logs python3 figs/make_delta_figs.py`
  then `NM=<node_modules with playwright-core and @xterm/xterm> node figs/render.cjs delta1 delta2 delta3`.
