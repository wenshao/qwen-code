"""pr13335 rig driver helpers (stdlib only)."""
import json, time, urllib.request, urllib.error, uuid, subprocess

TENANT = 'pr13335'
MYSQL = '/Users/wenshao/Install/mysql-8.4.7-macos15-arm64/bin/mysql'
SOCK = '/Users/wenshao/pr13335-rig/my/mysql.sock'


def meta(tag):
    out = {}
    for line in open(f'/Users/wenshao/pr13335-rig/runs/{tag}/meta.env'):
        k, _, v = line.strip().partition('=')
        out[k] = v
    return out


def call(method, url, body=None, headers=None, timeout=600):
    data = None
    h = {'X-Qwen-Tenant-Id': TENANT}
    if body is not None:
        data = body if isinstance(body, (bytes, bytearray)) else json.dumps(body, ensure_ascii=False).encode('utf-8')
        h['Content-Type'] = 'application/json'
    h.update(headers or {})
    req = urllib.request.Request(url, data=data, method=method, headers=h)
    t0 = time.time()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            status = r.status
    except urllib.error.HTTPError as e:
        raw = e.read()
        status = e.code
    except Exception as e:  # connection reset etc.
        return {'status': None, 'error': repr(e), 'elapsed': round(time.time() - t0, 3)}
    try:
        payload = json.loads(raw)
    except Exception:
        payload = raw[:500].decode('utf-8', 'replace')
    return {'status': status, 'body': payload, 'elapsed': round(time.time() - t0, 3)}


def create_public(S, blocks, key=None):
    return call('POST', f'{S}/v1/agents/sessions',
                {'agent_id': 'qwen-code', 'input': blocks},
                {'Idempotency-Key': key or f'k-{uuid.uuid4()}'})


def submit_public(S, sid, blocks, key=None):
    return call('POST', f'{S}/v1/agents/sessions/{sid}/events',
                {'type': 'agent.session.input.message', 'input': blocks},
                {'Idempotency-Key': key or f'k-{uuid.uuid4()}'})


def ws(S, path, body):
    return call('POST', f'{S}/api/agent/web-shell/v1/{path}', body)


def ws_create(S, blocks=None, metadata=None, title=None):
    body = {'requestId': f'r-{uuid.uuid4().hex[:12]}', 'idempotencyKey': f'k-{uuid.uuid4()}',
            'agentId': 'qwen-code'}
    if blocks is not None:
        body['input'] = blocks
    if metadata is not None:
        body['metadata'] = metadata
    if title is not None:
        body['title'] = title
    return ws(S, 'sessions/create', body)


def ws_submit(S, sid, blocks, metadata=None):
    body = {'requestId': f'r-{uuid.uuid4().hex[:12]}', 'idempotencyKey': f'k-{uuid.uuid4()}',
            'sessionId': sid, 'input': blocks}
    if metadata is not None:
        body['metadata'] = metadata
    return ws(S, 'turns/submit', body)


def events(S, sid):
    r = call('GET', f'{S}/v1/agents/sessions/{sid}/events?after=0&limit=1000')
    b = r.get('body')
    return b.get('data', []) if isinstance(b, dict) else []


TERMINAL = ('turn.completed', 'turn.failed', 'turn.cancelled')


def wait_terminal(S, sid, timeout=120, count=1):
    t0 = time.time()
    while time.time() - t0 < timeout:
        evs = events(S, sid)
        term = [e for e in evs if e.get('type') in TERMINAL]
        if len(term) >= count:
            return term, round(time.time() - t0, 2), evs
        time.sleep(0.25)
    return None, round(time.time() - t0, 2), events(S, sid)


def sql(db, q):
    out = subprocess.run([MYSQL, '-uroot', '-S', SOCK, '-N', '-B', db, '-e', q],
                         capture_output=True, text=True)
    return out.stdout.strip() + (('\nERR ' + out.stderr.strip()) if out.returncode else '')


def blocks_of(n, size, ch='a'):
    text = ch * size
    return [{'type': 'input_text', 'text': text} for _ in range(n)]
