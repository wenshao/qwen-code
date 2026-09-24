P='src/main/java/com/alibaba/qwen/code/runtimebroker/'
def sub(f,a,b):
    s=open(P+f).read(); assert s.count(a)==1,(f,a[:60],s.count(a)); open(P+f,'w').write(s.replace(a,b))
SVC='RuntimeBrokerService.java'; LP='LocalProcessRuntimeProvisioner.java'
sub(SVC,'''    private void invalidateBinding(RuntimeBindingRecord record) {
        liveBindings.remove(record.getBindingId());''','''    private void invalidateBinding(RuntimeBindingRecord record) {
        liveBindings.remove(record.getBindingId());
        if (record.getLease() != null) {
            releaseQuietly(record.getRequest(), record.getLease());
        }''')
sub(SVC,'''            SessionContext context) {
        requireUsableLease(context);
        CompletableFuture<Boolean> result;''','''            SessionContext context) {
        if (!provisioner.isUsable(context.lease())) {
            invalidateBinding(context.binding());
            synchronized (context) {
                if (context.hasActiveControl()
                        || executionRepository.hasActiveByRuntimeSession(
                                context.session().getRuntimeSessionId())) {
                    throw conflict("runtime_session_busy",
                            "Runtime Session has an active operation");
                }
                RuntimeSessionRecord gone =
                        transitionSessionToReleasing(context);
                if (gone.getState() != RuntimeSessionRecord.State.RELEASED) {
                    finishSessionRelease(gone);
                }
                sessions.remove(context.session().getRuntimeSessionId());
                return CompletableFuture.completedFuture(true);
            }
        }
        CompletableFuture<Boolean> result;''')
sub(LP,'''            RuntimeLease lease = new RuntimeLease(runtimeInstanceId,
                    URI.create(String.valueOf(ready.get("url"))), token,
                    leaseId, 1);''','''            URI endpoint = URI.create(String.valueOf(ready.get("url")));
            if (!"http".equals(endpoint.getScheme())
                    || !"127.0.0.1".equals(endpoint.getHost())) {
                throw failed("Managed Runtime ready record is invalid.");
            }
            RuntimeLease lease = new RuntimeLease(runtimeInstanceId,
                    endpoint, token, leaseId, 1);''')
print("applied")
