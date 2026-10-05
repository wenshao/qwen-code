// PR #13265 round 9 — J5: a background v3 start whose cancel lands before
// dispatch. v3's cancellationBeforeDispatch is the not_started proof, and
// enterExecuting settles the invocation with it — does the :process row the
// start admitted ever settle? Two orders: cancel between prepare and start,
// and cancel while the start's publication install is still in flight.
// The PR's own RuntimeBrokerServiceTest Fixture, local copy only.
import fs from 'node:fs';

const file = process.argv[2];
let src = fs.readFileSync(file, 'utf8');
const anchor = '    private static final class Fixture implements AutoCloseable {';
if (src.split(anchor).length !== 2) throw new Error('anchor not unique');
const probe = `
    private static String r9Outcome(java.util.function.Supplier<CompletionStage<?>> call) {
        try {
            Object value = join(call.get());
            return "ok:" + (value instanceof ToolExecutionRecord r ? r.getState() + "/" + r.getExecutionStatus() : String.valueOf(value));
        } catch (RuntimeException error) {
            Throwable cause = error;
            while (cause.getCause() != null && !(cause instanceof RuntimeBrokerException)) cause = cause.getCause();
            return cause instanceof RuntimeBrokerException broker ? broker.getCode() : cause.getClass().getSimpleName();
        }
    }

    @Test
    void r9ProbeCancelBeforeBackgroundDispatch() throws Exception {
        String payload = "{\\"toolName\\":\\"run_shell_command\\",\\"input\\":{\\"command\\":\\"pwd\\",\\"is_background\\":true}}";
        String digest = "sha256:" + HexFormat.of().formatHex(
                MessageDigest.getInstance("SHA-256").digest(payload.getBytes(StandardCharsets.UTF_8)));
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
            ToolExecutionRecord prepared = join(fixture.service.prepareExecution(
                    "harness", "runtime", "key", reference, digest, "pub-1"));
            String cancel = r9Outcome(() -> fixture.service.cancelExecution("harness", "runtime", prepared.getExecutionCallId()));
            String start = r9Outcome(() -> fixture.service.startExecution("harness", "runtime",
                    prepared.getExecutionCallId(), payload, "pub-1", "token"));
            Thread.sleep(300);
            fixture.transport.controlResult = CompletableFuture.completedFuture(
                    Map.of("operationId", "call", "state", "unknown"));
            String release = r9Outcome(() -> fixture.service.release("harness", "runtime"));
            ToolExecutionRecord invocation = fixture.executionRepository.findByExecutionCallId(prepared.getExecutionCallId());
            ToolExecutionRecord process = fixture.executionRepository.findByExecutionCallId(prepared.getExecutionCallId() + ":process");
            System.out.println("[R9-J5] {\\"cancel\\":\\"" + cancel + "\\",\\"start\\":\\"" + start
                    + "\\",\\"invocation\\":\\"" + invocation.getState() + "/" + invocation.getExecutionStatus()
                    + "\\",\\"processRow\\":\\"" + (process == null ? "none" : process.getState())
                    + "\\",\\"release\\":\\"" + release + "\\",\\"executeV3Calls\\":" + fixture.transport.executeV3Calls.get() + "}");
        }
    }

`;
src = src.replace(anchor, () => probe + anchor);
fs.writeFileSync(file, src);
console.log('inserted J5');
