#!/bin/bash
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/54b7ab90-ab14-4aaa-958e-1d2b84bfc2f7/scratchpad
cd $S/wt-merge || exit 2
pnpm install --frozen-lockfile > $S/logs/build-node-install.log 2>&1 || { echo INSTALL-FAIL; exit 1; }
npm run build > $S/logs/build-node-build.log 2>&1 || { echo BUILD-FAIL; exit 1; }
npm run bundle > $S/logs/build-node-bundle.log 2>&1 || { echo BUNDLE-FAIL; exit 1; }
ls -la dist/cli.js && echo NODE-BUILD-OK
