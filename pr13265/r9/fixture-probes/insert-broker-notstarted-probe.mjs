// PR #13265 round 7 — J4: a background v3 start that the worker answers as
// not_started (no cgroup, quota) — does the :process row ever leave PREPARED,
// and can the Session be released? The PR's own RuntimeBrokerServiceTest
// Fixture, local copy only.
import fs from 'node:fs';

const file = process.argv[2];
let src = fs.readFileSync(file, 'utf8');
const anchor = '    private static final class Fixture implements AutoCloseable {';
if (src.split(anchor).length !== 2) throw new Error('anchor not unique');
const probe = `
    @Test
    void r7ProbeNotStartedBackgroundLeavesItsProcessRow() throws Exception {
        String payload = "{\\"toolName\\":\\"run_shell_command\\",\\"input\\":{\\"command\\":\\"pwd\\",\\"is_background\\":true}}";
        String digest = "sha256:" + HexFormat.of().formatHex(
                MessageDigest.getInstance("SHA-256").digest(payload.getBytes(StandardCharsets.UTF_8)));
        Map<String, Object> notStarted = new LinkedHashMap<>();
        notStarted.put("executionStatus", "not_started");
        notStarted.put("responseParts", java.util.List.of());
        notStarted.put("capture", null);
        RuntimePublicationVerifier verifier = new RuntimePublicationVerifier() {
            @Override
            public RuntimePublicationGrant verify(ToolExecutionRecord execution,
                    String publicationId, String token) {
                return new RuntimePublicationGrant(publicationId, token, "https://publisher.test",
                        Map.of("sessionKey", Map.of("tenantId", "tenant", "sessionId", "managed"),
                                "turnId", "prompt", "executionCallId", execution.getExecutionCallId(),
                                "bindingGeneration", "1"));
            }
        };
        try (Fixture fixture = new Fixture(WORKSPACE_SCOPE, verifier)) {
            join(fixture.service.acquire("harness", "runtime", "bootstrap"));
            Map<String, Object> reference = Map.of("sessionId", "runtime", "promptId", "prompt",
                    "callId", "call", "argsDigest", "sha256:" + "a".repeat(64));
            fixture.transport.executeV3Result = CompletableFuture.completedFuture(Map.of("state", "prepared"));
            fixture.transport.statusResult = CompletableFuture.completedFuture(
                    Map.of("state", "settled", "result", notStarted));
            ToolExecutionRecord prepared = join(fixture.service.prepareExecution(
                    "harness", "runtime", "key", reference, digest, "pub-1"));
            join(fixture.service.startExecution("harness", "runtime",
                    prepared.getExecutionCallId(), payload, "pub-1", "token"));
            awaitExecution(fixture.executionRepository, prepared.getExecutionCallId(),
                    ToolExecutionRecord.State.SETTLED);
            // The worker never registered a process: its route answers unknown.
            fixture.transport.controlResult = CompletableFuture.completedFuture(
                    Map.of("operationId", "call", "state", "unknown"));
            java.util.List<String> releases = new java.util.ArrayList<>();
            for (int i = 0; i < 3; i++) {
                try {
                    releases.add(String.valueOf(join(fixture.service.release("harness", "runtime"))));
                } catch (RuntimeException error) {
                    Throwable cause = error;
                    while (cause.getCause() != null && !(cause instanceof RuntimeBrokerException)) cause = cause.getCause();
                    releases.add(cause instanceof RuntimeBrokerException broker ? broker.getCode() : cause.toString());
                }
            }
            ToolExecutionRecord invocation = fixture.executionRepository.findByExecutionCallId(prepared.getExecutionCallId());
            ToolExecutionRecord process = fixture.executionRepository.findByExecutionCallId(prepared.getExecutionCallId() + ":process");
            System.out.println("[R7-J4] {\\"invocation\\":\\"" + invocation.getState() + "/" + invocation.getExecutionStatus()
                    + "\\",\\"processRow\\":\\"" + (process == null ? "none" : process.getState())
                    + "\\",\\"releases\\":\\"" + String.join(",", releases)
                    + "\\",\\"workerReleaseCalls\\":" + fixture.transport.releaseCalls.get() + "}");
        }
    }

`;
src = src.replace(anchor, () => probe + anchor);
fs.writeFileSync(file, src);
console.log('inserted J4');
