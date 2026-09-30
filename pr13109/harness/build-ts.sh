#!/bin/bash
# build-ts.sh <tree> <log>
set -e
export PATH=$HOME/.local/share/fnm/node-versions/v22.23.2/installation/bin:$PATH
cd "$1"
node -v
corepack pnpm install --frozen-lockfile
npm run build
npm run bundle
ls -la dist/cli.js
echo TS_BUILD_OK
