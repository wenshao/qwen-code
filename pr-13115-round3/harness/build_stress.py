import os, shutil, sys
SRC='/root/verify/pr13115/head/packages/sdk-java/runtime-broker'
R='src/test/java/com/alibaba/qwen/code/runtimebroker/'
M='src/main/java/com/alibaba/qwen/code/runtimebroker/RuntimeBrokerService.java'
OUT=sys.argv[1]
def rep(s,a,b):
    assert s.count(a)==1, a[:80]
    return s.replace(a,b)
def instrument(d):
    p=d+R+'FaultGateRig.java'; s=open(p).read()
    s=rep(s,'''        T value = probe.get();
        while (!done.test(value)) {
            if (System.nanoTime() > deadline) {''','''        T value = probe.get();
        while (!done.test(value)) {
            census(what, "REJECT", value);
            if (System.nanoTime() > deadline) {''')
    s=rep(s,'''            Thread.sleep(50);
            value = probe.get();
        }
        return value;''','''            Thread.sleep(50);
            value = probe.get();
        }
        census(what, "ACCEPT", value);
        return value;''')
    s=rep(s,'    static <T> T await(Supplier<T> probe, Predicate<T> done, String what)','''    /** Verification census: appends every value await() sees. */
    static void census(String what, String verdict, Object value) {
        String file = System.getProperty("census.file");
        if (file == null) {
            return;
        }
        String line = System.currentTimeMillis() + "\\t"
                + System.getProperty("census.iter", "?") + "\\t" + what + "\\t"
                + verdict + "\\t" + String.valueOf(value).replace('\\n', ' ') + "\\n";
        try {
            java.nio.file.Files.writeString(Path.of(file), line,
                    StandardCharsets.UTF_8,
                    java.nio.file.StandardOpenOption.CREATE,
                    java.nio.file.StandardOpenOption.APPEND);
        } catch (java.io.IOException ignored) {
            // census is best-effort
        }
    }

    static <T> T await(Supplier<T> probe, Predicate<T> done, String what)''')
    s=rep(s,'''        Map<String, Object> scopeConfig = new LinkedHashMap<>();
        scopeConfig.put("tenantId", scope.getTenantId());''','''        if (relay == null && Long.getLong("census.jdbcDelayMs", 0) > 0) {
            // verification-only: every Broker's JDBC goes through a delaying relay
            relay = databaseRelay();
        }
        Map<String, Object> scopeConfig = new LinkedHashMap<>();
        scopeConfig.put("tenantId", scope.getTenantId());''')
    with open(p,'w') as f: f.write(s)
    p=d+R+'TcpRelay.java'; s=open(p).read()
    s=rep(s,'''            pump(client, upstream, directions);
            pump(upstream, client, directions);''','''            pump(client, upstream, directions, 0);
            pump(upstream, client, directions, Long.getLong("census.jdbcDelayMs", 0));''')
    s=rep(s,'private void pump(Socket from, Socket to, AtomicInteger directions) {','private void pump(Socket from, Socket to, AtomicInteger directions, long delayMs) {')
    s=rep(s,'''                while ((read = input.read(buffer)) >= 0) {
                    output.write(buffer, 0, read);''','''                while ((read = input.read(buffer)) >= 0) {
                    if (delayMs > 0) {
                        try {
                            Thread.sleep(delayMs);
                        } catch (InterruptedException interrupted) {
                            Thread.currentThread().interrupt();
                            throw new IOException(interrupted);
                        }
                    }
                    output.write(buffer, 0, read);''')
    with open(p,'w') as f: f.write(s)
    p=d+M; s=open(p).read()
    s=rep(s,'''    private static RuntimeBrokerException unavailable(String code,
            String message) {
        return new RuntimeBrokerException(503, code, message, true);
    }''','''    private static RuntimeBrokerException unavailable(String code,
            String message) {
        if ("runtime_provision_fenced".equals(code)) {
            censusFence();
        }
        return new RuntimeBrokerException(503, code, message, true);
    }

    /** Verification-only: records where a fence was raised. */
    private static void censusFence() {
        String file = System.getenv("CENSUS_FENCE_LOG");
        if (file == null) {
            return;
        }
        StringBuilder line = new StringBuilder();
        line.append(System.currentTimeMillis()).append('\\t')
                .append(ProcessHandle.current().pid()).append('\\t')
                .append(Thread.currentThread().getName());
        for (StackTraceElement frame : new Throwable().getStackTrace()) {
            if (frame.getClassName().startsWith("com.alibaba")
                    && !frame.getMethodName().startsWith("censusFence")
                    && !frame.getMethodName().equals("unavailable")) {
                line.append('\\t').append(frame.getMethodName()).append(':')
                        .append(frame.getLineNumber());
            }
        }
        line.append('\\n');
        try {
            java.nio.file.Files.writeString(java.nio.file.Path.of(file),
                    line.toString(), java.nio.charset.StandardCharsets.UTF_8,
                    java.nio.file.StandardOpenOption.CREATE,
                    java.nio.file.StandardOpenOption.APPEND);
        } catch (java.io.IOException ignored) {
            // best effort
        }
    }''')
    with open(p,'w') as f: f.write(s)
for arm,src in (('head','/root/verify/pr13115/r2/r2-head/runtime-broker'),('fix','/root/verify/pr13115/r2/r2-fixBoth/runtime-broker')):
    d=f'{OUT}/{arm}/runtime-broker/'
    if os.path.exists(os.path.dirname(d.rstrip('/'))): shutil.rmtree(os.path.dirname(d.rstrip('/')))
    os.makedirs(os.path.dirname(d.rstrip('/')))
    shutil.copytree(SRC, d, ignore=shutil.ignore_patterns('target'))
    # production file from the arm (head or head+fixA+fixR31), tests from the PR head
    shutil.copy(src+'/'+M, d+M)
    instrument(d)
    print(arm,'ok')
