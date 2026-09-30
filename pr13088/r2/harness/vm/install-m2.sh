#!/bin/bash
# inside VM: make the trial merge (main 3a8fd11711 + PR, migration V24) the "head" artifacts and main 3a8fd11711 the "base";
# keep the 7c54aa78 / e263741eb artifacts under r2-* names.
set -eu
RIG=/rig; cd /opt/w1a
[ -e r2-head-server.jar ] || { sudo mv head-server.jar r2-head-server.jar; sudo mv base-server.jar r2-base-server.jar; sudo mv dist-head dist-r2-head; sudo mv dist-base dist-r2-base; }
sudo cp $RIG/server/m2-server.jar head-server.jar; sudo cp $RIG/server/base2-server.jar base-server.jar; sudo chmod a+r *.jar
for p in m2:head base2:base; do s=${p%%:*}; d=${p##*:}; sudo rm -rf dist-$d; sudo cp -r $RIG/dist/$s dist-$d; sudo chmod -R a+rX dist-$d; done
sudo cp $RIG/vm/run-server.sh /opt/w1a/run-server.sh; sudo chmod a+rx /opt/w1a/run-server.sh
sha256sum head-server.jar base-server.jar r2-head-server.jar | cut -c1-16,65-
for d in dist-head dist-base dist-r2-head dist-old-head; do echo "$d cli.js=$(sha256sum $d/cli.js | cut -c1-12) server-chunk=$(ls $d/chunks | grep '^server-' | head -1)"; done
