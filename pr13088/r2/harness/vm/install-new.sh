#!/bin/bash
# inside VM: make the rebased PR head (7c54aa78) and its base (main e263741eb) the "head"/"base" artifacts;
# keep the first-round artifacts (04048333 / 23e0a451) under old-* names.
set -eu
RIG=/rig; cd /opt/w1a
[ -e old-head-server.jar ] || { sudo mv head-server.jar old-head-server.jar; sudo mv base-server.jar old-base-server.jar; sudo mv dist-head dist-old-head; sudo mv dist-base dist-old-base; }
sudo cp $RIG/server/new-server.jar head-server.jar; sudo cp $RIG/server/nbase-server.jar base-server.jar; sudo chmod a+r *.jar
for p in new:head nbase:base; do s=${p%%:*}; d=${p##*:}; [ -f $RIG/dist/$s/cli.js ] || { echo "dist/$s not built yet"; continue; }; sudo rm -rf dist-$d; sudo cp -r $RIG/dist/$s dist-$d; sudo chmod -R a+rX dist-$d; done
sudo cp $RIG/vm/run-server.sh /opt/w1a/run-server.sh; sudo chmod a+rx /opt/w1a/run-server.sh
sha256sum *.jar | cut -c1-16,65-
for d in dist-*; do echo "$d cli.js=$(sha256sum $d/cli.js | cut -c1-12) server-chunk=$(ls $d/chunks | grep -c '^server-')"; done
