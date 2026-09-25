// Fake "Atlassian-shaped" remote MCP + OAuth authorization server.
// MCP resource server on MCP_PORT, authorization server on AS_PORT.
// Mirrors the real shapes observed on mcp.atlassian.com / auth.atlassian.com:
//  - MCP endpoint: 401 + WWW-Authenticate: Bearer resource_metadata="<path-scoped PRM>"
//  - PRM names a PATH-scoped authorization server (…/<tenant>)
//  - origin AS metadata exists but has NO registration_endpoint
//  - tenant AS metadata advertises registration_endpoint …/<tenant>/dcr/register
// Every request is appended to LOG (JSONL).
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';

const MCP_PORT = Number(process.env.MCP_PORT || 18911);
const AS_PORT = Number(process.env.AS_PORT || 18912);
const LOG = process.env.LOG || './fake-atlassian.log.jsonl';
const NO_WWW_AUTH = process.env.NO_WWW_AUTH === '1'; // scenario: standard discovery only
const NO_TENANT_REG = process.env.NO_TENANT_REG === '1'; // tenant AS metadata omits registration_endpoint
const ROOT_PRM = process.env.ROOT_PRM === '1'; // also serve PRM at the origin root
const TENANT = 'tenant-VCeDsk8Z';
const MCP_ORIGIN = `http://127.0.0.1:${MCP_PORT}`;
const AS_ORIGIN = `http://127.0.0.1:${AS_PORT}`;
const ISSUER = `${AS_ORIGIN}/${TENANT}`;
const clients = new Map();
const codes = new Map();
const tokens = new Set();

function log(side, req, extra = {}) {
  fs.appendFileSync(
    LOG,
    JSON.stringify({ t: new Date().toISOString(), side, method: req.method, url: req.url, auth: req.headers.authorization ? 'Bearer …' : undefined, ...extra }) + '\n',
  );
}
function json(res, status, body, headers = {}) {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((r) => {
    let s = '';
    req.on('data', (d) => (s += d)).on('end', () => r(s));
  });
}

const prm = {
  resource: `${MCP_ORIGIN}/v2/mcp`,
  authorization_servers: [ISSUER],
  bearer_methods_supported: ['header'],
  scopes_supported: ['read:me', 'offline_access'],
};

http
  .createServer(async (req, res) => {
    const u = new URL(req.url, MCP_ORIGIN);
    const body = req.method === 'POST' ? await readBody(req) : '';
    log('mcp', req, body ? { body: body.slice(0, 200) } : {});
    if (u.pathname === '/.well-known/oauth-protected-resource/v2/mcp' || ((NO_WWW_AUTH || ROOT_PRM) && u.pathname === '/.well-known/oauth-protected-resource'))
      return json(res, 200, prm);
    if (u.pathname !== '/v2/mcp') return json(res, 404, { error: 'not_found' });
    const auth = req.headers.authorization || '';
    const tok = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    if (!tokens.has(tok)) {
      const h = NO_WWW_AUTH ? {} : { 'www-authenticate': `Bearer resource_metadata="${MCP_ORIGIN}/.well-known/oauth-protected-resource/v2/mcp"` };
      res.writeHead(401, { 'content-type': 'application/json', ...h });
      return res.end(req.method === 'HEAD' ? undefined : JSON.stringify({ error: 'unauthorized' }));
    }
    if (req.method === 'GET') { res.writeHead(405); return res.end(); }
    if (req.method === 'DELETE') { res.writeHead(200); return res.end(); }
    if (req.method !== 'POST') { res.writeHead(405); return res.end(); }
    const msg = JSON.parse(body);
    if (msg.id === undefined) { res.writeHead(202); return res.end(); }
    let result;
    if (msg.method === 'initialize')
      result = { protocolVersion: msg.params?.protocolVersion ?? '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'fake-atlassian', version: '1.0.0' } };
    else if (msg.method === 'tools/list')
      result = { tools: [{ name: 'atlassianUserInfo', description: 'Return the authenticated Atlassian user (fake)', inputSchema: { type: 'object', properties: {} } }, { name: 'getAccessibleAtlassianResources', description: 'List cloud sites (fake)', inputSchema: { type: 'object', properties: {} } }] };
    else if (msg.method === 'tools/call')
      result = { content: [{ type: 'text', text: 'fake-atlassian: authenticated OK' }] };
    else if (msg.method === 'prompts/list') result = { prompts: [] };
    else if (msg.method === 'resources/list') result = { resources: [] };
    else return json(res, 200, { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
    return json(res, 200, { jsonrpc: '2.0', id: msg.id, result });
  })
  .listen(MCP_PORT, '127.0.0.1');

http
  .createServer(async (req, res) => {
    const u = new URL(req.url, AS_ORIGIN);
    const body = req.method === 'POST' ? await readBody(req) : '';
    log('as', req, body ? { body: body.slice(0, 300) } : {});
    const common = { authorization_endpoint: `${AS_ORIGIN}/authorize`, token_endpoint: `${AS_ORIGIN}/oauth/token`, code_challenge_methods_supported: ['S256'], response_types_supported: ['code'] };
    if (u.pathname === '/.well-known/oauth-authorization-server') return json(res, 200, { issuer: AS_ORIGIN, ...common }); // origin: NO registration_endpoint
    if (u.pathname === `/.well-known/oauth-authorization-server/${TENANT}`) return json(res, 200, { issuer: ISSUER, ...common, ...(NO_TENANT_REG ? {} : { registration_endpoint: `${ISSUER}/dcr/register` }) });
    if (u.pathname === `/${TENANT}/dcr/register` || u.pathname === '/pinned/register') {
      const client_id = `dcr-${u.pathname.split('/')[1]}-${crypto.randomBytes(4).toString('hex')}`;
      const reqBody = JSON.parse(body || '{}');
      clients.set(client_id, reqBody);
      return json(res, 201, { client_id, redirect_uris: reqBody.redirect_uris, grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none' });
    }
    if (u.pathname === '/authorize') {
      const cid = u.searchParams.get('client_id');
      if (!clients.has(cid)) return json(res, 400, { error: 'invalid_client' });
      const code = crypto.randomBytes(8).toString('hex');
      codes.set(code, cid);
      const redirect = new URL(u.searchParams.get('redirect_uri'));
      redirect.searchParams.set('code', code);
      redirect.searchParams.set('state', u.searchParams.get('state'));
      res.writeHead(302, { location: redirect.toString() });
      return res.end();
    }
    if (u.pathname === '/oauth/token') {
      const p = new URLSearchParams(body);
      if (!codes.has(p.get('code'))) return json(res, 400, { error: 'invalid_grant' });
      const access_token = `at-${crypto.randomBytes(8).toString('hex')}`;
      tokens.add(access_token);
      return json(res, 200, { access_token, token_type: 'Bearer', expires_in: 3600, refresh_token: 'rt-x', scope: 'read:me offline_access' });
    }
    return json(res, 404, { error: 'not_found' });
  })
  .listen(AS_PORT, '127.0.0.1');

console.log(`fake-atlassian mcp=${MCP_ORIGIN}/v2/mcp as=${ISSUER} noWWWAuth=${NO_WWW_AUTH} noTenantReg=${NO_TENANT_REG} rootPrm=${ROOT_PRM} log=${LOG}`);
