import { execFileSync } from 'node:child_process';
import * as L from './lib.mjs';
const h = await new L.Harness({ name: 'rss-idle', modelUrl: 'http://127.0.0.1:9/v1', brokerUrl: 'http://127.0.0.1:19848' }).start();
await L.sleep(3000);
const rss = () => Number(execFileSync('/bin/ps', ['-o', 'rss=', '-p', String(h.child.pid)], { encoding: 'utf8' }).trim()) / 1024;
console.log(`idle harness RSS after start: ${rss().toFixed(0)} MiB`);
await h.stop();
