import sys, subprocess, os
sys.path.insert(0, '/root/verify/pr13355/arms')
import driver
PROBE = '''
    @Test
    void probeSplitForPr13355() throws Exception {
        String sessionId = agents.createSession(TENANT, "probe-"
                + UUID.randomUUID(), "qwen-code", null, "tasks", Map.of(),
                List.of()).sessionId();
        String turnId = "turn-probe";
        state.appendPublicEventIfAbsent(TENANT, sessionId, turnId,
                "item.output_text.delta", Map.of("text", "one"), false,
                "delta-1");
        ExtensionRecordJournal journal = journal(sessionId);
        JsonNode revision = chain().get(0);
        journal.commitMonitor("split-0", revision.required("monitorRun"),
                revision.required("occurredAt").longValue());
        state.appendPublicEventIfAbsent(TENANT, sessionId, turnId,
                "item.output_text.delta", Map.of("text", "two"), false,
                "delta-2");
        state.materializeNextBatch(TENANT, sessionId, 100);
        java.util.Map<String, Object> dump = new java.util.LinkedHashMap<>();
        dump.put("events", jdbc.queryForList("SELECT sequence_id, event_type,"
                + " content_part_id FROM managed_agent_event WHERE tenant_id = ?"
                + " AND session_id = ? ORDER BY sequence_id", TENANT, sessionId));
        dump.put("parts", jdbc.queryForList("SELECT part_id, part_type, part_text"
                + " FROM managed_agent_item_part WHERE tenant_id = ? AND"
                + " session_id = ? ORDER BY part_id", TENANT, sessionId));
        java.nio.file.Files.writeString(java.nio.file.Path.of(System.getProperty(
                "probe.out")), new com.fasterxml.jackson.databind.ObjectMapper()
                .writerWithDefaultPrettyPrinter().writeValueAsString(dump));
    }
'''
for arm in ['control', 'revert-r3']:
    path = f'/root/verify/pr13355/arms/{arm}/{driver.MOD}/{driver.TPKG}/ManagedExtensionRecordStoreTest.java'
    text = open(path).read()
    if 'probeSplitForPr13355' not in text:
        anchor = '    @Test\n    void keepsOneTextPartAcrossATaskAnnouncement()'
        assert text.count(anchor) == 1
        text = text.replace(anchor, PROBE + '\n' + anchor)
        open(path, 'w').write(text)
    out = f'/root/verify/pr13355/arms/split-{arm}.json'
    cmd = ['mvn', '-o', '-B', '-q', f'-Dmaven.repo.local=/root/verify/pr13355/m2/repository',
           '-Djacoco.skip=true', '-Dcheckstyle.skip=true', '-Dspotbugs.skip=true',
           '-Dtest=ManagedExtensionRecordStoreTest#probeSplitForPr13355',
           f'-DargLine=-Dprobe.out={out}', 'test']
    code = subprocess.call(cmd, cwd=f'/root/verify/pr13355/arms/{arm}/{driver.MOD}',
                           env=driver.ENV, stdout=open(f'/root/verify/pr13355/arms/probe-{arm}.log','w'), stderr=subprocess.STDOUT)
    print(arm, 'exit', code)
    print(open(out).read() if os.path.exists(out) else 'no output')
