// Minimal stand-in for api.github.com: enough for the GitHub channel adapter
// to authenticate, poll notifications and stay up, so a real daemon can hold
// a real channel worker while the TLS trust diagnostic is exercised.
import * as http from 'node:http';
const port = Number(process.argv[2]);
const server = http.createServer((req, res) => {
  const send = (code, body) => {
    const payload = JSON.stringify(body);
    res.writeHead(code, {
      'content-type': 'application/json',
      'x-poll-interval': '60',
    });
    res.end(payload);
  };
  if (req.url?.startsWith('/notifications')) return send(200, []);
  if (req.url === '/user') return send(200, { login: 'qwen-tls-fixture', id: 1, type: 'User' });
  if (req.url === '/') return send(200, { current_user_url: `http://127.0.0.1:${port}/user` });
  return send(200, {});
});
server.listen(port, '127.0.0.1', () => process.stdout.write(`fake-github ${port}\n`));
