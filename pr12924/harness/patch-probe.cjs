const fs = require('fs');
const D = process.argv[2] + '/packages/sdk-java/managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent/';
function edit(file, pairs) {
  let s = fs.readFileSync(D + file, 'utf8');
  for (const [a, b] of pairs) {
    const n = s.split(a).length - 1;
    if (n !== 1) throw new Error(`${file}: ${n} matches for ${a.slice(0, 60)}`);
    s = s.replace(a, b);
  }
  fs.writeFileSync(D + file, s);
}
edit('HostedWorkspaceToolTurnIT.java', [
  [`        if (selected != null) {
            assertThat(cases).contains(selected);
            cases = List.of(selected);
        }
        runDriver(cases, "cancellation");`,
   `        String probeDriver = System.getProperty("qwen.fg6d.driver", "cancellation");
        if (selected != null) {
            if (probeDriver.equals("cancellation")) assertThat(cases).contains(selected);
            cases = List.of(selected.split(","));
        }
        runDriver(cases, probeDriver);`],
  [`boolean cancellations = driverName.equals("cancellation");`, `boolean cancellations = driverName.startsWith("cancellation");`],
  [`                        if (cancellations) cancellationProbe.assertReport(sessions.get(index), reports.get(index));`,
   `                        if (cancellations && !driverName.equals("cancellation")) cancellationProbe.dump(sessions.get(index));
                        else if (cancellations) cancellationProbe.assertReport(sessions.get(index), reports.get(index));`],
]);
edit('HostedCancellationProbe.java', [
  [`    private void assertJournal(`,
   `    void dump(Map<String, Object> session) throws Exception {
        String id = session.get("sessionId").toString();
        var rows = jdbc.queryForList("SELECT execution_call_id, execution_state, execution_status, dispatch_generation"
                + " FROM qwen_tool_execution WHERE harness_session_id = ?", id);
        var executions = new ArrayList<Map<String, Object>>();
        for (var row : rows) {
            String call = row.get("execution_call_id").toString();
            var copy = new java.util.LinkedHashMap<String, Object>();
            copy.put("id", call.substring(0, 8));
            copy.put("state", row.get("execution_state"));
            copy.put("status", row.get("execution_status"));
            copy.put("dispatchGeneration", row.get("dispatch_generation"));
            executions.add(copy);
        }
        var owner = owner(session);
        var runtime = jdbc.queryForList("SELECT session_state FROM qwen_runtime_session WHERE harness_session_id = ?",
                String.class, id);
        var journal = jdbc.queryForList("SELECT record_bytes FROM qwen_managed_session_journal_tx"
                + " WHERE tenant_id = ? AND session_id = ? ORDER BY journal_revision", byte[].class, tenant, id);
        var kinds = new java.util.TreeMap<String, Integer>();
        String outcome = null;
        int toolResults = 0;
        for (byte[] bytes : journal) {
            for (String line : new String(bytes, StandardCharsets.UTF_8).lines().toList()) {
                JsonNode record = JSON.readTree(line);
                if (!record.path("subtype").asText().equals("managed_session_event_v1")) continue;
                JsonNode event = record.path("managedSession");
                kinds.merge(event.path("kind").asText(), 1, Integer::sum);
                if (event.path("kind").asText().equals("turn.settled")) outcome = event.path("payload").path("outcome").asText();
                if (event.path("kind").asText().equals("message.committed")
                        && event.path("payload").path("role").asText().equals("tool_result")) toolResults++;
            }
        }
        var head = jdbc.queryForMap("SELECT * FROM qwen_managed_session_journal_head WHERE tenant_id = ? AND session_id = ?", tenant, id);
        byte[] checkpoint = jdbc.queryForObject("SELECT inline_bytes FROM qwen_managed_session_resource"
                + " WHERE tenant_id = ? AND session_id = ? AND resource_id = ?", byte[].class, tenant, id,
                head.get("latest_checkpoint_resource_id"));
        var out = new java.util.LinkedHashMap<String, Object>();
        out.put("executions", executions);
        out.put("runtimeCalls", Map.of("execute", count(this.executions, id), "complete", count(completions, id),
                "cancel", count(cancellations, id)));
        out.put("ownerHeld", owner.get("holder_key") != null);
        out.put("runtimeSession", runtime);
        out.put("turnSettled", outcome);
        out.put("toolResultMessages", toolResults);
        out.put("checkpointPhase", JSON.readTree(checkpoint).path("continuation").path("phase").asText());
        out.put("events", kinds);
        System.out.println("PROBE_LEDGER " + session.get("fault") + " " + JSON.writeValueAsString(out));
    }

    private void assertJournal(`],
]);
console.log('patched');
