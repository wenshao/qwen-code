#!/bin/bash
# VERIFICATION RIG ONLY (PR #13673 round 5): interleaved ChildWorktreeGitTest class runs, landed vs main parent, then landed with git auto-maintenance off.
export JAVA_HOME=/Users/wenshao/Install/jdk21 PATH=/Users/wenshao/Install/jdk21/bin:$PATH
O=/Users/wenshao/pr13673-rig/out
run() { local arm=$1 tag=$2; local SJ=/Users/wenshao/git/qwen-code-pr13673-$arm/packages/sdk-java
  (cd $SJ/managed-agent-server && mvn -B -ntp -q -Dmaven.repo.local=/Users/wenshao/pr13673-rig/m2-$arm -Dcheckstyle.skip=true -Dspotbugs.skip=true -Dsurefire.failIfNoSpecifiedTests=false -Dtest=ChildWorktreeGitTest test > $O/cwt-$tag.log 2>&1)
  echo "$tag $(date -u +%T) load=$(uptime | sed 's/.*averages: //' | cut -d' ' -f1) $(grep -E 'Tests run:.*Fail' $O/cwt-$tag.log | grep -v 'Time elapsed' | tail -1 | sed 's/.*Tests run/run/') fails=[$(grep -oE 'ChildWorktreeGitTest\.[a-zA-Z0-9]+ -- Time elapsed' $O/cwt-$tag.log | cut -d' ' -f1 | sed 's/ChildWorktreeGitTest.//' | cut -c1-24 | tr '\n' ' ')] $(grep -A6 'aLinkedWorktreesDirectoryIsRefusedAndNothingOutsideIsTouched -- Time' $O/cwt-$tag.log | grep -oE 'ChildWorktreeGitTest.java:[0-9]+' | head -1)"; }
git --version
for i in 1 2 3 4; do run landed landed-$i; run main4 main4-$i; done
export GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0=maintenance.auto GIT_CONFIG_VALUE_0=false GIT_CONFIG_KEY_1=gc.auto GIT_CONFIG_VALUE_1=0
for i in 1 2 3; do run landed landed-nomaint-$i; done
echo CWT-DONE
