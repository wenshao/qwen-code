# PR 12839 round 2 (head 727aafb482)

- `01..03-*.png`: evidence cards rendered from `harness/0N.txt` (see ../harness/render.py).
- `harness/W0eR2ProbeTest.java`: log-only fault-gate probes; drop into
  `packages/sdk-java/runtime-broker/src/test/java/com/alibaba/qwen/code/runtimebroker/` of either tree and run
  `mvn -o -Pfault-gates -Dqwen.cli.entry=<repo>/dist/cli.js -Dtest=W0eR2ProbeTest -Dsurefire.failIfNoSpecifiedTests=false test`
  with `W0E_OUT=<dir>`. `u1*` also needs `OLD_CP` (baseline runtime-broker classes + test-classes + deps),
  `OLD_SCHEMA` (baseline schema.sql) and `OLD_CLI` (baseline dist/cli.js).
- `results/head-run{1,2,3}`: head 727aafb482; `results/base-run1`: design-only head 353b6526 (same probe file);
  `results/a3-{head,base}`: slow-attestation variant; `results/suites-summary.txt`: suite totals and the test-merge run.
