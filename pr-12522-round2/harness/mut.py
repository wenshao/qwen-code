import os, shutil, subprocess, sys, re, concurrent.futures as cf
SRC=os.environ.get('SRC','/root/verify/pr12522/packages/sdk-java')
REL='runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker/HttpRuntimeTransport.java'
ROOT=os.environ.get('ROOT','/root/verify/pr12522-mut')
M = [
 ('M01','drop request Cache-Control', '                .header("Cache-Control", "no-store")\n', ''),
 ('M02','drop Authorization header', '                .header("Authorization", "Bearer " + lease.getToken())\n', ''),
 ('M03','drop X-Qwen-Managed-Lease-Id header', '''                .header("X-Qwen-Managed-Lease-Id", lease.getLeaseId())\n''', ''),
 ('M04','drop X-Qwen-Managed-Lease-Epoch header', '''                .header("X-Qwen-Managed-Lease-Epoch",
                        Long.toString(lease.getEpoch()))\n''', ''),
 ('M05','drop request Content-Type', '                .header("Content-Type", "application/json")\n', ''),
 ('M06','skip response Cache-Control check', 'if (!"no-store".equals(cacheControl)\n                ||', 'if (false\n                ||'),
 ('M07','skip response Content-Type check', '|| !jsonContentType(contentType)) {', '|| false) {'),
 ('M08','accept any content-type parameter', 'if (!"charset=utf-8".equalsIgnoreCase(parts[index].trim())) {', 'if (false) {'),
 ('M09','skip closed field set', 'if (!fields.keySet().equals(RESPONSE_FIELDS)) {', 'if (!fields.keySet().containsAll(RESPONSE_FIELDS)) {'),
 ('M10','skip protocolVersion check', '        requireProtocol(fields);\n', ''),
 ('M11','drop runtimeInstanceId compare', '''        return lease.getRuntimeInstanceId().equals(
                        attestation.getRuntimeInstanceId())
                && ''', '        return '),
 ('M12','drop gatewayIncarnation compare', '''                && seed.getGatewayIncarnation().equals(
                        attestation.getRuntimeIncarnation())\n''', ''),
 ('M13','drop leaseId compare', '                && lease.getLeaseId().equals(attestation.getLeaseId())\n', ''),
 ('M14','drop epoch compare', '                && lease.getEpoch() == attestation.getEpoch()\n', ''),
 ('M15','drop scope compare', '                && request.getScope().equals(attestation.getScope())\n', ''),
 ('M16','drop provisionRequestId compare', '''                && seed.getProvisionRequestId().equals(
                        attestation.getProvisionRequestId());''', ';'),
 ('M17','unbounded read (readAllBytes)', 'byte[] bytes = readAtMost(stream);', 'byte[] bytes = stream.readAllBytes();'),
 ('M18','oversized 5xx becomes 413', '''            if (status >= 500) {
                throw failure(status);
            }
            throw tooLarge();''', '            throw tooLarge();'),
 ('M19','IAE escapes raw', 'catch (RuntimeBrokerException | IllegalArgumentException exception) {', 'catch (RuntimeBrokerException exception) {'),
 ('M20','5xx not retryable', '''                    "Managed Runtime attestation endpoint is unavailable.",
                    true);''', '''                    "Managed Runtime attestation endpoint is unavailable.",
                    false);'''),
 ('M21','connection failure not retryable', '"Managed Runtime request failed.", true, cause);', '"Managed Runtime request failed.", false, cause);'),
 ('M22','seed/lease binding unchecked', '        if (!seed.matches(lease)) {', '        if (false) {'),
 ('M23','epoch <= 0 accepted', 'if (number.doubleValue() != parsed || parsed <= 0) {', 'if (number.doubleValue() != parsed) {'),
 ('M24','non-integral epoch accepted', 'if (number.doubleValue() != parsed || parsed <= 0) {', 'if (parsed <= 0) {'),
 ('M25','follow redirects', 'HttpClient.Redirect.NEVER', 'HttpClient.Redirect.NORMAL'),
 ('M26','404 retryable', '''                    "Managed Runtime attestation endpoint is incompatible.",
                    false);
        }
        if (status >= 500)''', '''                    "Managed Runtime attestation endpoint is incompatible.",
                    true);
        }
        if (status >= 500)'''),
 ('M27','401 retryable', '"Managed Runtime credentials are invalid.", false);', '"Managed Runtime credentials are invalid.", true);'),
 ('M28','409 retryable', 'return error(409, "managed_runtime_identity_conflict", message,\n                false);', 'return error(409, "managed_runtime_identity_conflict", message,\n                true);'),
 ('M29','limit off-by-one (>= )', 'if (bytes.length > BODY_LIMIT_BYTES) {', 'if (bytes.length >= BODY_LIMIT_BYTES) {'),
 ('M30','drop request timeout', '                .timeout(REQUEST_TIMEOUT)\n', ''),
 ('N29','limit off-by-one (overflow at == limit)', 'if (buffer.remaining() > remaining) {', 'if (buffer.remaining() >= remaining) {'),
] + ([
 ('N01','no stage deadline (drop orTimeout)', '''                .orTimeout(requestTimeout.toMillis(), TimeUnit.MILLISECONDS)\n''', ''),
 ('N02','deadline/cancel does not cancel exchange', '                exchange.cancel(true);\n', ''),
 ('N03','timeout escapes raw (no 503 mapping)', '                    throw unavailable(cause);', '                    throw new CompletionException(cause);'),
 ('N05','overflow flag ignored', '        if (body.overflow()) {', '        if (false) {'),
 ('N06','onNext keeps going after completion', '''            if (body.isDone()) {
                return;
            }
            for (ByteBuffer buffer''', '''            for (ByteBuffer buffer'''),
 ('N07','caller cancel not propagated', 'if (error != null || returned.isCancelled()) {', 'if (error != null && !(error instanceof java.util.concurrent.CancellationException)) {'),
 ('N08','handle does not unwrap', '                    Throwable cause = unwrap(error);', '                    Throwable cause = error;'),
 ('N09','zero/negative timeout accepted', '''        if (requestTimeout == null || requestTimeout.isNegative()
                || requestTimeout.isZero()) {''', '        if (requestTimeout == null) {'),
] if os.environ.get('R2') else []) + ([
 ('F01','no deadline at all', '''                    if (result.completeExceptionally(unavailable(''', '''                    if (false && result.completeExceptionally(unavailable('''),
 ('F02','deadline does not cancel exchange', '                        exchange.cancel(true);\n', ''),
 ('F03','subscriber never stops at limit', '                if (bytes.size() > BODY_LIMIT_BYTES) {', '                if (false) {'),
 ('F04','subscriber drops overflow byte', 'int room = BODY_LIMIT_BYTES + 1 - bytes.size();', 'int room = BODY_LIMIT_BYTES - bytes.size();'),
] if os.environ.get('FIX') else [])
def run(m):
    mid, desc, a, b = m
    d = f'{ROOT}/{mid}'
    shutil.rmtree(d, ignore_errors=True)
    os.makedirs(d + '/packages')
    if mid != 'M00' and True:
        shutil.copytree(SRC, d + '/packages/sdk-java', ignore=shutil.ignore_patterns('target'))
        p = d + '/packages/sdk-java/' + REL
        s = open(p).read()
        if s.count(a) != 1:
            return mid, desc, 'N/A', []
        open(p, 'w').write(s.replace(a, b))
    else:
        shutil.copytree(SRC, d + '/packages/sdk-java', ignore=shutil.ignore_patterns('target'))
    os.symlink('/root/verify/pr12522/packages/cli', d + '/packages/cli')
    env = dict(os.environ, JAVA_HOME='/root/Install/jdk21', PATH='/root/Install/jdk21/bin:/root/Install/maven/bin:' + os.environ['PATH'])
    r = subprocess.run(['mvn', '-o', '-q', '-B', '-Djacoco.skip=true', 'test', '-Dtest=HttpRuntimeTransportTest,ManagedRuntimeAttestationConformanceTest'],
                       cwd=d + '/packages/sdk-java/runtime-broker', env=env, capture_output=True, text=True, timeout=600)
    out = r.stdout + r.stderr
    killed = bool(re.search(r'Tests run:.*(Failures: [1-9]|Errors: [1-9])', out))
    comp = 'COMPILATION ERROR' in out
    fails = sorted(set(re.findall(r'HttpRuntimeTransportTest\.(\w+)', out)))
    return mid, desc, ('COMPILE' if comp else ('KILLED' if killed else ('SURVIVED' if r.returncode == 0 else 'ERR'))), fails
with cf.ThreadPoolExecutor(6) as ex:
    res = list(ex.map(run, [('M00','control','','')] + M))
for mid, desc, st, fails in res:
    print(f'{mid} {st:8} {desc:40} {",".join(fails)[:120]}')
k = sum(1 for r in res[1:] if r[2]=='KILLED'); print(f'killed {k}/{len(res)-1}')
