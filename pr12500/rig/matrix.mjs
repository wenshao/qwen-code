// Status matrix shared by the headless runner and the renderer.
// expect: what PR #12500 claims for the row — 'keep' (stay connected) or 'drop' (disconnect).
export const MATRIX = [
  // ---- Streamable HTTP (httpUrl), legacy protocol 2025-06-18 ----
  { name: 'h400', t: 'http', fault: 400, kind: 'm32601', expect: 'keep', label: 'HTTP 400 + JSON-RPC -32601' },
  { name: 'h404', t: 'http', fault: 404, kind: 'm32601', expect: 'keep', label: 'HTTP 404 + JSON-RPC -32601 (GitLab shape)' },
  { name: 'h405', t: 'http', fault: 405, kind: 'm32601', expect: 'keep', label: 'HTTP 405 + JSON-RPC -32601' },
  { name: 'h422', t: 'http', fault: 422, kind: 'm32601', expect: 'keep', label: 'HTTP 422 + JSON-RPC -32601' },
  { name: 'h501', t: 'http', fault: 501, kind: 'm32601', expect: 'keep', label: 'HTTP 501 + JSON-RPC -32601' },
  { name: 'h404alt', t: 'http', fault: 404, kind: 'm32601alt', expect: 'keep', label: 'HTTP 404 + -32601 "Unknown method: …"' },
  { name: 'h200', t: 'http', fault: 200, kind: 'm32601', expect: 'keep', label: 'control: in-band empty lists (HTTP 200)' },
  { name: 'h401', t: 'http', fault: 401, kind: 'm32601', expect: 'drop', label: 'HTTP 401 + -32601 body' },
  { name: 'h403', t: 'http', fault: 403, kind: 'm32601', expect: 'drop', label: 'HTTP 403 + -32601 body' },
  { name: 'h500', t: 'http', fault: 500, kind: 'm32601', expect: 'drop', label: 'HTTP 500 + -32601 body' },
  { name: 'h502', t: 'http', fault: 502, kind: 'm32601', expect: 'drop', label: 'HTTP 502 + -32601 body' },
  { name: 'h503', t: 'http', fault: 503, kind: 'm32601', expect: 'drop', label: 'HTTP 503 + -32601 body' },
  { name: 'h404sess', t: 'http', fault: 404, kind: 'm32001', expect: 'drop', label: 'HTTP 404 + -32001 "Session not found"' },
  { name: 'h400int', t: 'http', fault: 400, kind: 'm32603', expect: 'drop', label: 'HTTP 400 + -32603 internal error' },
  { name: 'h404nov', t: 'http', fault: 404, kind: 'nojsonrpc', expect: 'drop', label: 'HTTP 404 + -32601 without "jsonrpc":"2.0"' },
  { name: 'h404html', t: 'http', fault: 404, kind: 'html', expect: 'drop', label: 'HTTP 404 + HTML page' },
  { name: 'h404quote', t: 'http', fault: 404, kind: 'quote', expect: 'drop', label: 'HTTP 404 + text quoting a -32601 payload' },
  { name: 'h404plain', t: 'http', fault: 404, kind: 'plain', expect: 'drop', label: 'HTTP 404 + text/plain "Method not found"' },
  // ---- legacy SSE (url) ----
  { name: 's400', t: 'sse', fault: 400, kind: 'm32601', expect: 'keep', label: 'SSE POST 400 + JSON-RPC -32601' },
  { name: 's404', t: 'sse', fault: 404, kind: 'm32601', expect: 'keep', label: 'SSE POST 404 + JSON-RPC -32601' },
  { name: 's405', t: 'sse', fault: 405, kind: 'm32601', expect: 'keep', label: 'SSE POST 405 + JSON-RPC -32601' },
  { name: 's422', t: 'sse', fault: 422, kind: 'm32601', expect: 'keep', label: 'SSE POST 422 + JSON-RPC -32601' },
  { name: 's501', t: 'sse', fault: 501, kind: 'm32601', expect: 'keep', label: 'SSE POST 501 + JSON-RPC -32601' },
  { name: 's200', t: 'sse', fault: 200, kind: 'm32601', expect: 'keep', label: 'control: in-band empty lists (SSE)' },
  { name: 's401', t: 'sse', fault: 401, kind: 'm32601', expect: 'drop', label: 'SSE POST 401 + -32601 body' },
  { name: 's403', t: 'sse', fault: 403, kind: 'm32601', expect: 'drop', label: 'SSE POST 403 + -32601 body' },
  { name: 's503', t: 'sse', fault: 503, kind: 'm32601', expect: 'drop', label: 'SSE POST 503 + -32601 body' },
  { name: 's404sess', t: 'sse', fault: 404, kind: 'm32001', expect: 'drop', label: 'SSE POST 404 + -32001 body' },
  { name: 's404quote', t: 'sse', fault: 404, kind: 'quote', expect: 'drop', label: 'SSE POST 404 + text quoting -32601' },
];

export function mcpServers(port, rows = MATRIX) {
  const out = {};
  for (const r of rows) {
    const qs = `fault=${r.fault}&kind=${r.kind}${r.get ? `&get=${r.get}` : ''}`;
    out[r.name] =
      r.t === 'http'
        ? { httpUrl: `http://127.0.0.1:${port}/mcp?${qs}`, alwaysLoadTools: true, timeout: 15000 }
        : { url: `http://127.0.0.1:${port}/sse?${qs}`, alwaysLoadTools: true, timeout: 15000 };
  }
  return out;
}

// Optional Streamable HTTP GET SSE stream (PR also widens STREAMABLE_HTTP_GET_SSE_FALLBACK_STATUSES).
// Optional methods answer in-band (fault=200) so only the GET status differs per row.
export const GET_MATRIX = [
  { name: 'g405', t: 'http', fault: 200, kind: 'm32601', get: 405, expect: 'keep', label: 'GET 405 (SDK-native unsupported)' },
  { name: 'g400', t: 'http', fault: 200, kind: 'm32601', get: 400, expect: 'keep', label: 'GET 400 (Spring AI, #4521 — already on main)' },
  { name: 'g404', t: 'http', fault: 200, kind: 'm32601', get: 404, expect: 'keep', label: 'GET 404 (no GET route, #8784 — already on main)' },
  { name: 'g422', t: 'http', fault: 200, kind: 'm32601', get: 422, expect: 'keep', label: 'GET 422 (new in this PR)' },
  { name: 'g501', t: 'http', fault: 200, kind: 'm32601', get: 501, expect: 'keep', label: 'GET 501 (new in this PR)' },
  { name: 'g403', t: 'http', fault: 200, kind: 'm32601', get: 403, expect: 'drop', label: 'GET 403 (control)' },
  { name: 'g500', t: 'http', fault: 200, kind: 'm32601', get: 500, expect: 'drop', label: 'GET 500 (control)' },
  { name: 'g503', t: 'http', fault: 200, kind: 'm32601', get: 503, expect: 'drop', label: 'GET 503 (control)' },
];
