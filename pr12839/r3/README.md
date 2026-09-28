# PR 12839 round 3 (head 9e42875b12)

- `01..02-*.png`: evidence cards rendered from `harness/0N.txt` (../harness/render.py).
- `harness/W0eR2ProbeTest.java` (round-2 probes, U1 now also runs the README inventory query),
  `harness/W0eR3ProbeTest.java` (A4 managed-context startup fault, A5 SIGSTOPped worker; compiles on both heads),
  `harness/W0eR3DeferredProbeTest.java` (C2; needs `harness/rig-prepare-start-ops.patch`, a local test-rig change that
  exposes prepareExecution/startExecution through FaultGateBroker/BrokerProcess).
- `results/head-run{1,2,3}`: head 9e42875b12; `results/base-run1`: A4/A5 on design-only head 353b6526.
