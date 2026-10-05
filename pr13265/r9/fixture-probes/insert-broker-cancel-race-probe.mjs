// PR #13265 round 9 — J6: the cancel lands while startExecution is mid-way —
// after it read the record (still PREPARED) and before it admits the
// :process row. The probe's publication verifier parks on a latch to open
// that window deterministically; the cancel runs while it is parked.
// The PR's own RuntimeBrokerServiceTest Fixture, local copy only.
import fs from 'node:fs';

const file = process.argv[2];
let src = fs.readFileSync(file, 'utf8');
const anchor = '    private static final class Fixture implements AutoCloseable {';
if (src.split(anchor).length !== 2) throw new Error('anchor not unique');
const probe = `
    @Test
    void r9ProbeCancelWhileStartIsInFlight() throws Exception {
        String payload = "{\\"toolName\\":\\"run_shell_command\\",\\"input\\":{\\"command\\":\\"pwd\\",\\"is_background\\":true}}";
        String digest = "sha256:" + HexFormat.of().formatHex(
                MessageDigest.getInstance("SHA-256").digest(payload.getBytes(StandardCharsets.UTF_8)));
        java.util.concurrent.CountDownLatch entered = new java.util.concurrent.CountDownLatch(1);
        java.util.concurrent.CountDownLatch proceed = new java.util.concurrent.CountDownLatch(1);
        RuntimePublicationVerifier verifier = new RuntimePublicationVerifier() {
            @Override
            public RuntimePublicationGrant verify(ToolExecutionRecord execution,
                    String publicationId, String token) {
                entered.countDown();
                try {
                    proceed.await(10, java.util.concurrent.TimeUnit.SECONDS);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
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
            ToolExecutionRecord prepared = join(fixture.service.prepareExecution(
                    "harness", "runtime", "key", reference, digest, "pub-1"));
            CompletableFuture<String> start = CompletableFuture.supplyAsync(() -> r9Outcome(() ->
                    fixture.service.startExecution("harness", "runtime",
                            prepared.getExecutionCallId(), payload, "pub-1", "token")));
            boolean parked = entered.await(5, java.util.concurrent.TimeUnit.SECONDS);
            String cancel = r9Outcome(() -> fixture.service.cancelExecution("harness", "runtime", prepared.getExecutionCallId()));
            proceed.countDown();
            String started = start.get(10, java.util.concurrent.TimeUnit.SECONDS);
            Thread.sleep(300);
            fixture.transport.controlResult = CompletableFuture.completedFuture(
                    Map.of("operationId", "call", "state", "unknown"));
            java.util.List<String> releases = new java.util.ArrayList<>();
            for (int i = 0; i < 3; i++) releases.add(r9Outcome(() -> fixture.service.release("harness", "runtime")));
            ToolExecutionRecord invocation = fixture.executionRepository.findByExecutionCallId(prepared.getExecutionCallId());
            ToolExecutionRecord process = fixture.executionRepository.findByExecutionCallId(prepared.getExecutionCallId() + ":process");
            System.out.println("[R9-J6] {\\"verifierParked\\":" + parked + ",\\"cancelWhileParked\\":\\"" + cancel
                    + "\\",\\"start\\":\\"" + started
                    + "\\",\\"invocation\\":\\"" + invocation.getState() + "/" + invocation.getExecutionStatus()
                    + "\\",\\"processRow\\":\\"" + (process == null ? "none" : process.getState())
                    + "\\",\\"releases\\":\\"" + String.join(",", releases)
                    + "\\",\\"executeV3Calls\\":" + fixture.transport.executeV3Calls.get() + "}");
        }
    }

`;
src = src.replace(anchor, () => probe + anchor);
fs.writeFileSync(file, src);
console.log('inserted J6');
