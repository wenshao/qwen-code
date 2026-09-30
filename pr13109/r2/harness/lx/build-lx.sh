#!/bin/bash
# build-lx.sh  -- assemble /rig for the Linux container (durable local workers).
set -euo pipefail
S=$(cd "$(dirname "$0")/.." && pwd)
L=$S/lx/rig
NODE22=$HOME/.local/share/fnm/node-versions/v22.23.2/installation/bin/node
mkdir -p $L/lib $L/drivers $L/head $L/base
# Java: dependency jars (identical for both arms), server classes per arm, rig launcher (release 21)
i=0; for j in $(tr ':' '\n' < $S/cp.txt); do i=$((i+1)); cp -n "$j" "$L/lib/$(printf %03d $i)-$(basename $j)" 2>/dev/null || true; done
rm -rf $L/classes-head $L/classes-base $L/rigmain
cp -R $S/wt-head/packages/sdk-java/managed-agent-server/target/classes $L/classes-head
cp -R $S/wt-base/packages/sdk-java/managed-agent-server/target/classes $L/classes-base
cp -R $S/rig/java/out21 $L/rigmain
# CLI bundles
rm -rf $L/head/dist $L/base/dist $L/cand/dist; mkdir -p $L/cand
cp -R $S/wt-head/dist $L/head/dist
cp -R $S/wt-base/dist $L/base/dist
cp -R $S/wt-mut/dist $L/cand/dist
# Scenario drivers, bundled to plain ESM (no tsx in the container)
H=$S/wt-head/integration-tests/helpers
cp $S/rig/lib.ts $H/rig12946-lib.ts
for scen in r8-broker-restart r1-release x-phase r9-legacy-restart; do
  cp $S/rig/$scen.ts $H/rig12946-$scen.ts
  $S/wt-head/node_modules/.bin/esbuild $H/rig12946-$scen.ts --bundle --platform=node --format=esm --target=node22 \
    --banner:js="import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" \
    --outfile=$L/drivers/$scen.mjs --log-level=warning
done
# MCP fixture server with static imports, bundled
$NODE22 -e '
const fs = require("fs");
let t = fs.readFileSync(process.argv[1], "utf8");
const a = t.indexOf("const SDK = process.env.RIG_SDK;");
const b = t.indexOf("const argv = Object.fromEntries(");
if (a < 0 || b < 0) throw new Error("anchors");
t = t.slice(0, a) + [
  "import { McpServer, ResourceTemplate } from \"@modelcontextprotocol/sdk/server/mcp.js\";",
  "import { StdioServerTransport } from \"@modelcontextprotocol/sdk/server/stdio.js\";",
  "import { StreamableHTTPServerTransport } from \"@modelcontextprotocol/sdk/server/streamableHttp.js\";",
  "import { SSEServerTransport } from \"@modelcontextprotocol/sdk/server/sse.js\";",
  "import { isInitializeRequest } from \"@modelcontextprotocol/sdk/types.js\";",
  "import * as z from \"zod\";", "",
].join("\n") + t.slice(b);
fs.writeFileSync(process.argv[2], t);
' $S/rig/mcp-server.mjs $H/rig12946-mcp-server-static.mjs
$S/wt-head/node_modules/.bin/esbuild $H/rig12946-mcp-server-static.mjs --bundle --platform=node --format=esm --target=node22 \
  --banner:js="import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" \
  --outfile=$L/mcp-server.mjs --log-level=warning
rm -f $H/rig12946-mcp-server-static.mjs
cp $S/lx/up-lx.sh $S/lx/spring-lx.sh $S/lx/down-lx.sh $S/lx/manifest-lx.mjs $L/
du -sh $L | cat
echo LX_BUILD_OK
