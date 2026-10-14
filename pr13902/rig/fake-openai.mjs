// Standalone OpenAI-compatible fake provider for PR 13902 (Agent Team / agent
// identity on the ACP/daemon wire). Every request is appended to a JSONL ledger
// so the oracle "did the leader model actually receive the teammate report" is
// read off the provider side, independently of the daemon's own frames.
//
// Routing is by marker, never by request index (hosts issue auxiliary calls):
//   teammate  : a system/user message contains [[TM:<kind>:<tag>]]
//   subagent  : a system/user message contains [[SUB:<variant>]]
//   leader    : the LAST user message carries [[LEAD:<scenario>:...]], or is a
//               background notification carrying a teammate report / notice.
import http from 'node:http';
import fs from 'node:fs';

const port = Number(process.env.FAKE_PORT || 8765);
const ledger = process.env.FAKE_LEDGER || `fake-ledger-${port}.jsonl`;
const WS = process.env.FAKE_WS || '/tmp';
let requestIndex = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(obj) {
  fs.appendFileSync(ledger, JSON.stringify({ t: new Date().toISOString(), ...obj }) + '\n');
}
function textOf(m) {
  if (typeof m.content === 'string') return m.content;
  if (Array.isArray(m.content)) return m.content.map((p) => (typeof p === 'string' ? p : p.text || '')).join('');
  return '';
}
function call(name, args, id) {
  return { id, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

const ANCHOR = /\[\[LEAD:|TEAMMATE-REPORT |team_notice|\[\[TM:|\[\[SUB:/;
function hasAgentLoaded(msgs, uptoIdx) {
  for (let i = 0; i < uptoIdx; i++) {
    const m = msgs[i];
    for (const tc of m.tool_calls || []) {
      if (tc.function?.name === 'tool_search' && /agent/.test(tc.function?.arguments || '')) return true;
    }
  }
  return false;
}
function agentStep(msgs, anchorIdx, stage, idx, tag, args, prefixSteps = []) {
  // Deferred tool: a real model calls tool_search(select:agent) once, then
  // invokes it through tool_call. Mirror that so the bridge path is exercised.
  const steps = [...prefixSteps, ...(hasAgentLoaded(msgs, anchorIdx) ? [] : ['search']), 'spawn', 'text'];
  return { step: steps[stage] ?? 'text', steps };
}

async function decide(body, idx) {
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  const tools = (body.tools || []).map((t) => t?.function?.name).filter(Boolean);
  let lastUserIdx = -1;
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'user') { lastUserIdx = i; break; }
  const lastUser = lastUserIdx >= 0 ? textOf(msgs[lastUserIdx]) : '';
  if (tools.length <= 5 || /^\[SUGGESTION MODE|Managed memory has TWO/.test(lastUser.trim())) return { who: 'aux', text: 'ok' };
  // Anchor = the most recent user message that carries a scenario marker or a
  // notification; hosts append <system-reminder> user messages after it.
  let anchorIdx = -1;
  for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'user' && ANCHOR.test(textOf(msgs[i]))) { anchorIdx = i; break; }
  const anchor = anchorIdx >= 0 ? textOf(msgs[anchorIdx]) : '';
  const after = msgs.slice(anchorIdx + 1);
  const stage = after.filter((m) => m.role === 'tool').length;
  const lastToolText = after.filter((m) => m.role === 'tool').map(textOf).pop() || '';
  const sysUser = msgs.filter((m) => m.role === 'system' || m.role === 'user').map(textOf).join('\n');

  const tm = /\[\[TM:([a-z]+):([A-Za-z0-9-]+)\]\]/.exec(sysUser);
  if (tm) {
    const [, kind, tag] = tm;
    if (kind === 'report') return { who: 'teammate', kind, tag, stage, text: `TEAMMATE-REPORT ${tag} blue-green` };
    if (kind === 'slow') {
      if (stage === 0) { await sleep(Number(process.env.FAKE_TM_SLOW_MS || 6000)); return { who: 'teammate', kind, tag, stage, text: `TEAMMATE-REPORT ${tag} after-delay` }; }
      return { who: 'teammate', kind, tag, stage, text: `TEAMMATE-REPORT ${tag} done` };
    }
    if (kind === 'write') {
      if (stage === 0) return { who: 'teammate', kind, tag, stage, toolCalls: [call('write_file', { file_path: `${WS}/tm-${tag}.txt`, content: `TEAM-OK ${tag}\n` }, `call_tmw_${tag}_${idx}`)] };
      return { who: 'teammate', kind, tag, stage, text: `TEAMMATE-REPORT ${tag} wrote-file: ${lastToolText.slice(0, 80)}` };
    }
    return { who: 'teammate', kind, tag, stage, text: `TEAMMATE-REPORT ${tag} unknown-kind` };
  }

  const sub = /\[\[SUB:([A-Za-z0-9-]+)\]\]/.exec(sysUser);
  if (sub) return { who: 'subagent', tag: sub[1], stage, text: `SUBAGENT-OK ${sub[1]}` };

  const lead = /\[\[LEAD:([a-z]+):([A-Za-z0-9-]+)(?::([A-Za-z0-9-]+))?\]\]/.exec(anchor);
  if (lead) {
    const [, scen, tag, extra] = lead;
    const search = () => call('tool_search', { query: 'select:agent' }, `call_search_${tag}_${idx}`);
    if (scen === 'team') {
      const tmKind = extra || 'report';
      const { step } = agentStep(msgs, anchorIdx, stage, idx, tag, null, ['team_create']);
      if (step === 'team_create') return { who: 'leader', scen, tag, stage, toolCalls: [call('team_create', { team_name: `t-${tag}` }, `call_tc_${tag}_${idx}`)] };
      if (step === 'search') return { who: 'leader', scen, tag, stage, toolCalls: [search()] };
      if (step === 'spawn') return { who: 'leader', scen, tag, stage, toolCalls: [call('tool_call', { name: 'agent', arguments: { description: `teammate probe ${tag}`, prompt: `[[TM:${tmKind}:${tag}]] Run the probe and report back.`, name: 'correctness' } }, `call_spawn_${tag}_${idx}`)] };
      return { who: 'leader', scen, tag, stage, text: `LEADER-SPAWNED ${tag}` };
    }
    if (scen === 'write') {
      if (stage === 0) return { who: 'leader', scen, tag, stage, toolCalls: [call('write_file', { file_path: `${WS}/leader-${tag}.txt`, content: `LEADER-OK ${tag}\n` }, `call_lw_${tag}_${idx}`)] };
      return { who: 'leader', scen, tag, stage, text: `LEADER-WROTE ${tag}` };
    }
    if (scen === 'sub') {
      // tag is the variant: omit | <subagent_type literal>
      const { step } = agentStep(msgs, anchorIdx, stage, idx, tag, null);
      if (step === 'search') return { who: 'leader', scen, tag, stage, toolCalls: [search()] };
      if (step === 'spawn') {
        const args = { description: `subagent probe ${tag}`, prompt: `[[SUB:${tag}]] Reply with one word.`, run_in_background: false };
        if (tag !== 'omit') args.subagent_type = tag;
        return { who: 'leader', scen, tag, stage, toolCalls: [call('tool_call', { name: 'agent', arguments: args }, `call_sub_${tag}_${idx}`)] };
      }
      return { who: 'leader', scen, tag, stage, text: `LEADER-SUB-DONE ${tag}: ${lastToolText.slice(0, 60)}` };
    }
    if (scen === 'del') {
      if (stage === 0) return { who: 'leader', scen, tag, stage, toolCalls: [call('team_delete', {}, `call_del_${tag}_${idx}`)] };
      return { who: 'leader', scen, tag, stage, text: `LEADER-DELETED ${tag}: ${lastToolText.slice(0, 80)}` };
    }
    if (scen === 'slow') {
      await sleep(Number(extra || 15) * 1000);
      return { who: 'leader', scen, tag, stage, text: `LEADER-SLOW-DONE ${tag}` };
    }
    return { who: 'leader', scen, tag, stage, text: `LEADER-UNKNOWN ${scen}` };
  }

  const rep = /TEAMMATE-REPORT ([A-Za-z0-9-]+)/.exec(anchor);
  if (rep) return { who: 'leader', scen: 'notified', tag: rep[1], stage, text: `LEADER-GOT-REPORT ${rep[1]}` };
  if (/team_notice/.test(anchor)) return { who: 'leader', scen: 'notice', stage, text: 'LEADER-GOT-NOTICE' };
  return { who: 'aux', stage, text: 'ok' };
}

function sse(res, obj) { res.write(`data: ${JSON.stringify(obj)}\n\n`); }

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || !req.url.includes('/chat/completions')) {
    res.writeHead(404); res.end('not found'); return;
  }
  let raw = '';
  req.on('data', (c) => (raw += c));
  req.on('end', async () => {
    const idx = requestIndex++;
    let body = {};
    try { body = JSON.parse(raw); } catch {}
    const d = await decide(body, idx);
    const msgs = body.messages || [];
    let lastUser = '';
    for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i].role === 'user') { lastUser = textOf(msgs[i]); break; }
    const tools = (body.tools || []).map((t) => t?.function?.name).filter(Boolean);
    log({
      requestIndex: idx, who: d.who, scen: d.scen, kind: d.kind, tag: d.tag, stage: d.stage,
      reply: d.text ?? (d.toolCalls || []).map((c) => `${c.function.name}(${c.function.arguments})`).join(' '),
      nMessages: msgs.length, nTools: tools.length,
      declares: { agent: tools.includes('agent'), team_create: tools.includes('team_create'), write_file: tools.includes('write_file'), send_message: tools.includes('send_message') },
      lastUser: lastUser.slice(0, 600),
    });
    const created = Math.floor(Date.now() / 1000);
    const id = `chatcmpl-fake-${idx}`;
    const toolCalls = d.toolCalls || [];
    const text = d.text || '';
    const finish = toolCalls.length ? 'tool_calls' : 'stop';
    const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };
    if (body.stream) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
      sse(res, { id, object: 'chat.completion.chunk', created, model: body.model, choices: [{ index: 0, delta: { role: 'assistant', content: '' }, finish_reason: null }] });
      if (text) sse(res, { id, object: 'chat.completion.chunk', created, model: body.model, choices: [{ index: 0, delta: { content: text }, finish_reason: null }] });
      toolCalls.forEach((tc, i) => {
        sse(res, { id, object: 'chat.completion.chunk', created, model: body.model, choices: [{ index: 0, delta: { tool_calls: [{ index: i, id: tc.id, type: 'function', function: { name: tc.function.name, arguments: '' } }] }, finish_reason: null }] });
        sse(res, { id, object: 'chat.completion.chunk', created, model: body.model, choices: [{ index: 0, delta: { tool_calls: [{ index: i, function: { arguments: tc.function.arguments } }] }, finish_reason: null }] });
      });
      sse(res, { id, object: 'chat.completion.chunk', created, model: body.model, choices: [{ index: 0, delta: {}, finish_reason: finish }], usage });
      res.write('data: [DONE]\n\n');
      res.end();
    } else {
      const message = { role: 'assistant', content: text || null };
      if (toolCalls.length) message.tool_calls = toolCalls;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id, object: 'chat.completion', created, model: body.model, choices: [{ index: 0, message, finish_reason: finish }], usage }));
    }
  });
});
server.listen(port, '127.0.0.1', () => {
  console.log(`fake-openai listening on http://127.0.0.1:${port}/v1 ledger=${ledger} ws=${WS}`);
});
