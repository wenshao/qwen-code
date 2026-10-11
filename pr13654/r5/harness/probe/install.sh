#!/bin/bash
# usage: install.sh <worktree> -> writes RigR5ProbeTest + RigR5ProbeMySqlIT: copies of the PR's async test + IT with the
# round-3/4/5 probe methods inserted; the Bucket double gets an injectable DELETE failure and a first-read hook.
P=$(cd $(dirname $0); pwd); W=$1
D=$W/packages/sdk-java/managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent/store
python3 - "$D" "$P/probes-csi.java.txt" "$P/probes-r4.java.txt" "$P/probes-r5.java.txt" <<'PY'
import sys
d=sys.argv[1]; probes=''.join(open(f).read() for f in sys.argv[2:])
src=open(d+'/ToolPublicationAsyncVerificationTest.java').read()
src=src.replace('public class ToolPublicationAsyncVerificationTest {','public class RigR5ProbeTest {')
anchor='    private static byte[] terminal(int textLength) {'
assert src.count(anchor)==1
src=src.replace(anchor, probes+anchor)
old='''        @Override
        public void deleteIfPresent(String key) {
            objects.remove(key);
        }
'''
new='''        private RuntimeException deleteFailure;
        private Runnable readHook;
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
old2='''            return new ByteArrayInputStream(bytes);
        }
'''
new2='''            if (readHook != null) {
                Runnable hook = readHook;
                readHook = null;
                return new java.io.FilterInputStream(new ByteArrayInputStream(bytes)) {
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
            return new ByteArrayInputStream(bytes);
        }
'''
assert src.count(old2)==1
src=src.replace(old2,new2)
open(d+'/RigR5ProbeTest.java','w').write(src)
it=open(d+'/ToolPublicationAsyncVerificationMySqlIT.java').read()
it=it.replace('class ToolPublicationAsyncVerificationMySqlIT extends ToolPublicationAsyncVerificationTest','class RigR5ProbeMySqlIT extends RigR5ProbeTest')
assert 'RigR5ProbeMySqlIT' in it
open(d+'/RigR5ProbeMySqlIT.java','w').write(it)
print('installed into',d)
PY
