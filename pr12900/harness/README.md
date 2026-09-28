# PR #12900 verification harness

Layout under `$SCRATCH`: `wt-pr` (1f1136066e), `wt-base` (42d7a2b833), `wt-pre` (3124af5bcc),
`wt-w0e` (d66fdadd27), `wt-d4` (a32bd7976b, #12881 head), a private Maven repo `m2`,
`empty-settings.xml` (`<settings/>`), and `jars/<name>-server.jar` made by `rig/build-jar.sh`.
Docker: `mariadb:10.11.18` on 33900 (root/runtime-broker), `mysql:8.4` (8.4.11) on 33984 (root/hosted-fixture).

- `rig/install-deps.sh <wt>` then `rig/server-verify.sh <wt> <port> <password> <db>`: the SDK Java
  MariaDB job's Managed Agent step (`-Pmysql-integration clean verify checkstyle:check`) plus
  `scripts/check-failsafe-reports.js non-hosted`.
- `rig/hosted.sh <wt> <db> [<cli wt>]`: the Hosted job step (`-Phosted-harness-mysql`, packaged `dist/cli.js`, Node 22).
- `e2e/refuse.mjs <mysql|mariadb>`: which jar starts on which schema (card 02).
- `e2e/repair.mjs <engine>`: recovery for a schema migrated by the D4 branch (card 02).
- `e2e/upgrade.mjs <engine> <pre|w0e>`: old main jar + real Hosted Harness + 503 on Harness close, then
  the PR jar (card 03). Run with `JVM_OPTS=-Duser.timezone=UTC`. `adapter-src` is the trusted-actor
  filter loaded via `-Dloader.path` (verification only).
- `make.mjs`: renders the four PNG cards with Playwright.
