# Writes mutant copies of contextCommand.ts (+ a copy of the PR's test that
# imports the mutant) as untracked files beside the original.
import pathlib, re, sys
d = pathlib.Path('/root/verify/pr13390/head/packages/cli/src/ui/commands')
src = (d/'contextCommand.ts').read_text()
test = (d/'contextCommand.test.ts').read_text()
EST = "detailMcpTools = scaleTokens(mcpTools, mcpDetailShare);"
PROV = "detailMcpTools = scaleTokens(mcpTools, scale * mcpDetailShare);"
ROUND = "tokens: Math.round(item.tokens * factor),"
FIRST = """const firstTakesAll = <T extends { tokens: number }>(items: T[], total: number): T[] =>
    items.map((item, i) => ({ ...item, tokens: i === 0 ? total : 0 }));
  """
mutants = {
  'm0': [],  # unmutated control
  # sum-preserving: first row carries the whole category, the rest are 0
  'm1': [(EST, "detailMcpTools = mcpDetailShare < 1 ? firstTakesAll(mcpTools, clampedMcpTools) : mcpTools;"),
         (PROV, "detailMcpTools = scale * mcpDetailShare < 1 ? firstTakesAll(mcpTools, Math.floor(clampedMcpTools * scale)) : mcpTools;"),
         ("  if (!hasTokenCount) {\n    totalTokens = 0;", "  " + FIRST + "if (!hasTokenCount) {\n    totalTokens = 0;")],
  'm2': [(ROUND, "tokens: Math.ceil(item.tokens * factor),")],
  'm3': [(PROV, "detailMcpTools = scaleTokens(mcpTools, mcpDetailShare);")],  # drop overhead scale on provider path
  'm4': [(PROV, "detailMcpTools = scaleTokens(mcpTools, scale);")],          # provider path back to base
  'm5': [(EST, "detailMcpTools = mcpTools;")],                                # estimate path back to base
}
for name, edits in mutants.items():
    s = src
    for a, b in edits:
        assert s.count(a) == 1, (name, a)
        s = s.replace(a, b)
    (d/f'contextCommand.{name}.ts').write_text(s)
    t = test.replace("from './contextCommand.js';", f"from './contextCommand.{name}.js';")
    assert t != test
    extra = pathlib.Path(sys.argv[1]).read_text() if len(sys.argv) > 1 else ''
    if extra:
        # append the probe cases inside the 'category identity' describe
        marker = "    it('bills a path-activation envelope folded into a tool response as messages (#12235)'"
        assert t.count(marker) == 1
        t = t.replace(marker, extra + "\n" + marker)
    (d/f'contextCommand.{name}.test.ts').write_text(t)
print('ok', list(mutants))
