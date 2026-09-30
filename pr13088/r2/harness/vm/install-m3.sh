#!/bin/bash
# inside VM: usage install-m3.sh m3|r3
#   m3: "head" = local trial merge (PR c21efbdfa1 + main 78143fe335, W1 migration V25), "base" = main 78143fe335
#   r3: back to PR head c21efbdfa1 / main 3a8fd11711
# The CLI bundle is the same in both: main changed no CLI/core source between 3a8fd11711 and 78143fe335 (one test file only).
set -eu
cd /opt/w1a
[ -e r3-head-server.jar ] || { sudo cp head-server.jar r3-head-server.jar; sudo cp base-server.jar base2-server.jar; }
case "$1" in
  m3) sudo cp m3-server.jar head-server.jar; sudo cp base3-server.jar base-server.jar ;;
  r3) sudo cp r3-head-server.jar head-server.jar; sudo cp base2-server.jar base-server.jar ;;
esac
sudo chmod a+r *.jar
sha256sum head-server.jar base-server.jar r3-head-server.jar m3-server.jar | cut -c1-16,65-
/opt/qwen/jdk/bin/jar tf head-server.jar | grep -o 'db/migration/V[0-9]*__[a-z_]*' | sed 's#db/migration/##' | sort -V | tail -3 | tr '\n' ' '; echo
