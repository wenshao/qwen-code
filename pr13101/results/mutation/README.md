# Mutation testing of the PR's Java code

39 single-edit mutants (see `harness/mut/mutate.mjs` for each edit), one Maven run per mutant.

| Pass | Tests | Result |
| ---- | ----- | ------ |
| 01–04 | the PR's unit suite (239 tests at `c11c1bdf3c`) | 21 killed, 18 survived |
| 05 | `HostedPublicWorkspaceIT` (packaged Harness, real worker, MySQL 8.4.7) on the 17 survivors known then | kills M28, M31, M32 |
| 06 | `candidates/ManagedActionsCoverageTest.java` (8 tests) on the survivors | kills M10, M11, M14, M18, M20, M22, M25, M28, M29, M33, M39 |
| 07 | unit suite at `7ab2952507` for the mutants whose surrounding code changed | M01 killed, M34 killed, M35 survived (unchanged verdicts) |

Left after all passes: M12 (defence in depth), M23 and M24 (equivalent), M35 (differs only if the deployment mode changes between admission and create), M36 (only the 8 s expiry probe on the real stack catches it).

A kill counts only when a test of a class other than `ToolPublicationStoreTest` fails: that class has a timing test that failed under host load (60–100) for unrelated mutants, so such runs were repeated (`reruns=` in the output). M18 looked killed in pass 02 by two such unrelated tests and survived its confirmation run (pass 03).
