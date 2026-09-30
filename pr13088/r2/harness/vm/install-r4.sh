#!/bin/bash
# inside VM: "head" = PR head 2cbf89313a (merge of main 78143fe335; W1 migration V25), "base" = main 78143fe335.
# CLI bundle: the one built at c21efbdfa1 — 2cbf89313a changes no CLI or core source file (one test file and one test driver only).
set -eu
cd /opt/w1a
sudo cp /rig/server/r4-server.jar r4-server.jar
sudo cp r4-server.jar head-server.jar; sudo cp base3-server.jar base-server.jar; sudo chmod a+r *.jar
sudo cp /rig/vm/run-server.sh /opt/w1a/run-server.sh
sha256sum head-server.jar base-server.jar | cut -c1-16,65-
/opt/qwen/jdk/bin/jar tf head-server.jar | grep -o 'db/migration/V[0-9]*__[a-z_]*' | sed 's#db/migration/##' | sort -V | tail -3 | tr '\n' ' '; echo
