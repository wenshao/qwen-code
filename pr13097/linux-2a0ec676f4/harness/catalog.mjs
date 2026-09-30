// Synthetic context-usage catalog generator for PR #13097 verification.
// Builds a DaemonSessionContextUsageStatus whose serialized JSON exceeds
// 100,000 UTF-16 code units — the threshold that used to cut the legacy
// serialized message mid-JSON and break the card parser.
export function buildCatalog({ entries = 560, sessionId = 'rig13097-session', workspaceCwd = '/root/rig13097/workspace' } = {}) {
  const tools = Array.from({ length: entries }, (_, i) => ({
    name: `server_${i}__查询资源_${'lookup_resource_description_'.repeat(2)}${i}`,
    tokens: 100 + (i % 37),
  }));
  const status = {
    v: 1,
    sessionId,
    workspaceCwd,
    usage: {
      modelName: 'qwen-context-test',
      totalTokens: 100000,
      contextWindowSize: 128000,
      breakdown: {
        systemPrompt: 5000,
        builtinTools: 1000,
        mcpTools: 80000,
        memoryFiles: 1000,
        skills: 1000,
        messages: 12000,
        freeSpace: 28000,
        autocompactBuffer: 10000,
      },
      builtinTools: [],
      mcpTools: tools,
      memoryFiles: [],
      skills: [],
      showDetails: true,
    },
    formattedText: tools
      .map(({ name, tokens }) => `${name}: ${tokens} tokens`)
      .join('\n'),
  };
  return { status, tools };
}

// Standalone: print metrics.
if (import.meta.url === `file://${process.argv[1]}`) {
  const { status, tools } = buildCatalog();
  const json = JSON.stringify(status);
  console.log(`entries=${tools.length} jsonCodeUnits=${json.length}`);
  console.log(`first=${tools[0].name}`);
  console.log(`last=${tools[tools.length - 1].name}`);
}
