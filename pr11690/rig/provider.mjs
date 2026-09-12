#!/usr/bin/env node
/**
 * A faithful OpenAI-compatible provider replica for PR #11690 verification.
 *
 * Serves three request kinds the real CLI makes, told apart by the system
 * instruction the production code sends:
 *   - main   : the Goal's own turns (scripted tool calls, then a short reply)
 *   - ckpt   : the Goal evidence checkpoint verifier (the subject of the PR)
 *   - judge  : the independent Goal verifier
 *
 * Everything is written to a JSONL ledger: byte length and sha256 of the exact
 * payload the checkpoint verifier built, evidence record count and uuids,
 * previousClaims ids, whether the call carried a corrective retry note.
 */
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import {
  appendFileSync,
  writeFileSync,
  existsSync,
  readFileSync,
} from 'node:fs';

const RIG = process.env.RIG_DIR;
if (!RIG) throw new Error('RIG_DIR required');
const LEDGER = `${RIG}/ledger.jsonl`;
const PORT = Number(process.env.RIG_PORT || 0);

// --- policy knobs -----------------------------------------------------------
// How many records one checkpoint call can answer for under the 32-claim bound
// is not a knob: it falls out of CKPT_POLICY below.
const CKPT_POLICY = process.env.RIG_CKPT_POLICY || 'claims-per-record';
// 'claims-per-record': the stub emits one claim per new evidence record and
//   merges the claims carried in into one claim per proofKind. A window of N
//   records therefore answers with N + k claims; over the runtime's 32-claim
//   bound that is rejected as GoalCheckpointClaimCountError, exactly the
//   "answer that could not be folded into claims" the incident recorded.
// 'byte-limit': the stub refuses any request whose payload exceeds
//   RIG_CKPT_MAX_BYTES with a provider-shaped 400 context_length_exceeded.
const CKPT_MAX_BYTES = Number(process.env.RIG_CKPT_MAX_BYTES || 60_000);
const CKPT_DELAY_MS = Number(process.env.RIG_CKPT_DELAY_MS || 0);
const TOOL_CALLS_PER_TURN = Number(process.env.RIG_TOOL_CALLS_PER_TURN || 16);
const TOOL_TURNS = Number(process.env.RIG_TOOL_TURNS || 4);
const BLOB_BYTES = Number(process.env.RIG_BLOB_BYTES || 1600);
const MAIN_DELAY_MS = Number(process.env.RIG_MAIN_DELAY_MS || 0);

let seq = 0;
let toolTurns = 0;
let mainCalls = 0;

const phase = () => {
  try {
    return readFileSync(`${RIG}/phase`, 'utf8').trim();
  } catch {
    return '';
  }
};

const log = (row) => {
  appendFileSync(LEDGER, JSON.stringify({ ...row, phase: phase() }) + '\n');
};

const sha = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

const textOf = (content) => {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((p) => (typeof p === 'string' ? p : (p?.text ?? '')))
      .join('\n');
  }
  return '';
};

const kindOf = (body) => {
  const sys = (body.messages || [])
    .filter((m) => m.role === 'system' || m.role === 'developer')
    .map((m) => textOf(m.content))
    .join('\n');
  if (sys.includes('Goal Evidence Checkpoint Verifier')) return 'ckpt';
  if (sys.includes('independent Goal Verifier')) return 'judge';
  return 'main';
};

/** The last user message: for a side query this is the whole JSON payload. */
const lastUser = (body) => {
  const users = (body.messages || []).filter((m) => m.role === 'user');
  return textOf(users[users.length - 1]?.content ?? '');
};

