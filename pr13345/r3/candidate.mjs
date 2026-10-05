// Candidate for be2c87bb: keep the hoisted sequence check for new commands,
// but let a retried command reach commit()'s replay first, as commit() itself
// orders it. Applies to a .ts source or the compiled .js.
import fs from 'node:fs';
const [file, kind] = process.argv.slice(2);
let t = fs.readFileSync(file, 'utf8');
const find = kind === 'js'
  ? `            this.assertExpectedSequence(command);\n            const previous = this.domainRecords.get(request.domain);`
  : `      this.assertExpectedSequence(command);\n      const previous = this.domainRecords.get(request.domain);`;
const pad = kind === 'js' ? '            ' : '      ';
const replace = `${pad}// A retried command replays inside commit(); its sequence is spent.\n${pad}if (\n${pad}  !this.transactions.has(\n${pad}    managedSessionCommandKey(command.operation, command.commandId),\n${pad}  )\n${pad}) {\n${pad}  this.assertExpectedSequence(command);\n${pad}}\n${pad}const previous = this.domainRecords.get(request.domain);`;
if (t.split(find).length !== 2) throw new Error('anchor');
t = t.replace(find, () => replace);
fs.writeFileSync(file, t);
console.log('patched', file);
