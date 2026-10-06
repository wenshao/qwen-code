#!/bin/bash
# VERIFICATION RIG ONLY (PR #13166 round 6, Linux): the regression set of rounds 1-5 against one arm.
cd /root/verify/pr13166/rig/probe
export DB=${DB:-g3} ARM=${ARM:-head}
N=/usr/bin/node
ST=c $N s1-profiles.mjs
ST=b $N s2-glob.mjs
ST=e PROFILE=hosted-workspace-files/2 $N s3-symlink.mjs
ST=f $N s4-truncate.mjs
ST=g $N s5-approval.mjs
ST=h $N s6-shell2.mjs
ST=j PROFILE=hosted-workspace-files/2 $N s9-continue.mjs
ST=k PROFILE=hosted-workspace-shell/2 $N s9-continue.mjs
ST=d PROFILE=hosted-workspace-files/2 $N s16-sibling.mjs
ST=l PROFILE=hosted-workspace-files/1 $N s16-sibling.mjs
ST=m $N s18-root-session.mjs
ST=n $N s23-symlink-roots.mjs
ST=n $N s23b-climb-spellings.mjs
ST=n $N s23c-root-climb.mjs
ST=i $N s22-cancel-glob.mjs
ST=a TAG=r6 $N s19-r4.mjs
echo ALL-DONE
