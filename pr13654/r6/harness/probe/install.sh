#!/bin/bash
# usage: install.sh <worktree> -> writes RigR6ProbeTest + RigR6ProbeMySqlIT: copies of the PR's async test + IT with the
# round-3..6 probe methods inserted; the Bucket double gets an injectable DELETE failure, delete counters and a
# first-read hook (which may throw IOException) in front of the PR's own midRead stream.
P=$(cd $(dirname $0); pwd); W=$1
D=$W/packages/sdk-java/managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent/store
python3 - "$D" "$P/probes-csi.java.txt" "$P/probes-r4.java.txt" "$P/probes-r5.java.txt" "$P/probes-r6.java.txt" <<'PY'
import sys
d=sys.argv[1]; probes=''.join(open(f).read() for f in sys.argv[2:])
src=open(d+'/ToolPublicationAsyncVerificationTest.java').read()
src=src.replace('public class ToolPublicationAsyncVerificationTest {','public class RigR6ProbeTest {')
anchor='    private static byte[] terminal(int textLength) {'
assert src.count(anchor)==1
src=src.replace(anchor, probes+anchor)
old='''        @Override
        public void deleteIfPresent(String key) {
            assertThat(TransactionSynchronizationManager.isActualTransactionActive()).isFalse();
            objects.remove(key);
        }
'''
new='''        private RuntimeException deleteFailure;
        private RigIoHook readHook;
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
assert src.count(old)==1, 'deleteIfPresent anchor'
src=src.replace(old,new)
old2='''            return new ByteArrayInputStream(bytes) {
'''
new2='''            if (readHook != null) {
                RigIoHook hook = readHook;
                readHook = null;
                byte[] served = bytes;
                return new java.io.FilterInputStream(new ByteArrayInputStream(served)) {
                    private boolean fired;

                    @Override
                    public int read(byte[] buffer, int offset, int length) throws java.io.IOException {
                        if (!fired) {
                            fired = true;
                            hook.run();
                        }
                        return super.read(buffer, offset, length);
                    }
                };
            }
            return new ByteArrayInputStream(bytes) {
'''
assert src.count(old2)==1, 'open anchor'
src=src.replace(old2,new2)
open(d+'/RigR6ProbeTest.java','w').write(src)
it=open(d+'/ToolPublicationAsyncVerificationMySqlIT.java').read()
it=it.replace('class ToolPublicationAsyncVerificationMySqlIT extends ToolPublicationAsyncVerificationTest','class RigR6ProbeMySqlIT extends RigR6ProbeTest')
assert 'RigR6ProbeMySqlIT' in it
open(d+'/RigR6ProbeMySqlIT.java','w').write(it)
print('installed into',d)
PY
