#!/bin/bash
# usage: install.sh <worktree>  -> writes RigCsiRetirementProbeTest + RigCsiRetirementProbeMySqlIT into the worktree's test dir
P=$(cd $(dirname $0); pwd); W=$1
D=$W/packages/sdk-java/managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent/store
python3 - "$D" "$P/probes.java.txt" <<'PY'
import sys,re
d,probes=sys.argv[1],open(sys.argv[2]).read()
src=open(d+'/ToolPublicationAsyncVerificationTest.java').read()
src=src.replace('public class ToolPublicationAsyncVerificationTest {','public class RigCsiRetirementProbeTest {')
anchor='    private static byte[] terminal(int textLength) {'
assert src.count(anchor)==1
src=src.replace(anchor, probes+anchor)
open(d+'/RigCsiRetirementProbeTest.java','w').write(src)
it=open(d+'/ToolPublicationAsyncVerificationMySqlIT.java').read()
it=it.replace('class ToolPublicationAsyncVerificationMySqlIT extends ToolPublicationAsyncVerificationTest','class RigCsiRetirementProbeMySqlIT extends RigCsiRetirementProbeTest')
assert 'RigCsiRetirementProbeMySqlIT' in it
open(d+'/RigCsiRetirementProbeMySqlIT.java','w').write(it)
print('installed into',d)
PY
