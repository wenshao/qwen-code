# PR #12870 real-environment verification evidence

- Arms: base `233d49b5cc` (merge-base; runtime-broker module unchanged on main since), PR `f2efb16ff7`, candidate = PR + `candidate-digit-budget.patch`.
- JDK 21.0.12 (Zulu), Maven 3.9.16 offline, fastjson2 2.0.65, MySQL 8.4.11 and MariaDB 10.11.18 in Docker, Connector/J 8.4.0, macOS 26.6 arm64.
- `harness/RealStackProbe.java`: production RuntimeBrokerHttpServer + RuntimeBrokerService + JDBC repositories on a fresh database; Runtime side is an embedder RuntimeTransport or the production HttpRuntimeTransport (v2) against a fake worker answering crafted literals. Compile against a build's `target/classes:target/test-classes` + fastjson2; run `RealStackProbe <arm> jdbc:mysql://127.0.0.1:<port>/ <db> <label>`.
- `harness/CodecProbe.java`: shared boundary + JDBC writer/reader round trip, wire readers, RuntimeResourceHandle.
- `harness/run-mutants.mjs`: javac one mutated class into target/classes, surefire BrokerValuesTest, restore.
- `results/rs-<arm>-<db>.txt`: one JSON row per case (Broker HTTP answer, SQL row, GET, fresh-repository read, reconcile, release).
