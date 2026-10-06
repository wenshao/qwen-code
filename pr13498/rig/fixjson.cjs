// Shared rewrite helper: JSON with non-ASCII escaped as lowercase \uXXXX, then prettier.
const fs = require('fs');
const { execFileSync } = require('child_process');
exports.write = (file, value) => {
  const text = JSON.stringify(value, null, 2).replace(/[\u007f-￿]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
  fs.writeFileSync(file, text + '\n');
  execFileSync('npx', ['prettier', '--write', file], { stdio: 'ignore' });
};
exports.read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
