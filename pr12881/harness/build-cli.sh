#!/bin/bash
SP=$SP
cd $SP/wt-base || exit 1
( time node scripts/setup-worktree.js ) > $SP/logs/cli-setup.log 2>&1; echo "setup rc=$?"
( time (npm run build && npm run bundle) ) > $SP/logs/cli-build.log 2>&1; echo "build+bundle rc=$?"
ls -la dist/cli.js
echo CLI_DONE
