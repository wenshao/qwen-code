// PR #13265 round 5 — inserts two probe tests into a local copy of
// RuntimeBrokerServiceTest (never committed). They reuse the class's own
// Fixture and FakeTransport, so they drive exactly what the PR's witnesses do.
//   J1: the background Shell is still running → what does release answer, and
//       does the Broker ever call the worker's release (where 7b63430602's
//       drain lives)?
//   J2: the Broker restarts (a new RuntimeBrokerService over the same
//       repositories) and the worker answers `exited` the way the real route
//       does → does release's sweep find the earlier :process row?
import fs from 'node:fs';

const file = process.argv[2];
let src = fs.readFileSync(file, 'utf8');
const anchor = '    private static final class Fixture implements AutoCloseable {';
if (src.split(anchor).length !== 2) throw new Error('anchor not unique');

const setup = `
        String payload = "{\\"toolName\\":\\"run_shell_command\\",\\"input\\":{\\"command\\":\\"pwd\\",\\"is_background\\":true}}";
        String digest = "sha256:" + HexFormat.of().formatHex(
                MessageDigest.getInstance("SHA-256").digest(payload.getBytes(StandardCharsets.UTF_8)));
        Map<String, Object> detachedCapture = new LinkedHashMap<>();
        detachedCapture.put("captureStatus", "detached");
        detachedCapture.put("captureReason", null);
        detachedCapture.put("manifest", null);
        detachedCapture.put("previewTruncated", false);
        detachedCapture.put("deliveryStatus", "pending");
        Map<String, Object> detachedResult = new LinkedHashMap<>();
        detachedResult.put("executionStatus", "success");
        detachedResult.put("responseParts", java.util.List.of(Map.of("text", "started")));
        detachedResult.put("capture", detachedCapture);
        RuntimePublicationVerifier verifier = new RuntimePublicationVerifier() {
            @Override
            public RuntimePublicationGrant verify(ToolExecutionRecord execution,
                    String publicationId, String token) {
                return new RuntimePublicationGrant(publicationId, token, "https://publisher.test",
                        Map.of("sessionKey", Map.of("tenantId", "tenant", "sessionId", "managed"),
                                "turnId", "prompt", "executionCallId", execution.getExecutionCallId(),
                                "bindingGeneration", "1"));
            }
        };`;
const start = `
            join(fixture.service.acquire("harness", "runtime", "bootstrap"));
            Map<String, Object> reference = Map.of("sessionId", "runtime", "promptId", "prompt",
                    "callId", "call", "argsDigest", "sha256:" + "a".repeat(64));
            fixture.transport.executeV3Result = CompletableFuture.completedFuture(
                    Map.of("state", "prepared"));
            fixture.transport.statusResult = CompletableFuture.completedFuture(
                    Map.of("state", "settled", "result", detachedResult));
            ToolExecutionRecord prepared = join(fixture.service.prepareExecution(
                    "harness", "runtime", "key", reference, digest, "pub-1"));
            join(fixture.service.startExecution("harness", "runtime",
                    prepared.getExecutionCallId(), payload, "pub-1", "token"));
            awaitExecution(fixture.executionRepository, prepared.getExecutionCallId() + ":process",
                    ToolExecutionRecord.State.PREPARED);`;

