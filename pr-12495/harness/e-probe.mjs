const root = process.argv[2];
const ast = await import(root + '/packages/core/dist/src/utils/shellAstParser.js');
const leg = await import(root + '/packages/core/dist/src/utils/shellReadOnlyChecker.js');
for (const c of ["sed -n 's/a/b/p' file", "sed -e 's/a/b/' file", "sed -n -e 's/a/b/p' file", "sed --quiet -e 's/a/b/p' file", "sed --expression='s/a/b/' file", "sed -e 's/a/b/'"])
  console.log(c.padEnd(36), String(await ast.classifyShellCommandSafety(c)).padEnd(10), leg.isShellCommandReadOnly(c));
