// Count vi.waitFor calls in a test file, split by whether they pass an
// explicit options/timeout argument. Usage: node count-waitfor.cjs <file> [label]
const ts = require('typescript');
const fs = require('fs');
const [file, label] = process.argv.slice(2);
const src = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
const out = { explicit: 0, defaulted: [] };
(function walk(n) {
  if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) &&
      n.expression.expression.getText() === 'vi' && n.expression.name.text === 'waitFor') {
    const line = src.getLineAndCharacterOfPosition(n.getStart()).line + 1;
    if (n.arguments.length >= 2) out.explicit++; else out.defaulted.push(line);
  }
  ts.forEachChild(n, walk);
})(src);
console.log(JSON.stringify({ label, explicit: out.explicit, defaulted: out.defaulted.length, defaultedLines: out.defaulted }));
