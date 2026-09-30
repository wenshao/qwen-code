#!/bin/bash
# inside VM: make PR head c21efbdfa1 the "head" artifacts (base stays main 3a8fd11711 = its merge base);
# keep the trial-merge artifacts under m2-* names. Also installs the OSS double for O2 publication.
set -eu
RIG=/rig; cd /opt/w1a
[ -e m2-head-server.jar ] || { sudo mv head-server.jar m2-head-server.jar; sudo mv dist-head dist-m2-head; }
sudo cp $RIG/server/r3-server.jar head-server.jar; sudo chmod a+r *.jar
sudo rm -rf dist-head; sudo cp -r $RIG/dist/r3 dist-head; sudo chmod -R a+rX dist-head
sudo cp $RIG/vm/run-server.sh /opt/w1a/run-server.sh; sudo chmod a+rx /opt/w1a/run-server.sh
sudo rm -rf /opt/w1a/o2; sudo cp -r $RIG/vm/o2 /opt/w1a/o2; sudo chmod -R a+rX /opt/w1a/o2; sudo chown -R $(id -un) /opt/w1a/o2
grep -q '^MCP=' /etc/qwen-w1a.env || echo 'MCP=0' | sudo tee -a /etc/qwen-w1a.env > /dev/null
/opt/qwen/node -e 'const fs=require("fs");fs.writeFileSync("/var/lib/qwen-w1a/mcp-manifest.json",JSON.stringify({version:1,servers:["a","b","c","d"].map((s)=>({tenantId:"t-w1a",workspaceId:"ws-"+s,serverId:"demo",serverRevision:1,definitionDigest:"c".repeat(64),transport:"stdio",command:"/opt/qwen/node",args:["/opt/w1a/o2/mcp-server.mjs"]}))},null,1))'
grep -q '^PUB=' /etc/qwen-w1a.env || echo 'PUB=0' | sudo tee -a /etc/qwen-w1a.env > /dev/null
sudo sysctl -q -w net.ipv4.ip_unprivileged_port_start=443
sha256sum head-server.jar base-server.jar m2-head-server.jar r2-head-server.jar | cut -c1-16,65-
for d in dist-head dist-base dist-m2-head dist-r2-head; do echo "$d cli.js=$(sha256sum $d/cli.js | cut -c1-12) server-chunk=$(ls $d/chunks | grep '^server-' | head -1)"; done
/opt/qwen/jdk/bin/jar tf head-server.jar | grep -o 'db/migration/V[0-9]*__[a-z_]*' | sed 's#db/migration/##' | sort -V | tr '\n' ' '; echo
/opt/qwen/jdk/bin/jar tf base-server.jar | grep -o 'db/migration/V[0-9]*__[a-z_]*' | sed 's#db/migration/##' | sort -V | tail -3 | tr '\n' ' '; echo
