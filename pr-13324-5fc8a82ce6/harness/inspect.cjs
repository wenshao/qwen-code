// usage: node inspect.cjs <rundir>  -> prints JSON summary of one arm's run
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const run = process.argv[2];
const readJsonl = (f) =>
  fs.existsSync(f)
    ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => {
        try { return JSON.parse(l); } catch { return { __bad: l }; }
      })
    : [];
const textOf = (c) =>
  typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => p?.text ?? '').join('') : '';

const reqs = readJsonl(path.join(run, 'requests.jsonl'));
let phase = 'pre';
const tagged = [];
for (const r of reqs) {
  if (r.phase_start) { phase = r.phase_start; continue; }
  tagged.push({ ...r, phase });
}
const out = { run: path.basename(run) };
out.requestCounts = {};
for (const r of tagged) {
  const k = `${r.phase}:${r.kind}`;
  out.requestCounts[k] = (out.requestCounts[k] || 0) + 1;
}

// 1. Verifier evidence window as actually sent on the wire.
const verifier = tagged.filter((r) => r.kind === 'verifier');
out.verifierRequests = verifier.length;
if (verifier.length) {
  const v = verifier[verifier.length - 1];
  const userMsg = v.body.messages.filter((m) => m.role === 'user').map((m) => textOf(m.content)).join('');
  let payload;
  try { payload = JSON.parse(userMsg); } catch { payload = null; }
  if (payload) {
    out.verifierEvidence = payload.evidence.map((e) => ({
      proofKind: e.proofKind,
      provenance: e.provenance,
      has: {
        ORIGINAL_FILE_FACT: e.content.includes('ORIGINAL_FILE_FACT'),
        missingTxtError: /missing\.txt/.test(e.content),
        invented999: e.content.includes('999 tests'),
        goalEcho: e.content.includes('GOAL_ECHO'),
        computed42: /(^|\D)42(\D|$)/.test(e.content),
      },
      content: e.content.slice(0, 160),
    }));
    const byKind = {};
    for (const e of payload.evidence) byKind[e.proofKind] = (byKind[e.proofKind] || 0) + 1;
    out.verifierProofKindCounts = byKind;
    const ext = payload.evidence.filter((e) => e.proofKind === 'external_fact');
    out.oracle = {
      inventedClaimInExternalFact: ext.some((e) => e.content.includes('999 tests')),
      goalEchoInExternalFact: ext.some((e) => e.content.includes('GOAL_ECHO')),
      realFileBytesInExternalFact: ext.some((e) => e.content.includes('ORIGINAL_FILE_FACT')),
      swallowedErrorInExternalFact: ext.some((e) => /missing\.txt/.test(e.content)),
      computationAvailable: payload.evidence.some((e) => /(^|\D)42(\D|$)/.test(e.content)),
    };
  }
}

// 2. Durable transcript records.
const summarizeTranscript = (f) => {
  const recs = readJsonl(f);
  const tr = recs.filter((r) => r.type === 'tool_result');
  return {
    records: recs.length,
    toolResults: tr.map((r) => ({
      callId: r.toolCallResult?.callId,
      subtype: r.subtype ?? null,
      provenance: r.provenance ?? null,
      goalOwned: !!r.goalContext,
      status: r.toolCallResult?.status ?? null,
      fn: (r.message?.parts || []).map((p) => p.functionResponse?.name).filter(Boolean).join(','),
    })),
  };
};
out.transcriptPhase1 = summarizeTranscript(path.join(run, 'transcript-after-phase1.jsonl'));
out.transcriptPhase2 = summarizeTranscript(path.join(run, 'transcript-after-phase2.jsonl'));

// 3. What the resumed process sends to the provider.
const resumeWorker = tagged.filter((r) => r.phase === 'resume' && r.kind === 'worker');
if (resumeWorker.length) {
  const first = resumeWorker[0].body.messages;
  const announced = new Set();
  for (const m of first) for (const tc of m.tool_calls || []) announced.add(tc.id);
  const toolMsgs = first.filter((m) => m.role === 'tool');
  out.resumeFirstRequest = {
    messages: first.length,
    assistantToolCallIds: [...announced],
    toolMessageIds: toolMsgs.map((m) => m.tool_call_id),
    orphanToolMessages: toolMsgs.filter((m) => !announced.has(m.tool_call_id)).map((m) => m.tool_call_id),
    internalCodeIds: toolMsgs.filter((m) => /:code:/.test(m.tool_call_id || '')).length,
  };
}

// 4. Goal status as streamed by the CLI.
const goalStates = readJsonl(path.join(run, 'phase1.jsonl'))
  .filter((e) => e.type === 'stream_event' && e.event?.type === 'goal_state')
  .map((e) => e.event.goal_state?.goal);
out.goalStates = goalStates.map((g) => (g ? `${g.status}/turn${g.turnCount}` : 'none'));
out.exit = fs.existsSync(path.join(run, 'exit.txt')) ? fs.readFileSync(path.join(run, 'exit.txt'), 'utf8').trim().split('\n') : null;
console.log(JSON.stringify(out, null, 2));
