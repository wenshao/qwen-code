// Deterministic MCP server for the PR 12946 rig. Every physical request is
// appended to a JSONL ledger so effects can be counted from outside.
//   node mcp-server.mjs --transport stdio|http|sse --name N --ledger FILE [--port P]
//        [--token T] [--many-tools K] [--notify-on-list tools|resources|prompts]
import { appendFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const SDK = process.env.RIG_SDK;
const { McpServer } = await import(`${SDK}/dist/esm/server/mcp.js`);
const { StdioServerTransport } = await import(`${SDK}/dist/esm/server/stdio.js`);
const { StreamableHTTPServerTransport } = await import(`${SDK}/dist/esm/server/streamableHttp.js`);
const { SSEServerTransport } = await import(`${SDK}/dist/esm/server/sse.js`);
const { isInitializeRequest } = await import(`${SDK}/dist/esm/types.js`);
const z = createRequire(`${SDK}/package.json`)("zod");

const argv = Object.fromEntries(
  process.argv.slice(2).reduce((acc, v, i, all) => (v.startsWith('--') ? [...acc, [v.slice(2), all[i + 1]]] : acc), []),
);
const NAME = argv.name ?? 'mcp';
const LEDGER = argv.ledger;
const TOKEN = argv.token;
const MANY = Number(argv['many-tools'] ?? 0);
function log(entry) {
  if (LEDGER) appendFileSync(LEDGER, JSON.stringify({ server: NAME, t: Date.now(), pid: process.pid, ...entry }) + '\n');
}
const BLOB = Buffer.from(Array.from({ length: 300 }, (_, i) => (i * 37 + 11) & 0xff));

function build() {
  const server = new McpServer({ name: NAME, version: '1.0.0' }, { capabilities: { tools: { listChanged: true }, resources: { listChanged: true }, prompts: { listChanged: true } } });
  server.tool('effect', `Record one physical side effect on server ${NAME}. Returns EFFECT_OK.`, { tag: z.string() }, async ({ tag }) => {
    log({ method: 'tools/call', name: 'effect', tag });
    return { content: [{ type: 'text', text: `EFFECT_OK:${NAME}:${tag}` }] };
  });
  server.tool('slow', `Sleep for ms milliseconds on server ${NAME}, then return SLOW_DONE.`, { ms: z.number(), tag: z.string() }, async ({ ms, tag }, extra) => {
    log({ method: 'tools/call', name: 'slow', tag, phase: 'start' });
    const aborted = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), ms);
      extra.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(true); });
    });
    log({ method: 'tools/call', name: 'slow', tag, phase: aborted ? 'aborted' : 'done' });
    return { content: [{ type: 'text', text: `SLOW_DONE:${NAME}:${tag}` }] };
  });
  server.tool('big', `Return a text result of the requested byte size from ${NAME}.`, { bytes: z.number() }, async ({ bytes }) => {
    log({ method: 'tools/call', name: 'big', bytes });
    return { content: [{ type: 'text', text: 'x'.repeat(bytes) }] };
  });
  server.tool('notify', `Emit a list_changed notification of the given kind from ${NAME}.`, { kind: z.enum(['tools', 'resources', 'prompts']) }, async ({ kind }) => {
    log({ method: 'tools/call', name: 'notify', kind });
    if (kind === 'tools') server.sendToolListChanged();
    else if (kind === 'resources') server.sendResourceListChanged();
    else server.sendPromptListChanged();
    return { content: [{ type: 'text', text: `NOTIFIED:${kind}` }] };
  });
  server.tool('whoami', `Report the process environment of server ${NAME}.`, {}, async () => {
    log({ method: 'tools/call', name: 'whoami' });
    return { content: [{ type: 'text', text: JSON.stringify({ home: process.env.HOME, cwd: process.cwd(), token: process.env.MCP_TOKEN ? createHash('sha256').update(process.env.MCP_TOKEN).digest('hex').slice(0, 12) : null, user: process.env.USER ?? null, keys: Object.keys(process.env).sort() }) }] };
  });
  for (let i = 0; i < MANY; i++)
    server.tool(`pad_${String(i).padStart(3, '0')}`, `Padding tool ${i} `.padEnd(400, '.'), {}, async () => ({ content: [{ type: 'text', text: `PAD_${i}` }] }));
  server.resource('text', 'mem://text', { mimeType: 'text/plain', description: 'A text resource' }, async (uri) => {
    log({ method: 'resources/read', uri: uri.href });
    return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: `TEXT_RESOURCE:${NAME}` }] };
  });
  server.resource('blob', 'mem://blob', { mimeType: 'application/octet-stream', description: 'A binary resource' }, async (uri) => {
    log({ method: 'resources/read', uri: uri.href });
    return { contents: [{ uri: uri.href, mimeType: 'application/octet-stream', blob: BLOB.toString('base64') }] };
  });
  server.resource('slowres', 'mem://slow', { mimeType: 'text/plain', description: 'A resource that takes 8 s' }, async (uri, extra) => {
    log({ method: 'resources/read', uri: uri.href, phase: 'start' });
    const aborted = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), Number(process.env.RIG_SLOW_MS ?? 8000));
      extra.signal.addEventListener('abort', () => { clearTimeout(timer); resolve(true); });
    });
    log({ method: 'resources/read', uri: uri.href, phase: aborted ? 'aborted' : 'done' });
    return { contents: [{ uri: uri.href, mimeType: 'text/plain', text: 'SLOW_RESOURCE' }] };
  });
  server.prompt('two', 'A prompt with two messages', { topic: z.string() }, async ({ topic }) => {
    log({ method: 'prompts/get', name: 'two', topic });
    return { messages: [
      { role: 'user', content: { type: 'text', text: `FIRST:${topic}` } },
      { role: 'assistant', content: { type: 'text', text: `SECOND:${topic}` } },
    ] };
  });
  return server;
}

