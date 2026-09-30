// VERIFICATION RIG ONLY: group thrown exceptions of a window by call path.
import fs from 'node:fs';
import { R, thrown } from './lib.mjs';
const [file, sinceIso, untilIso, ...classes] = process.argv.slice(2);
const until = Date.parse(untilIso);
const groups = new Map();
for (const e of (await thrown(classes, { sinceMs: Date.parse(sinceIso) })).filter((e) => e.ms <= until)) {
  const key = `${e.cls}|${e.message}|${e.frames.slice(0, 8).join(' <- ')}`;
  groups.set(key, (groups.get(key) ?? 0) + 1);
}
const paths = [...groups].map(([k, count]) => {
  const [cls, message, frames] = k.split('|');
  return { count, cls, message, frames: frames.split(' <- ') };
});
const json = JSON.parse(fs.readFileSync(`${R}/out/${file}`, 'utf8'));
json.thrownByPath = paths;
fs.writeFileSync(`${R}/out/${file}`, JSON.stringify(json, null, 2));
console.log(JSON.stringify(paths, null, 1));