const probes = `    private static String r5Outcome(java.util.function.Supplier<CompletionStage<?>> call) {
        try {
            return "ok:" + join(call.get());
        } catch (RuntimeException error) {
            Throwable cause = error;
            while (cause.getCause() != null && !(cause instanceof RuntimeBrokerException)) {
                cause = cause.getCause();
            }
            return cause instanceof RuntimeBrokerException broker
                    ? broker.getCode() : cause.getClass().getSimpleName() + ":" + cause.getMessage();
        }
    }

    @Test
    void r5ProbeLiveShellReleaseNeverReachesTheWorker() throws Exception {${setup}
        try (Fixture fixture = new Fixture(WORKSPACE_SCOPE, verifier)) {${start}
            // What the worker route answers while the unit is registered.
            fixture.transport.controlResult = CompletableFuture.completedFuture(
                    Map.of("operationId", "call", "state", "running", "unitName", "qwen-bg-call"));
            int releasesBefore = fixture.transport.releaseCalls.get();
            String outcome = r5Outcome(() -> fixture.service.release("harness", "runtime"));
            System.out.println("[R5-J1] {\\"release\\":\\"" + outcome
                    + "\\",\\"sweepAsked\\":\\"" + fixture.transport.lastControl.get("kind")
                    + "\\",\\"workerReleaseCalls\\":" + (fixture.transport.releaseCalls.get() - releasesBefore)
                    + ",\\"processRow\\":\\"" + fixture.executionRepository.findByExecutionCallId(
                            prepared.getExecutionCallId() + ":process").getState() + "\\"}");
        }
    }

    @Test
    void r5ProbeRestartedBrokerNeverSweepsAnEarlierProcessRow() throws Exception {${setup}
        try (Fixture fixture = new Fixture(WORKSPACE_SCOPE, verifier)) {${start}
            String processId = prepared.getExecutionCallId() + ":process";
            // The Shell ends on its own; the real route answers under the
            // target identity (the callId) with the retained evidence.
            Map<String, Object> exited = new LinkedHashMap<>();
            exited.put("operationId", "call");
            exited.put("state", "exited");
            exited.put("unitName", "qwen-bg-call");
            exited.put("evidence", Map.of("exitCode", 0));
            fixture.transport.controlResult = CompletableFuture.completedFuture(exited);
            fixture.service.close();
            RuntimeBrokerService restarted = new RuntimeBrokerService(fixture.resolver,
                    fixture.provisioner, fixture.transport, fixture.bindingRepository,
                    fixture.sessionRepository, fixture.executionRepository, "broker",
                    Duration.ofMinutes(1), Duration.ofMinutes(1), verifier);
            try {
                String releaseBeforeAcquire = r5Outcome(() -> restarted.release("harness", "runtime"));
                fixture.transport.lastControl = null;
                String reacquire = r5Outcome(() -> restarted.acquire("harness", "runtime", "bootstrap"));
                String releaseAfterAcquire = r5Outcome(() -> restarted.release("harness", "runtime"));
                Object askedAfterAcquire = fixture.transport.lastControl == null
                        ? "nothing" : fixture.transport.lastControl.get("kind");
                String rowAfter = String.valueOf(fixture.executionRepository
                        .findByExecutionCallId(processId).getState());
                String observe = r5Outcome(() -> restarted.observeBackgroundProcess(
                        "harness", "runtime", prepared.getExecutionCallId())
                        .thenApply(ToolExecutionRecord::getState));
                String releaseAfterObserve = r5Outcome(() -> restarted.release("harness", "runtime"));
                System.out.println("[R5-J2] {\\"releaseBeforeReacquire\\":\\"" + releaseBeforeAcquire
                        + "\\",\\"reacquire\\":\\"" + reacquire
                        + "\\",\\"releaseAfterReacquire\\":\\"" + releaseAfterAcquire
                        + "\\",\\"sweepAsked\\":\\"" + askedAfterAcquire
                        + "\\",\\"processRow\\":\\"" + rowAfter
                        + "\\",\\"explicitObserve\\":\\"" + observe
                        + "\\",\\"releaseAfterObserve\\":\\"" + releaseAfterObserve + "\\"}");
            } finally {
                restarted.close();
            }
        }
    }

`;
src = src.replace(anchor, () => probes + anchor);
for (const imp of ['import java.time.Duration;']) {
  if (!src.includes(imp)) throw new Error(`missing ${imp}`);
}
fs.writeFileSync(file, src);
console.log('inserted 2 probes');
