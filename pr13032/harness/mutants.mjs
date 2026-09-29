import fs from 'node:fs';
const [,, kind, file] = process.argv;
let s = fs.readFileSync(file, 'utf8');
const before = s;
if (kind === 'M1') {
  s = s.replace('    @AfterEach\n    void restoreHarnessAvailability() {\n        harness.setAvailable(true);\n    }\n', '    void restoreHarnessAvailability() {\n        harness.setAvailable(true);\n    }\n');
} else if (kind === 'M4') {
  s = s.replace('    public void recoverExpiredTurns() {\n        if (!harness.isAvailable()) {\n            return;\n        }\n', '    public void recoverExpiredTurns() {\n');
}
if (s === before) throw new Error('mutant ' + kind + ' did not apply');
fs.writeFileSync(file, s);
console.log(kind, 'applied to', file.split('/').pop());
