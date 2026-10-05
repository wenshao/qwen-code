// Pull the model-visible extension surface out of the recorded main request.
import fs from 'node:fs';
const [file] = process.argv.slice(2);
const reqs = fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const main = reqs.find((r) => r.body.stream && (r.body.tools?.length ?? 0) > 0) ?? reqs[0];
const text = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.map((p) => p.text ?? '').join('') : '');
const sys = main.body.messages.filter((m) => m.role === 'system').map((m) => text(m.content)).join('\n');
const all = main.body.messages.map((m) => text(m.content)).join('\n');
const ctx = [...all.matchAll(/CTX-MARKER (\S+) \(([^)]+)\)/g)].map((m) => `${m[1]} ${m[2]}`);
const toolsJson = JSON.stringify(main.body.tools);
const skills = [...(all + toolsJson.replace(/\\\\n/g, '\n')).matchAll(/<name>\n([^<]+?)\n<\/name>/g)].map((m) => m[1].trim()).filter((n) => n.includes(':'));
const agents = [...toolsJson.matchAll(/- \*\*([a-z0-9-]+-agent-\d+)\*\*|([a-z0-9-]+-agent-\d+)/g)].map((m) => m[1] ?? m[2]);
const uniq = (a) => [...new Set(a)];
console.log(JSON.stringify({ requests: reqs.length, ctxMarkers: ctx, skillCount: skills.length, skillOwnersInOrder: uniq(skills.map((n) => n.split(':')[0])), dupeSkills: skills.filter((n) => n.startsWith('dupe:')), agentNames: uniq(agents).length, toolNames: main.body.tools.map((t) => t.function?.name) }, null, 1));
