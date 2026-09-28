const fs = require('fs');
const SP = '/private/tmp/claude-501/-Users-wenshao-git-qwen-code-x3/9a095a26-d8c9-4266-9a4d-4dda027df21c/scratchpad/wt-probe/';
function edit(file, from, to) {
  const p = SP + file; let t = fs.readFileSync(p, 'utf8');
  const n = t.split(from).length - 1; if (n !== 1) throw new Error(`${file}: ${n} matches for ${from.slice(0, 60)}`);
  fs.writeFileSync(p, t.replace(from, () => to));
}
const IT = 'packages/sdk-java/managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent/HostedWorkspaceToolTurnIT.java';
const PR = 'packages/sdk-java/managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent/HostedSseGapProbe.java';
const DR = 'integration-tests/helpers/hosted-sse-gap-driver.ts';
// IT: optional default intervals; hand the hub to the probe.
edit(IT, `        if (sseGaps) {
            arguments.add("--qwen.managed-agent.events.poll-interval=60s");
            arguments.add("--qwen.managed-agent.events.heartbeat-interval=60s");`,
`        if (sseGaps) {
            if (!Boolean.getBoolean("qwen.fg6e.defaultIntervals")) {
                arguments.add("--qwen.managed-agent.events.poll-interval=60s");
                arguments.add("--qwen.managed-agent.events.heartbeat-interval=60s");
            }`);
edit(IT, `            HostedSseGapProbe sseProbe = sseGaps ? new HostedSseGapProbe(`,
`            if (sseGaps) HostedSseGapProbe.hub = spring.getBean(com.alibaba.qwen.code.managedagent.service.SessionEventHub.class);
            HostedSseGapProbe sseProbe = sseGaps ? new HostedSseGapProbe(`);
// Probe: non-asserting hub dump + ledger count.
edit(PR, `    private final JdbcTemplate jdbc;`, `    static Object hub;
    private final JdbcTemplate jdbc;`);
edit(PR, `                    case "release" -> { releaseTerminal.countDown(); yield Map.of(); }`,
`                    case "release" -> { releaseTerminal.countDown(); yield Map.of(); }
                    case "hub" -> {
                        var buffers = (Map<?, ?>) ReflectionTestUtils.getField(hub, "buffers");
                        var out = new ArrayList<Map<String, Object>>();
                        for (Object buffer : buffers.values()) {
                            synchronized (buffer) {
                                out.add(Map.of("references", ReflectionTestUtils.getField(buffer, "references"),
                                        "buffered", new ArrayList<>(((Map<?, ?>) ReflectionTestUtils.getField(buffer, "events")).keySet())));
                            }
                        }
                        yield Map.of("buffers", out);
                    }
                    case "count" -> Map.of("count", events().size());`);
// Driver: probe modes.
edit(DR, `  await Promise.all([
    publicAfter.start('public', publicBefore.frames.at(-1)!.id),
    webAfter.start('web', webBefore.frames.at(-1)!.id),
  ]);
  await Promise.all([publicAfter.through(2), webAfter.through(2)]);
  assert.deepEqual(
    publicAfter.frames.map((frame) => frame.id),
    [2],
    'Public cursor replay',
  );
  assert.deepEqual(
    webAfter.frames.map((frame) => frame.id),
    [2],
    'WebShell cursor replay',
  );
  await evidence('release');
  await Promise.all([publicAfter.through(3), webAfter.through(3)]);`,
`  const PROBE = process.env['FG6E_PROBE'] ?? '';
  const hubDump = async (at: string) => console.log('PROBE_HUB', at, JSON.stringify(await evidence('hub')));
  await hubDump('gap-after-finished');
  if (PROBE === 'race') {
    const jitter = Math.floor(Math.random() * 60);
    console.log('PROBE_RACE jitterMs', jitter);
    await Promise.all([
      publicAfter.start('public', publicBefore.frames.at(-1)!.id),
      webAfter.start('web', webBefore.frames.at(-1)!.id),
      new Promise((r) => setTimeout(r, jitter)).then(() => evidence('release')),
    ]);
  } else if (PROBE === 'late') {
    await evidence('release');
    await waitUntil(async () => (await evidence('count')).count === 3);
    console.log('PROBE_LATE terminal committed before reconnect');
    await Promise.all([
      publicAfter.start('public', publicBefore.frames.at(-1)!.id),
      webAfter.start('web', webBefore.frames.at(-1)!.id),
    ]);
  } else {
    await Promise.all([
      publicAfter.start('public', publicBefore.frames.at(-1)!.id),
      webAfter.start('web', webBefore.frames.at(-1)!.id),
    ]);
    await Promise.all([publicAfter.through(2), webAfter.through(2)]);
    assert.deepEqual(publicAfter.frames.map((frame) => frame.id), [2], 'Public cursor replay');
    assert.deepEqual(webAfter.frames.map((frame) => frame.id), [2], 'WebShell cursor replay');
    await hubDump('resumed-before-release');
    await evidence('release');
  }
  await Promise.all([publicAfter.through(3), webAfter.through(3)]);
  await new Promise((r) => setTimeout(r, 300));
  console.log('PROBE_IDS', PROBE || 'default', JSON.stringify({ publicAfter: publicAfter.frames.map((f) => f.id), webAfter: webAfter.frames.map((f) => f.id) }));
  await hubDump('after-terminal');`);
edit(DR, `  await Promise.all([publicBefore.close(), webBefore.close()]);
  assert.deepEqual(`, `  await Promise.all([publicBefore.close(), webBefore.close()]);
  console.log('PROBE_HUB before-release-after-disconnect', JSON.stringify(await evidence('hub')));
  assert.deepEqual(`);
console.log('patched');
