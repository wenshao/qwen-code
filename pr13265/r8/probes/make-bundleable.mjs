// Turns the round-2/3 supervisor probes into bundleable copies: each
// `await import(`${DIST}/core|cli/...`)` becomes a static-string dynamic
// import through the build-bundles aliases.
import fs from 'node:fs';
for (const name of ['l1-supervisor', 'l13-fast-start', 'l14-terminate-race']) {
  let s = fs.readFileSync(`${name}.mjs`, 'utf8');
  const before = (s.match(/\$\{DIST\}/g) ?? []).length;
  s = s.replace(/import\(`\$\{DIST\}\/core\/([^`]+)`\)/g, "import('@qwen-code/qwen-code-core/$1')")
       .replace(/import\(`\$\{DIST\}\/cli\/([^`]+)`\)/g, "import('@armcli/$1')");
  const left = (s.match(/import\(`\$\{DIST\}/g) ?? []).length;
  if (left) throw new Error(`${name}: ${left} dynamic DIST imports left`);
  fs.writeFileSync(`b-${name}.mjs`, s);
  console.log(`b-${name}.mjs (${before} DIST refs before)`);
}
