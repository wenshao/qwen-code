// Verification-only probe hook for HostedWorkspaceToolTurnIT (never pushed).
const fs = require('fs');
const F = process.argv[2];
let s = fs.readFileSync(F, 'utf8');
const rep = (a, b) => {
  if (!s.includes(a)) throw new Error('missing: ' + a.slice(0, 90));
  s = s.replace(a, b);
};
rep(`        if (selected != null) {
            assertThat(cases).contains(selected);
            cases = List.of(selected);
        }
        runDriver(cases, "store-failure");
        for (String fault : cases) {
            if (!fault.endsWith("-reply")) assertThat(output).contains("java.sql.SQLException: FG6B_" + fault);`,
`        List<String> standard = cases;
        if (selected != null) {
            // verification probe: comma-separated cases, probe names allowed with -Dqwen.fg6b.driver
            if (System.getProperty("qwen.fg6b.driver") == null) assertThat(cases).contains(selected);
            cases = List.of(selected.split(","));
        }
        runDriver(cases, "store-failure");
        for (String fault : cases) {
            System.out.println("PROBE_SQL_MARKER " + fault + " " + output.toString().contains("java.sql.SQLException: FG6B_" + fault));
            if (!standard.contains(fault)) continue;
            if (!fault.endsWith("-reply")) assertThat(output).contains("java.sql.SQLException: FG6B_" + fault);`);
rep(`"integration-tests/helpers/hosted-" + driverName + "-driver.ts"`,
  `"integration-tests/helpers/" + (storeFaults && System.getProperty("qwen.fg6b.driver") != null ? System.getProperty("qwen.fg6b.driver") : "hosted-" + driverName + "-driver") + ".ts"`);
rep(`        String fault = session.get("fault").toString();
        String table = fault.equals("arguments")`,
`        String fault = session.get("fault").toString().replaceFirst("^batch-", "");
        String table = fault.equals("arguments")`);
rep(`SET MESSAGE_TEXT = 'FG6B_"
                + fault + "'; END IF; END");`,
`SET MESSAGE_TEXT = 'FG6B_"
                + session.get("fault") + "'; END IF; END");`);
rep(`            JsonNode report, boolean storeFaults) throws Exception {
        String fault = session.get("fault").toString();`,
`            JsonNode report, boolean storeFaults) throws Exception {
        String fault = session.get("fault").toString();
        if (storeFaults) printProbeLedger(jdbc, tenant, session, index, report);
        if (storeFaults && !List.of("arguments", "intent", "await-runtime", "result-message", "result-checkpoint",
                "result-reply", "turn-reply").contains(fault)) return;`);
rep(`    private void createStoreFaultTrigger(`,
`    private void printProbeLedger(JdbcTemplate jdbc, String tenant, Map<String, Object> session, int index,
            JsonNode report) throws Exception {
        String sessionId = session.get("sessionId").toString();
        String fault = session.get("fault").toString();
        var executions = jdbc.queryForList("SELECT tool_call_id, dispatch_generation, execution_state, execution_status"
                + " FROM qwen_tool_execution WHERE harness_session_id = ? ORDER BY tool_call_id", sessionId);
        String storageKey = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest((tenant + "\\u0000storage-" + index).getBytes(StandardCharsets.UTF_8)));
        Object holder = jdbc.queryForMap("SELECT holder_key FROM managed_workspace_execution_lease WHERE storage_key = ?",
                storageKey).get("holder_key");
        List<String> journal = new ArrayList<>();
        ObjectMapper mapper = new ObjectMapper();
        for (Map<String, Object> tx : jdbc.queryForList("SELECT journal_revision, operation, record_bytes,"
                + " latest_checkpoint_resource_id FROM qwen_managed_session_journal_tx WHERE tenant_id = ? AND session_id = ?"
                + " ORDER BY journal_revision", tenant, sessionId)) {
            List<String> kinds = new ArrayList<>();
            for (String line : new String((byte[]) tx.get("record_bytes"), StandardCharsets.UTF_8).lines().toList()) {
                JsonNode record = mapper.readTree(line);
                if (!record.path("subtype").asText().equals("managed_session_event_v1")) continue;
                JsonNode event = record.path("managedSession");
                kinds.add(event.path("kind").asText().equals("message.committed")
                        ? "message:" + event.path("payload").path("role").asText() : event.path("kind").asText());
            }
            String phase = "";
            if (tx.get("latest_checkpoint_resource_id") != null) {
                byte[] checkpoint = jdbc.queryForObject("SELECT inline_bytes FROM qwen_managed_session_resource"
                        + " WHERE tenant_id = ? AND session_id = ? AND resource_id = ?", byte[].class, tenant, sessionId,
                        tx.get("latest_checkpoint_resource_id"));
                phase = " phase=" + mapper.readTree(checkpoint).path("continuation").path("phase").asText();
            }
            journal.add(tx.get("journal_revision") + ":" + tx.get("operation") + kinds + phase);
        }
        Integer resources = jdbc.queryForObject("SELECT COUNT(*) FROM qwen_managed_session_resource WHERE tenant_id = ?"
                + " AND session_id = ?", Integer.class, tenant, sessionId);
        Integer triggers = jdbc.queryForObject("SELECT COUNT(*) FROM information_schema.TRIGGERS"
                + " WHERE TRIGGER_NAME LIKE 'fg6b%'", Integer.class);
        System.out.println("PROBE_LEDGER " + mapper.writeValueAsString(Map.of("fault", fault, "executions", executions,
                "ownerHeld", holder != null, "journal", journal, "resources", resources, "liveTriggers", triggers)));
    }

    private void createStoreFaultTrigger(`);
fs.writeFileSync(F, s);
console.log('patched');
