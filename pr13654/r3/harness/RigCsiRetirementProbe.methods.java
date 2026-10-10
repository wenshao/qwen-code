    // ---- rig probes (PR #13654 round 4): CSI retirement x async verification ----
    private void retire() {
        var registration = new WorkspaceCsiRegistration("tenant-1", "fixture-storage", "fixture-cluster",
                "fixture", "fixture-claim", "fixture-pvc", "fixture-volume", "fixture-pv",
                "fixture.csi", "fixture-handle", "fixture-backend", "fixture-serial", "/workspace", 1);
        new WorkspaceCsiReservationStore(fixture.jdbc, fixture.manager, JSON).beginRetirement(
                registration, fixture.bindings, fixture.bindings.findById("binding-1"),
                fixture.csiReservation, UUID.randomUUID().toString());
    }

    private void settle() {
        var execution = fixture.executions.findByExecutionCallId("execution-1");
        assertThat(fixture.executions.compareAndSet(execution, execution.withResult(
                java.util.Map.of("executionStatus", "success"), execution.getLastSequence(), Instant.now()),
                "dispatcher", execution.getDispatchGeneration())).isNotNull();
    }

    private String describe(String operation) {
        JsonNode s;
        try {
            s = status(operation);
        } catch (RuntimeException error) {
            s = JSON.createObjectNode().put("state", "<" + refusal(error) + ">");
        }
        String objects = String.join(",", fixture.jdbc.queryForList(
                "SELECT CONCAT(slot_key, '=', state) FROM qwen_tool_publication_object ORDER BY slot_key", String.class));
        var pub = fixture.jdbc.queryForMap("SELECT producer_phase, active_operation_id FROM qwen_tool_publication");
        var exec = fixture.executions.findByExecutionCallId("execution-1");
        long retirements = fixture.jdbc.queryForObject("SELECT COUNT(*) FROM managed_workspace_csi_retirement", Long.class);
        return "op=" + operation + " state=" + s.path("state").asText()
                + (s.has("error") ? " error=" + s.path("error").path("status").asText() + "/" + s.path("error").path("code").asText() : "")
                + " readbacks=" + bucket.opens.get() + " objects=[" + objects + "] producer_phase=" + pub.get("producer_phase")
                + " active_op=" + pub.get("active_operation_id") + " execution=" + exec.getState() + " retirement_rows=" + retirements;
    }

    private static String refusal(RuntimeException error) {
        return error instanceof ApiException api ? "refused " + api.getStatus().value() + "/" + api.getCode()
                : "refused " + error.getClass().getSimpleName() + ": " + error.getMessage();
    }

    private void record(String probe, String line) {
        String out = System.getProperty("probe.out");
        String db = getClass().getSimpleName().endsWith("MySqlIT") ? "mysql" : "h2";
        String text = "PROBE " + System.getProperty("probe.arm", "?") + " " + db + " " + probe + " :: " + line + "\n";
        System.out.print(text);
        if (out != null) {
            try {
                java.nio.file.Files.writeString(java.nio.file.Path.of(out), text,
                        java.nio.file.StandardOpenOption.CREATE, java.nio.file.StandardOpenOption.APPEND);
            } catch (java.io.IOException error) {
                throw new IllegalStateException(error);
            }
        }
    }

    @Test
    void probeA_segmentAcceptedThenRetiredThenSettled() {
        acceptCsiOperation();
        retire();
        settle();
        data.verifyNextOperation();
        record("A segment accepted -> retirement -> execution SETTLED -> scan", describe("csi"));
    }

    @Test
    void probeB_segmentAcceptedThenRetiredStillExecuting() {
        acceptCsiOperation();
        retire();
        data.verifyNextOperation();
        record("B segment accepted -> retirement -> execution still EXECUTING -> scan (control)", describe("csi"));
    }

    @Test
    void probeC_newSegmentAfterRetirementAndSettle() {
        acceptCsiOperation();
        data.verifyNextOperation();
        retire();
        settle();
        String outcome;
        try {
            outcome = "admitted state=" + publish("csi-new", 1, "more").path("state").asText();
        } catch (RuntimeException error) {
            outcome = refusal(error);
        }
        record("C new segment POST after retirement + SETTLED (must stay refused)", outcome + " | " + describe("csi"));
    }

    @Test
    void probeD_settledWithoutRetirement() {
        acceptCsiOperation();
        settle();
        data.verifyNextOperation();
        record("D segment accepted -> execution SETTLED, no retirement -> scan", describe("csi"));
    }

    @Test
    void probeE_finishAcceptedThenRetiredThenSettled() {
        acceptCsiOperation();
        data.verifyNextOperation();
        JsonNode accepted = data.finish(key, "pub-1", PUBLICATION_TOKEN, "fin", terminal(10), true);
        retire();
        settle();
        data.verifyNextOperation();
        record("E finish accepted (" + accepted.path("state").asText() + ") -> retirement -> SETTLED -> scan", describe("fin"));
    }

    @Test
    void probeF_syncSegmentThenRetiredThenSettledFinishSync() {
        // Sync control for E: the same order, but the client never sent the async header.
        acceptCsiOperation();
        data.verifyNextOperation();
        retire();
        String outcome;
        try {
            JsonNode fin = data.finish(key, "pub-1", PUBLICATION_TOKEN, "fin", terminal(10), false);
            outcome = "sync finish while EXECUTING after retirement -> " + fin.path("state").asText(fin.toString());
        } catch (RuntimeException error) {
            outcome = refusal(error);
        }
        record("F sync finish after retirement (execution still EXECUTING)", outcome + " | " + describe("fin"));
    }

    private String syncReason(java.util.function.Supplier<JsonNode> call) {
        try {
            return "same call made synchronously -> " + call.get().path("state").asText("200");
        } catch (RuntimeException error) {
            return "same call made synchronously -> " + refusal(error);
        }
    }

    @Test
    void probeE2_finishAcceptedThenRetiredStillExecuting() {
        acceptCsiOperation();
        data.verifyNextOperation();
        JsonNode accepted = data.finish(key, "pub-1", PUBLICATION_TOKEN, "fin", terminal(10), true);
        retire();
        data.verifyNextOperation();
        record("E2 finish accepted (" + accepted.path("state").asText() + ") -> retirement -> still EXECUTING -> scan (control)", describe("fin"));
    }

    @Test
    void probeE3_finishAcceptedThenRetiredThenSettledReason() {
        acceptCsiOperation();
        data.verifyNextOperation();
        data.finish(key, "pub-1", PUBLICATION_TOKEN, "fin", terminal(10), true);
        retire();
        settle();
        record("E3 finish accepted -> retirement -> SETTLED, before the scan",
                syncReason(() -> data.finish(key, "pub-1", PUBLICATION_TOKEN, "fin-sync", terminal(10), false)));
    }

    @Test
    void probeG_sealAcceptedThenRetiredThenSettled() {
        acceptCsiOperation();
        data.verifyNextOperation();
        byte[] stored = "stored".getBytes(StandardCharsets.UTF_8);
        JsonNode accepted = data.seal(key, "pub-1", PUBLICATION_TOKEN, "seal", "stdout", 1, stored.length,
                ToolPublicationContract.sha256(stored), true);
        retire();
        settle();
        data.verifyNextOperation();
        record("G seal accepted (" + accepted.path("state").asText() + ") -> retirement -> SETTLED -> scan", describe("seal"));
    }

    @Test
    void probeH_prefixAcceptedThenRetiredThenSettled() {
        acceptCsiOperation();
        data.verifyNextOperation();
        JsonNode accepted = data.prefix(key, "pub-1", PUBLICATION_TOKEN, "prefix", "stdout", true);
        retire();
        settle();
        data.verifyNextOperation();
        record("H prefix accepted (" + accepted.path("state").asText() + ") -> retirement -> SETTLED -> scan", describe("prefix"));
    }

    @Test
    void probeI_wholeSequenceAfterRetirementAndSettle() {
        // Segment + seal + finish all accepted before the execution settles, then drained.
        acceptCsiOperation();
        data.verifyNextOperation();
        byte[] stored = "stored".getBytes(StandardCharsets.UTF_8);
        data.seal(key, "pub-1", PUBLICATION_TOKEN, "seal", "stdout", 1, stored.length,
                ToolPublicationContract.sha256(stored), true);
        data.verifyNextOperation();
        data.finish(key, "pub-1", PUBLICATION_TOKEN, "fin", terminal(10), true);
        retire();
        settle();
        data.verifyNextOperation();
        String finished;
        try {
            finished = "finished() terminal=" + data.finished(key, "pub-1", WRITER_TOKEN).path("terminal").path("digest").asText().substring(0, 12);
        } catch (RuntimeException error) {
            finished = "finished() " + refusal(error);
        }
        record("I segment+seal verified, finish accepted -> retirement -> SETTLED -> scan", describe("fin") + " | " + finished);
    }

