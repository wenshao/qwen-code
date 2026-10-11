#!/bin/bash
# usage: install.sh <worktree> -> writes RigR4ProbeTest + RigR4ProbeMySqlIT (copies of the PR's async test + IT, probes inserted, Bucket gets delete fault injection)
P=$(cd $(dirname $0); pwd); W=$1
D=$W/packages/sdk-java/managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent/store
python3 - "$D" "$P/probes-csi.java.txt" "$P/probes-r4.java.txt" <<'PY'
import sys
d=sys.argv[1]; probes=open(sys.argv[2]).read()+open(sys.argv[3]).read()
src=open(d+'/ToolPublicationAsyncVerificationTest.java').read()
src=src.replace('public class ToolPublicationAsyncVerificationTest {','public class RigR4ProbeTest {')
anchor='    private static byte[] terminal(int textLength) {'
assert src.count(anchor)==1
src=src.replace(anchor, probes+anchor)
old='''        @Override
        public void deleteIfPresent(String key) {
            objects.remove(key);
        }
'''
new='''        private RuntimeException deleteFailure;
        private final AtomicInteger deletes = new AtomicInteger();
        private final AtomicInteger deletesInTx = new AtomicInteger();

        @Override
        public void deleteIfPresent(String key) {
            deletes.incrementAndGet();
            if (TransactionSynchronizationManager.isActualTransactionActive()) {
                deletesInTx.incrementAndGet();
            }
            if (deleteFailure != null) {
                RuntimeException failure = deleteFailure;
                deleteFailure = null;
                throw failure;
            }
            objects.remove(key);
        }
'''
assert src.count(old)==1
src=src.replace(old,new)
open(d+'/RigR4ProbeTest.java','w').write(src)
it=open(d+'/ToolPublicationAsyncVerificationMySqlIT.java').read()
it=it.replace('class ToolPublicationAsyncVerificationMySqlIT extends ToolPublicationAsyncVerificationTest','class RigR4ProbeMySqlIT extends RigR4ProbeTest')
assert 'RigR4ProbeMySqlIT' in it
open(d+'/RigR4ProbeMySqlIT.java','w').write(it)
print('installed into',d)
PY
