#!/bin/bash
# inside VM: "head" = PR head f5ede8cea8 (2cbf89313a + one IT line; same BOOT-INF/classes), "base" = main 78143fe335.
# CLI bundle: the one built at c21efbdfa1 — 2cbf89313a changes no CLI or core source file (one test file and one test driver only).
set -eu
cd /opt/w1a
sudo cp /rig/server/r5-server.jar r5-server.jar
sudo cp r5-server.jar head-server.jar; sudo cp base3-server.jar base-server.jar; sudo chmod a+r *.jar
sudo cp /rig/vm/run-server.sh /opt/w1a/run-server.sh
sha256sum head-server.jar base-server.jar | cut -c1-16,65-
/opt/qwen/jdk/bin/jar tf head-server.jar | grep -o 'db/migration/V[0-9]*__[a-z_]*' | sed 's#db/migration/##' | sort -V | tail -3 | tr '\n' ' '; echo
