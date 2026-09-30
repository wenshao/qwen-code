import os, shutil, sys, json
SRC = '/root/verify/pr13115/head/packages/sdk-java/runtime-broker'
REL = 'src/main/java/com/alibaba/qwen/code/runtimebroker/RuntimeBrokerService.java'
OUT = '/root/verify/pr13115/mut'
orig = open(os.path.join(SRC, REL)).read()

# (id, description, old, new, occurrence index (1-based))
M = [
 ('m01', 'LOST branch: drop renewal.close()',
  '                            renewal.close();\n                            // The reclaim may span', '                            // The reclaim may span', 1),
 ('m02', 'LOST branch: drop rearmDeadline.run()',
  '                            rearmDeadline.run();\n', '', 1),
 ('m03', 'LOST branch: drop inline renew before evidence CAS',
  '                            latest = renewRecoveryClaim(latest);\n', '', 1),
 ('m04', 'cleanupLost: drop pre-reconcile renew',
  '                        renewRecoveryClaim(claimed);\n                        return provisioner.reconcile(', '                        return provisioner.reconcile(', 1),
 ('m05', 'cleanupLost: post-observation renew -> plain re-read',
  'RuntimeBindingRecord latest = renewRecoveryClaim(claimed);', 'RuntimeBindingRecord latest = bindingRepository.findById(claimed.getBindingId());', 1),
 ('m06', 'cleanupLost: renew but hand recoverResources the stale record',
  'provisioner.recoverResources(refreshed)', 'provisioner.recoverResources(terminalized)', 1),
 ('m07', 'cleanupLost: no renew before recoverResources',
  'RuntimeBindingRecord refreshed = renewRecoveryClaim(claimed);', 'RuntimeBindingRecord refreshed = terminalized;', 1),
 ('m08', 'cleanupLost: finishLostRecovery with plain re-read',
  'executionRepository, renewRecoveryClaim(claimed));', 'executionRepository, bindingRepository.findById(claimed.getBindingId()));', 1),
 ('m09', 'step bound back to a full lease',
  'return Math.max(1, operationLeaseDuration.toMillis()\n                - renewalDelayMillis(operationLeaseDuration));', 'return Math.max(1, operationLeaseDuration.toMillis());', 1),
 ('m10', 'step bound = half a lease (R1 shape)',
  'return Math.max(1, operationLeaseDuration.toMillis()\n                - renewalDelayMillis(operationLeaseDuration));', 'return Math.max(1, operationLeaseDuration.toMillis() / 2);', 1),
 ('m11', 'observation leg: timeout degrades to null (unnamed)',
  'if (unwrap(error) instanceof TimeoutException) {', 'if (false) {', 1),
 ('m12', 'mapStepTimeout: never names the timeout',
  'if (unwrap(error) instanceof TimeoutException) {', 'if (false) {', 2),
 ('m13', 'recoverBinding: drop inner step bound',
  'claimed.getResourceHandle(), claimed.getLease()))\n                    .toCompletableFuture().orTimeout(cleanupStepTimeoutMillis(), TimeUnit.MILLISECONDS)',
  'claimed.getResourceHandle(), claimed.getLease()))\n                    .toCompletableFuture()', 1),
 ('m14', 'recoverBinding: outer backstop back to one lease',
  'orTimeout(operationDeadlineMillis(), TimeUnit.MILLISECONDS)', 'orTimeout(operationLeaseDuration.toMillis(), TimeUnit.MILLISECONDS)', 1),
 ('m15', 'recoverBinding: post-observation renew -> plain re-read',
  'RuntimeBindingRecord current = renewRecoveryClaim(claimed);', 'RuntimeBindingRecord current = bindingRepository.findById(claimed.getBindingId());', 1),
 ('m16', 'BindingRenewal: drop per-instance stopped check',
  'if (stopped.get() || closed.get()) {', 'if (closed.get()) {', 1),
 ('m17', 'cleanupLost: drop observation-leg step bound',
  '.toCompletableFuture().orTimeout(cleanupStepTimeoutMillis(), TimeUnit.MILLISECONDS)\n                            .exceptionally(error -> {\n                                // A step cut short',
  '.toCompletableFuture()\n                            .exceptionally(error -> {\n                                // A step cut short', 1),
 ('m18', 'cleanupLost: drop recoverResources step bound',
  'provisioner.recoverResources(refreshed))\n                        .toCompletableFuture().orTimeout(cleanupStepTimeoutMillis(), TimeUnit.MILLISECONDS)',
  'provisioner.recoverResources(refreshed))\n                        .toCompletableFuture()', 1),
 ('m19', 'rearmDeadline: keep the old deadline armed',
  '                    scheduler.schedule(fence, operationDeadlineNanos(),\n                            TimeUnit.NANOSECONDS));\n            if (pending != null) {\n                pending.cancel(false);\n            }',
  '                    scheduler.schedule(fence, operationDeadlineNanos(),\n                            TimeUnit.NANOSECONDS));', 1),
 ('m20', 'renewRecoveryClaim re-reads + owner check exactly like pre-fix requireRecoveryClaim',
  'RuntimeBindingRecord renewed = bindingRepository.renewOperation(\n                claimed.getBindingId(), brokerOwnerId,\n                claimed.getOperationGeneration(), operationLeaseDuration);',
  'RuntimeBindingRecord renewed = bindingRepository.findById(claimed.getBindingId());\n        if (renewed != null && (renewed.getGeneration() != claimed.getGeneration() || !ownsOperation(renewed, claimed.getOperationGeneration()) || !renewed.isActive())) { renewed = null; }', 1),
]

def nth_replace(s, old, new, n):
    idx = -1
    for _ in range(n):
        idx = s.find(old, idx + 1)
        if idx < 0:
            raise SystemExit(f'occurrence {n} of {old!r} not found')
    return s[:idx] + new + s[idx + len(old):]

meta = {'m00': 'control (unmutated)'}
def copy(dst):
    if os.path.exists(dst): shutil.rmtree(dst)
    shutil.copytree(SRC, dst, ignore=shutil.ignore_patterns('target'))
copy(os.path.join(OUT, 'm00', 'runtime-broker'))
for mid, desc, old, new, n in M:
    mutated = nth_replace(orig, old, new, n)
    assert mutated != orig, mid
    d = os.path.join(OUT, mid, 'runtime-broker')
    copy(d)
    open(os.path.join(d, REL), 'w').write(mutated)
    meta[mid] = desc
json.dump(meta, open(os.path.join(OUT, 'mutants.json'), 'w'), indent=1)
print(len(meta), 'arms written')