const firstJsonObject = (text) => {
  // The checkpoint payload is the first part; a corrective note may follow.
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (c === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        try {
          return JSON.parse(text.slice(start, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
};

// --- checkpoint answers -----------------------------------------------------

const claimText = (prefix, ids) =>
  `${prefix} ${ids.length} source(s): ${ids
    .map((id) => id.slice(0, 8))
    .join(',')}`.slice(0, 400);

/**
 * The stub's compression policy, applied to the request as written:
 * one claim per new evidence record, plus one merged claim per proofKind for
 * the claims carried in. Monotone in the number of records, which is the
 * property the PR's batching depends on.
 */
const buildClaims = (payload) => {
  const claims = [];
  const carried = new Map();
  for (const c of payload.previousClaims ?? []) {
    if (!carried.has(c.proofKind)) carried.set(c.proofKind, []);
    carried.get(c.proofKind).push(c.id);
  }
  for (const [kind, ids] of carried) {
    for (let i = 0; i < ids.length; i += 32) {
      const chunk = ids.slice(i, i + 32);
      claims.push({
        proofKind: kind,
        claim: claimText('Carried forward from', chunk),
        sourceRefs: chunk,
      });
    }
  }
  for (const record of payload.evidence ?? []) {
    claims.push({
      proofKind: record.proofKind,
      claim: claimText(
        `Turn ${record.turnId?.slice(0, 8) ?? '?'} recorded`,
        [record.uuid],
      ),
      sourceRefs: [record.uuid],
    });
  }
  return claims;
};

// --- main-model script ------------------------------------------------------

const blob = (i) => {
  const unit = `record-${String(i).padStart(3, '0')} `;
  let s = '';
  while (s.length < BLOB_BYTES) s += unit;
  return s.slice(0, BLOB_BYTES);
};

let shellIndex = 0;
let idleReplies = 0;
const mainResponse = (body) => {
  const msgs = body.messages || [];
  const last = msgs[msgs.length - 1];
  const stopFile = `${RIG}/stop-tools`;
  const toolsExhausted = toolTurns >= TOOL_TURNS || existsSync(stopFile);
  if (last?.role === 'tool' || toolsExhausted) {
    // End the turn. Past the tool phase every turn is one short reply, which
    // is the smallest catalog-eligible record a turn can leave behind.
    if (last?.role === 'tool') toolTurns += 1;
    idleReplies += 1;
    return {
      content: toolsExhausted
        ? `Standing by ${String(idleReplies).padStart(3, '0')}.`
        : 'Recorded this batch of probe outputs.',
      finishReason: 'stop',
    };
  }
  const calls = [];
  for (let i = 0; i < TOOL_CALLS_PER_TURN; i++) {
    shellIndex += 1;
    calls.push({
      id: `call_${shellIndex}`,
      type: 'function',
      function: {
        name: 'run_shell_command',
        arguments: JSON.stringify({
          command: `printf '%s' '${blob(shellIndex)}'`,
          description: `probe ${shellIndex}`,
        }),
      },
    });
  }
  return { toolCalls: calls, finishReason: 'tool_calls' };
};

// --- HTTP -------------------------------------------------------------------

const readBody = (req) =>
  new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });

const sendJsonError = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(payload);
};

const sse = (res, model, message) => {
  res.writeHead(200, {
    'cache-control': 'no-cache',
    connection: 'keep-alive',
    'content-type': 'text/event-stream',
  });
  const id = `chatcmpl-${Math.random().toString(36).slice(2)}`;
  const created = Math.floor(Date.now() / 1000);
  const chunk = (delta, finish = null, usage) =>
    `data: ${JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta, finish_reason: finish }],
      ...(usage ? { usage } : {}),
    })}\n\n`;
  res.write(chunk({ role: 'assistant' }));
  if (message.content) res.write(chunk({ content: message.content }));
  (message.toolCalls ?? []).forEach((tc, index) => {
    res.write(
      chunk({
        tool_calls: [
          {
            index,
            id: tc.id,
            type: 'function',
            function: { name: tc.function.name, arguments: '' },
          },
        ],
      }),
    );
    res.write(
      chunk({
        tool_calls: [
          { index, function: { arguments: tc.function.arguments } },
        ],
      }),
    );
  });
  res.write(
    chunk({}, message.finishReason ?? 'stop', {
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120,
    }),
  );
  res.write('data: [DONE]\n\n');
  res.end();
};

const server = createServer(async (req, res) => {
  if (req.method !== 'POST' || !req.url?.includes('/chat/completions')) {
    res.writeHead(404);
    res.end('not found');
    return;
  }
  const raw = await readBody(req);
  let body;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    res.writeHead(400);
    res.end('bad json');
    return;
  }
  const started = Date.now();
  seq += 1;
  const mySeq = seq;
  const kind = kindOf(body);
  const model = body.model ?? 'unknown';
  const row = {
    seq: mySeq,
    kind,
    model,
    ts: new Date().toISOString(),
    requestBytes: raw.length,
  };

  if (kind === 'ckpt') {
    const user = lastUser(body);
    const payload = firstJsonObject(user) ?? {};
    const evidence = payload.evidence ?? [];
    const previous = payload.previousClaims ?? [];
    row.payloadBytes = Buffer.byteLength(user, 'utf8');
    row.payloadSha256 = sha(user);
    row.evidenceCount = evidence.length;
    row.evidenceFirst = evidence[0]?.uuid;
    row.evidenceLast = evidence[evidence.length - 1]?.uuid;
    row.evidenceUuidsSha = sha(evidence.map((e) => e.uuid).join(','));
    row.previousClaimsCount = previous.length;
    row.previousClaimIds = previous.map((c) => c.id);
    row.corrective = user.includes('Your previous answer was rejected');
    if (CKPT_DELAY_MS > 0) {
      await new Promise((r) => setTimeout(r, CKPT_DELAY_MS));
    }
    if (CKPT_POLICY === 'byte-limit' && row.payloadBytes > CKPT_MAX_BYTES) {
      row.outcome = 'http400_context_length';
      row.status = 400;
      row.durationMs = Date.now() - started;
      log(row);
      sendJsonError(res, 400, {
        error: {
          message: `This model's maximum context length is ${Math.floor(
            CKPT_MAX_BYTES / 4,
          )} tokens. However, your messages resulted in ${Math.floor(
            row.payloadBytes / 4,
          )} tokens. Please reduce the length of the messages.`,
          type: 'invalid_request_error',
          param: 'messages',
          code: 'context_length_exceeded',
        },
      });
      return;
    }
    const claims = buildClaims(payload);
    row.outcome = 'claims';
    row.claimsReturned = claims.length;
    row.status = 200;
    row.durationMs = Date.now() - started;
    log(row);
    sse(res, model, {
      content: JSON.stringify({ claims }),
      finishReason: 'stop',
    });
    return;
  }

  if (kind === 'judge') {
    row.outcome = 'accept';
    row.status = 200;
    row.durationMs = Date.now() - started;
    log(row);
    sse(res, model, {
      content: JSON.stringify({
        decision: 'accept',
        reason: 'probe rig accepts the proposal',
      }),
      finishReason: 'stop',
    });
    return;
  }

  mainCalls += 1;
  if (MAIN_DELAY_MS > 0) {
    await new Promise((r) => setTimeout(r, MAIN_DELAY_MS));
  }
  const message = mainResponse(body);
  row.outcome = message.toolCalls ? 'tool_calls' : 'text';
  row.toolCalls = message.toolCalls?.length ?? 0;
  row.mainCall = mainCalls;
  row.toolTurns = toolTurns;
  row.status = 200;
  row.durationMs = Date.now() - started;
  log(row);
  sse(res, model, message);
});

server.listen(PORT, '127.0.0.1', () => {
  const { port } = server.address();
  writeFileSync(`${RIG}/port`, String(port));
  console.log(`rig provider on http://127.0.0.1:${port}/v1`);
});
