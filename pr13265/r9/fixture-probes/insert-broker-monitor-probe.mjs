// PR #13265 round 6 — J3: the exact payload the hosted turn sends for a
// Monitor call (captured from the PR's own monitor rig), handed to the real
// RuntimeBrokerService v3 start through the PR's own Fixture. A Shell
// payload runs alongside as the control.
import fs from 'node:fs';

const file = process.argv[2];
let src = fs.readFileSync(file, 'utf8');
const anchor = '    private static final class Fixture implements AutoCloseable {';
if (src.split(anchor).length !== 2) throw new Error('anchor not unique');
const body = (name, payloadJava) => `
    @Test
    void ${name}() throws Exception {
        String payload = ${payloadJava};
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
            String outcome;
            try {
                ToolExecutionRecord prepared = join(fixture.service.prepareExecution(
                        "harness", "runtime", "key", reference, digest, "pub-1"));
                join(fixture.service.startExecution("harness", "runtime",
                        prepared.getExecutionCallId(), payload, "pub-1", "token"));
                outcome = "started; executeV3 calls " + fixture.transport.executeV3Calls.get();
            } catch (RuntimeException error) {
                Throwable cause = error;
                while (cause.getCause() != null && !(cause instanceof RuntimeBrokerException)) {
                    cause = cause.getCause();
                }
                outcome = cause instanceof RuntimeBrokerException broker
                        ? broker.getStatusCode() + " " + broker.getCode() + ": " + broker.getMessage()
                        : cause.toString();
            }
            System.out.println("[R6-J3] ${name}: " + outcome);
        }
    }
`;
const monitorPayload = '"{\\"toolName\\":\\"monitor\\",\\"input\\":{\\"command\\":\\"tail -f build.log\\",\\"is_monitor\\":true}}"';
const shellPayload = '"{\\"toolName\\":\\"run_shell_command\\",\\"input\\":{\\"command\\":\\"pwd\\",\\"is_background\\":true}}"';
src = src.replace(anchor, () => body('r6MonitorPayloadAtTheV3Gate', monitorPayload) + body('r6ShellPayloadAtTheV3Gate', shellPayload) + '\n' + anchor);
fs.writeFileSync(file, src);
console.log('inserted J3');
