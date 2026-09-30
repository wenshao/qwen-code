// Logs every filesystem event under a directory tree (inotify via fs.watch recursive), plus a final listing.
// usage: node tmp-watch.mjs <dir> <event log>
import { watch, appendFileSync, writeFileSync } from 'node:fs';
const [, , dir, log] = process.argv;
writeFileSync(log, '');
watch(dir, { recursive: true }, (type, name) => appendFileSync(log, `${Date.now()} ${type} ${name}\n`));
console.log(`watching ${dir}`);
process.on('SIGTERM', () => process.exit(0));
