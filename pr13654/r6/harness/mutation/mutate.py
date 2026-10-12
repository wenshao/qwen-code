# usage: mutate.py <worktree> <id>  applies one mutant in place; exits 2 if the anchor is not unique
import sys
W=sys.argv[1]; mid=sys.argv[2]
B=W+'/packages/sdk-java/managed-agent-server/src/main/java/com/alibaba/qwen/code/managedagent/store/'
M={
 'M1': ('ToolPublicationDataStore.java',
        '''                        verify(task.scope(), task.publicationId(), stored.objectKey(), stored.length(), stored.digest());
                    } catch (CorruptObjectException error) {''',
        '''                        verify(task.scope(), task.publicationId(), stored.objectKey(), stored.length(), stored.digest());
                    } catch (IllegalArgumentException error) {''',
        'segment readback quarantines on any IllegalArgumentException again (pre-426248142d catch)'),
 'M2': ('ToolPublicationStore.java',
        '''        } catch (IllegalArgumentException error) {
            throw new ApiException(HttpStatus.CONFLICT, "managed_tool_publication_fenced",''',
        '''        } catch (UnsupportedOperationException error) {
            throw new ApiException(HttpStatus.CONFLICT, "managed_tool_publication_fenced",''',
        'verification authorization failures are no longer mapped to 409 managed_tool_publication_fenced'),
 'M3': ('ToolPublicationStore.java',
        '''        require("READY".equals(head.get("recovery_status")), "Original Session owner is fenced");
        // The grant expiry''',
        '''        if (deferActivationLapse && !"READY".equals(head.get("recovery_status"))) {
            throw new ApiException(HttpStatus.CONFLICT, "managed_tool_publication_busy",
                    "Session recovery is blocked");
        }
        require("READY".equals(head.get("recovery_status")), "Original Session owner is fenced");
        // The grant expiry''',
        'recovery-busy deferral of 426248142d restored (reverts 9fbe335487)'),
 'M4': ('ToolPublicationDataStore.java',
        'throw new CorruptObjectException("Publication object digest changed");',
        'throw new IllegalStateException("Publication object digest changed");',
        'object digest mismatch in verify() treated as a transient failure'),
 'M5': ('ToolPublicationDataStore.java',
        'throw new IllegalStateException("Terminal read failed", error);',
        'throw new CorruptObjectException("Terminal read failed");',
        'an IOException while reading a terminal object is certified as corruption'),
 'M6': ('ToolPublicationDataStore.java',
        'throw new IllegalStateException("Publication object verification failed", error);',
        'throw new CorruptObjectException("Publication object verification failed");',
        'an IOException while reading a segment/resource object is certified as corruption'),
 'M7': ('ToolPublicationDataStore.java',
        '''        if (error instanceof CorruptObjectException
                || error instanceof ToolPublicationContract.ContractViolationException) {''',
        '''        if (error instanceof ToolPublicationContract.ContractViolationException) {''',
        'verified corruption is no longer a permanent failure (retried until the deadline)'),
}
f,old,new,desc=M[mid]
p=B+f; s=open(p).read()
if s.count(old)!=1:
    print(mid,'anchor count',s.count(old)); sys.exit(2)
open(p,'w').write(s.replace(old,new)); print(mid, f, '-', desc)
