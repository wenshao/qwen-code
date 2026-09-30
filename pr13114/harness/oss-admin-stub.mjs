// VERIFICATION RIG ONLY: stands in for the fake OSS admin port (18994) while the real OSS
// is used, so probes that read /state or clear faults keep working. Counters stay zero.
import http from 'node:http';
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(req.url.startsWith('/state')
    ? { versioning: 'n/a (real OSS)', acl: 'n/a', counters: { put: 0, putCreated: 0, putExists: 0, get: 0, versioning: 0, acl: 0, faults: 0 }, faults: [], objects: 0 }
    : []));
}).listen(18994, '127.0.0.1', () => console.log('oss admin stub on 127.0.0.1:18994'));
