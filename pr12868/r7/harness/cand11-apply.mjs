// Candidate B of round 7, for head 9cb9dc86e8: a provider execution the worker
// reports as prepared was never started and will not be dispatched again, so
// the Broker keeps the answer it gave before (409 runtime_broker_execution_unknown)
// instead of 200 prepared, which the provider client polls for ever.
// usage: node cand11-apply.mjs <worktree>
import fs from 'node:fs';
import path from 'node:path';
const WT = process.argv[2];
const B = 'packages/sdk-java/runtime-broker/src';
const edit = (file, find, replace) => {
  const f = path.join(WT, file);
  const s = fs.readFileSync(f, 'utf8');
  if (s.split(find).length !== 2) throw new Error(`anchor in ${file} matched ${s.split(find).length - 1} times`);
  fs.writeFileSync(f, s.replace(find, () => replace));
};
edit(`${B}/main/java/com/alibaba/qwen/code/runtimebroker/RuntimeBrokerHttpServer.java`,
`        String state = observation.getRuntimeState();
        if (record.getState() == ToolExecutionRecord.State.UNKNOWN
                && ("prepared".equals(state) || "executing".equals(state)
                    || "cancel_requested".equals(state))) {`,
`        String state = observation.getRuntimeState();
        // A provider call the worker still holds as prepared was never
        // started, and nothing dispatches it a second time: it stays UNKNOWN
        // for the caller, who would otherwise wait for it for ever.
        boolean neverStarted = "prepared".equals(state)
                && ProviderRuntimeProtocol.isReference(record.getReference());
        if (record.getState() == ToolExecutionRecord.State.UNKNOWN && !neverStarted
                && ("prepared".equals(state) || "executing".equals(state)
                    || "cancel_requested".equals(state))) {`);
edit(`${B}/test/java/com/alibaba/qwen/code/runtimebroker/RuntimeBrokerHttpServerTest.java`,
`    @Test
    void providerObservesTheOriginalExecutionAfterResponseLoss() throws Exception {`,
`    @Test
    void providerStartTheWorkerNeverBeganStaysUnknownForTheCaller() throws Exception {
        String runtime = "550e8400-e29b-41d4-a716-446655440303";
        try (Fixture fixture = new Fixture()) {
            fixture.service.acquire("harness", runtime, "bootstrap").toCompletableFuture().join();
            Map<String, Object> reference = Map.of("sessionId", runtime, "promptId", "turn",
                    "callId", "worker-call", "capabilityDigest", "a".repeat(64),
                    "policyRevision", "policy", "invocationId", "invocation", "argsDigest", "b".repeat(64));
            String id = fixture.service.prepareExecution("harness", runtime, "provider", reference)
                    .toCompletableFuture().join().getExecutionCallId();
            Map<String, Object> start = Map.of("protocolVersion", 1, "requestId", "start",
                    "harnessSessionId", "harness", "runtimeSessionId", runtime);
            // The worker refused the execute: it still holds the call as prepared.
            fixture.transport.runtimeStatus = Map.of("state", "prepared");
            for (int attempt = 0; attempt < 2; attempt++) {
                HttpResponse<String> started = fixture.post("/executions/" + id + ":start", start);
                assertEquals(409, started.statusCode(), started.body());
                assertEquals("runtime_broker_execution_unknown",
                        JSON.parseObject(started.body()).getString("code"));
            }
            HttpRequest read = HttpRequest.newBuilder(fixture.uri("/executions/" + id
                    + "?requestId=read&harnessSessionId=harness&runtimeSessionId=" + runtime))
                    .header("Authorization", "Bearer secret").GET().build();
            assertEquals(409, fixture.client.send(read, HttpResponse.BodyHandlers.ofString()).statusCode());
            assertEquals(1, fixture.transport.executions.get());
        }
    }

    @Test
    void providerObservesTheOriginalExecutionAfterResponseLoss() throws Exception {`);
console.log('applied');
