#!/bin/bash
# Round 7: ChildWorktreeGitTest#aLinkedWorktreesDirectoryIsRefusedAndNothingOutsideIsTouched alone on the trial merge 74bab6a5,
# 4 runs with this machine's default git config, then 4 with git background maintenance off (GIT_CONFIG_COUNT env).
S=/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/8b5b6f90-8800-48da-9e9c-05b8ecdac3c5/scratchpad; R=$S/rig; W=$HOME/git/qwen-code-pr13654-main; M=$R/mvn-main6.sh
L=$S/r7/logs/linked; mkdir -p $L
cd $W || exit 1; [ -z "$(git status --porcelain)" ] || { echo "worktree dirty"; exit 1; }
git checkout -q --detach 74bab6a50fce22a8cea1ebb08403d4ed99e4c675 || exit 1
echo "at $(git rev-parse --short HEAD), git $(git --version | awk '{print $3}')"
cd packages/sdk-java/managed-agent-server
T='ChildWorktreeGitTest#aLinkedWorktreesDirectoryIsRefusedAndNothingOutsideIsTouched'
one() { rm -f target/surefire-reports/TEST-*ChildWorktreeGitTest.xml
  $M -o -Dcheckstyle.skip -Dspotbugs.skip -Djacoco.skip=true -Dtest="$T" -Dsurefire.failIfNoSpecifiedTests=false surefire:test > $L/$1.log 2>&1
  x=$(ls target/surefire-reports/TEST-*ChildWorktreeGitTest.xml 2>/dev/null)
  [ -n "$x" ] || { echo "$1: NO REPORT ($(grep -E 'BUILD|ERROR' $L/$1.log | head -2 | tr '\n' ' '))"; return; }
  cp "$x" $L/$1.xml
  echo "$1: $(python3 -c "import sys,xml.etree.ElementTree as E; r=E.parse(sys.argv[1]).getroot(); f=[(c.get('name'),(c.find('failure') if c.find('failure') is not None else c.find('error')).get('message','')[:140].replace(chr(10),' ')) for c in r.iter('testcase') if c.find('failure') is not None or c.find('error') is not None]; print('tests=%s failures=%s errors=%s' % (r.get('tests'),r.get('failures'),r.get('errors')), f if f else '')" "$x")"; }
for i in 1 2 3 4; do one default-$i; done
for i in 1 2 3 4; do GIT_CONFIG_COUNT=2 GIT_CONFIG_KEY_0=maintenance.auto GIT_CONFIG_VALUE_0=false GIT_CONFIG_KEY_1=gc.auto GIT_CONFIG_VALUE_1=0 one nomaint-$i; done
cd $W && git checkout -q --detach b8203960e5 && echo "restored $(git rev-parse --short HEAD) dirty=[$(git status --porcelain)]"
