// S13 (round 3): cost of discovering before every model request.
// Time from POST /prompt to the first model request, and mcp-discover calls
// per prompt, for a 1-server and a 6-server Session (text-only turns).
import {
  Harness, brokerCalls, mcpProfile, modelRequests, newSession, result,
  setScript, startBrokerProxy, startModel,
} from './rig12946-lib.js';

const model = await startModel();
const proxy = await startBrokerProxy();
const h = await new Harness().start(model.baseUrl, proxy.url);
const out: Record<string, unknown> = {};
setScript(() => ({ content: 'TEXT_ONLY_ANSWER' }));
try {
  for (const [label, W, servers] of [
    ['one-server', 9, [['local']]],
    ['six-servers', 10, [['local'], ['many'], ['remote'], ['legacy'], ['plain'], ['short']]],
  ] as const) {
    const s = await newSession(W);
    await h.open(s.sessionId, s.workspaceId, mcpProfile(W, servers as Array<[string]>));
    await h.prompt(s.sessionId, `${label}-WARM`); // installs the connections
    const lat: number[] = [];
    const discovers: number[] = [];
    for (let i = 0; i < 5; i++) {
      const marker = `${label}-TEXT-${i}`;
      const k = brokerCalls.length;
      const t = Date.now();
      await h.prompt(s.sessionId, marker);
      const first = modelRequests.find((m) => m.marker === marker);
      lat.push(first ? first.t - t : -1);
      discovers.push(brokerCalls.slice(k).filter((c) => c.kind === 'mcp-discover').length);
    }
    out[label] = { msToFirstModelRequest: lat, discoverCallsPerPrompt: discovers };
    await h.call(s.sessionId, `/session/${s.sessionId}/detach`, {});
  }
} finally {
  result('s13', out);
  await h.close();
  await model.close();
  await proxy.close();
}
