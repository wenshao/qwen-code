#!/bin/bash
# macOS host: build PR head c21efbdfa1 on the second Linux host (idle, 12 cores) for the vitest mutation runs.
set -u
NEW=c21efbdfa156778d091f655447711f45c53b6081; D=/root/git/qwen-code-pr13088-r3; H=root@<second-host>
ssh -o BatchMode=yes $H "rm -rf $D && mkdir -p $D"
git -C /rig/wt-merge archive $NEW | ssh -o BatchMode=yes $H "tar -x -C $D"
ssh -o BatchMode=yes $H "cd $D && git init -q && git add -A > /dev/null 2>&1 && git -c user.email=rig@example.invalid -c user.name=rig commit -q -m 'PR 13088 head c21efbdfa1 (archive)' && (npx -y pnpm@11.24.0 install --frozen-lockfile --registry=https://registry.npmmirror.com > /root/pr13088-r3-install.log 2>&1; echo install exit=\$?) && (npm run build > /root/pr13088-r3-build.log 2>&1; echo build exit=\$?) && node -v && uptime"
