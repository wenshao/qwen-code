# PR 12839 verification assets

- `01..04-*.png`: evidence cards (rendered from `harness/0N.txt` by `harness/render.py`).
- `harness/W0eProbeTest.java`: drop into `packages/sdk-java/runtime-broker/src/test/java/com/alibaba/qwen/code/runtimebroker/`,
  build the repo bundle, then
  `mvn -o -Pfault-gates -Dqwen.cli.entry=<repo>/dist/cli.js -Dtest=W0eProbeTest -Dsurefire.failIfNoSpecifiedTests=false test`
  with `W0E_OUT=<dir>` set; each probe appends `<epoch-ms> <line>` to `<dir>/<probe>.log`.
  The probes pin today's behaviour (they pass while the gaps exist).
- `harness/boot-launcher.pl`: launcher that writes half a boot document and SIGKILLs itself (P5).
- `results/`: raw probe logs from three full runs (run1 P1 re-run once after a harness wait fix) plus three P2b runs; local paths replaced by `<scratch>`.
