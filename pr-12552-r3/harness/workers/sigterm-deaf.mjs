// the PR's own fixture worker, but SIGTERM is ignored afterwards (a stuck worker)
import process from 'node:process';
await import(process.argv[2]);
process.removeAllListeners('SIGTERM');
process.on('SIGTERM', () => {});
