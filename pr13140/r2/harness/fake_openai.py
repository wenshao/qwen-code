# Minimal OpenAI-compatible fake: records every request; if the last user turn
# contains RUN-TOOL it asks for one shell call, otherwise it answers with text.
# usage: python3 fake_openai.py <port> <ledger.jsonl>
import json, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

PORT, LEDGER = int(sys.argv[1]), sys.argv[2]
COMMAND = ('echo tool-ran uid=$(id -u); '
           'python3 -c "import socket;s=socket.socket();s.settimeout(2);'
           'r=s.connect_ex((\'1.1.1.1\',53));print(\'fresh-ip-connect\',r)"')


def chunk(delta, finish=None, usage=None):
    body = {'id': 'c1', 'object': 'chat.completion.chunk', 'created': 0, 'model': 'fake-model',
            'choices': [{'index': 0, 'delta': delta, 'finish_reason': finish}]}
    if usage:
        body['usage'] = usage
    return ('data: ' + json.dumps(body) + '\n\n').encode()


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def do_POST(self):
        req = json.loads(self.rfile.read(int(self.headers['content-length'])))
        with open(LEDGER, 'a') as f:
            f.write(json.dumps(req) + '\n')
        msgs = req.get('messages', [])
        last = msgs[-1] if msgs else {}
        text = last.get('content') if isinstance(last.get('content'), str) else json.dumps(last.get('content'))
        usage = {'prompt_tokens': 10, 'completion_tokens': 2, 'total_tokens': 12}
        if last.get('role') == 'user' and 'RUN-TOOL' in (text or ''):
            parts = [chunk({'role': 'assistant', 'tool_calls': [{'index': 0, 'id': 'call_1', 'type': 'function',
                     'function': {'name': 'run_shell_command',
                                  'arguments': json.dumps({'command': COMMAND, 'description': 'probe'})}}]}),
                     chunk({}, 'tool_calls', usage)]
        else:
            parts = [chunk({'role': 'assistant', 'content': 'done'}), chunk({}, 'stop', usage)]
        if not req.get('stream'):
            msg = {'role': 'assistant', 'content': 'done'}
            body = json.dumps({'id': 'c1', 'object': 'chat.completion', 'created': 0, 'model': 'fake-model',
                               'choices': [{'index': 0, 'message': msg, 'finish_reason': 'stop'}], 'usage': usage}).encode()
            self.send_response(200); self.send_header('content-type', 'application/json')
            self.send_header('content-length', str(len(body))); self.end_headers(); self.wfile.write(body)
            return
        self.send_response(200)
        self.send_header('content-type', 'text/event-stream')
        self.end_headers()
        for p in parts:
            self.wfile.write(p)
        self.wfile.write(b'data: [DONE]\n\n')


ThreadingHTTPServer(('127.0.0.1', PORT), H).serve_forever()