function authorized(req, res) {
  if (!TOKEN) return true;
  if (req.headers.authorization === `Bearer ${TOKEN}`) return true;
  log({ method: 'unauthorized', url: req.url });
  res.writeHead(401).end('unauthorized');
  return false;
}
async function readBody(req) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : undefined;
}

if (argv.transport === 'stdio') {
  log({ method: 'process-start', home: process.env.HOME, cwd: process.cwd() });
  await build().connect(new StdioServerTransport());
} else if (argv.transport === 'http') {
  const sessions = new Map();
  createServer(async (req, res) => {
    if (!authorized(req, res)) return;
    const id = req.headers['mcp-session-id'];
    if (req.method === 'DELETE') log({ method: 'http-delete', session: id ?? null });
    try {
      if (req.method === 'POST') {
        const body = await readBody(req);
        let transport = id && sessions.get(id);
        if (!transport && isInitializeRequest(body)) {
          transport = new StreamableHTTPServerTransport({ sessionIdGenerator: () => randomUUID(), onsessioninitialized: (sid) => sessions.set(sid, transport) });
          transport.onclose = () => transport.sessionId && sessions.delete(transport.sessionId);
          await build().connect(transport);
        }
        if (!transport) return res.writeHead(404).end('no session');
        return transport.handleRequest(req, res, body);
      }
      const transport = id && sessions.get(id);
      if (!transport) return res.writeHead(req.method === 'GET' ? 405 : 404).end();
      return transport.handleRequest(req, res);
    } catch (e) {
      if (!res.headersSent) res.writeHead(500).end(String(e));
    }
  }).listen(Number(argv.port), '127.0.0.1', () => log({ method: 'listen', port: argv.port }));
} else if (argv.transport === 'sse') {
  const sessions = new Map();
  createServer(async (req, res) => {
    if (!authorized(req, res)) return;
    const url = new URL(req.url, 'http://x');
    if (req.method === 'GET' && url.pathname === '/sse') {
      const transport = new SSEServerTransport('/messages', res);
      sessions.set(transport.sessionId, transport);
      res.on('close', () => sessions.delete(transport.sessionId));
      log({ method: 'sse-open', session: transport.sessionId });
      await build().connect(transport);
      return;
    }
    if (req.method === 'POST' && url.pathname === '/messages') {
      const transport = sessions.get(url.searchParams.get('sessionId'));
      if (!transport) return res.writeHead(404).end('no session');
      return transport.handlePostMessage(req, res, await readBody(req));
    }
    res.writeHead(404).end();
  }).listen(Number(argv.port), '127.0.0.1', () => log({ method: 'listen', port: argv.port }));
}
