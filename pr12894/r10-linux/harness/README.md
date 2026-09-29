# Round 10 rig (Linux port)

Same stack as rounds 1-9 (see `pr12894/harness/README.md` and `pr12894/r5/harness/README.md`), ported from
macOS to Linux (aarch64, kernel 6.6):

- MySQL 8.4.11 in Docker (`mysql:8.4`, port 13894, root password `rig12894`); `mysql-cli` wraps
  `docker exec -i mysql84-rig mysql` and strips the host-side `-h/-P`.
- JDK 21 at `/opt/jdk21`; Node 24 at `/usr/bin/node` (`node22.sh` wrapper kept for the Broker; rounds 1-9 used Node 22).
- TLS/OSS double: `tls-gen.sh` regenerates the CA/leaf/`trust.jks`/`hosts` (30-day CA; regenerate if expired).
- `spring.sh`/`up.sh`: same flags, rig dir `/root/rig`, jar `/root/jars/pr-server.jar`.
- `r10.sh`: the round-9 matrix at head `0172d5eca` on fresh schema `o2r11`, plus the R9-1 A/B
  (`s13-digest.ts CASESET=validation` with `HARNESS_WT` = pre-fix `3da25b7c` bundle vs head bundle).
- `r10b-pt.sh`: P/T preview sections rerun after fixing macOS paths baked into `r7-cases.json` /
  `r8-tail-cases.json` (`prevgen.mjs`/`tailgen.mjs` + node path).
- `r10c-big.sh`: the 1 GiB case with `SHELL_TIMEOUT=600000`; this host generates ~610 MiB per 120 s, so the
  tool's default 120 s timeout cuts the unmodified case short (expected `timeout` outcome, not a capture defect).
- `range-recheck.mjs`: standalone second-owner range reads for a completed publication
  (used when the s1 driver died before its range phase).
