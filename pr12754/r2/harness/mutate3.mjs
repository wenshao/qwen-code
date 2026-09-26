// Applies one exact-string mutant to WorkspaceRuntimeTransport.java; fails loudly if the target is absent.
import fs from 'node:fs';
const [file, orig, id] = process.argv.slice(2);
const src = fs.readFileSync(orig, 'utf8');
const M = {
  M1: ['        requireDirectory(session.getScope().getCanonicalCwd(), context.binding().getCwdRelative());\n', ''],
  M2: ['!directory.toRealPath().equals(directory))', '!directory.toRealPath().equals(directory.toRealPath()))'],
  M3: [' || !Files.isDirectory(directory, LinkOption.NOFOLLOW_LINKS)', ''],
  M4: ['!directory.startsWith(base) || ', ''],
  M5: [', LinkOption.NOFOLLOW_LINKS)', ')'],
};
const [from, to] = M[id];
if (!src.includes(from)) { console.error('TARGET MISSING ' + id); process.exit(2); }
fs.writeFileSync(file, src.replace(from, to));
console.log(id + ' applied');
