# Candidate for round 6: make the resume helper walk tools/disallowedTools the way launch does.
import sys
root = sys.argv[1] + '/packages/core/src/'
def patch(path, a, b):
    p = root + path; s = open(p).read(); assert s.count(a) == 1, (path, a[:70]); open(p, 'w').write(s.replace(a, b))
patch('agents/background-agent-resume.ts', """  const tools = subagentConfig?.tools;
  // Nullish has to stay on the wildcard path: launch reads `config.tools?.length`,
  // which is falsy for both `undefined` and `null`.
  if (tools != null && !Array.isArray(tools)) {
    return false;
  }
  const disallowedTools = subagentConfig?.disallowedTools;
  return toolConfigAllowsSkill(
    {
      tools: tools?.length ? tools : ['*'],""", """  // Mirror launch exactly: it reads `config.tools?.length` (falsy for
  // `undefined`, `null` and `""`, which take the wildcard) and hands the value
  // to `resolveToolNames`, whose `for...of` walks a string one character at a
  // time and keeps unmatched entries as-is. So `"*"` launches as `['*']` (the
  // wildcard) and `"read_file"` as nine unregistered one-character names.
  // `Array.from` performs the same walk for arrays and strings alike.
  const tools = subagentConfig?.tools;
  const disallowedTools = subagentConfig?.disallowedTools;
  return toolConfigAllowsSkill(
    {
      tools: tools?.length ? Array.from(tools) : ['*'],""")
patch('agents/background-agent-resume.ts', """      disallowedTools: Array.isArray(disallowedTools)
        ? disallowedTools
        : undefined,""", """      disallowedTools: disallowedTools?.length
        ? Array.from(disallowedTools)
        : undefined,""")
patch('agents/background-agent-resume.test.ts', """    [
      'declares a non-array disallowedTools value',
      { disallowedTools: ToolNames.SKILL },
      true,
    ],""", """    [
      'declares a non-array disallowedTools value',
      { disallowedTools: ToolNames.SKILL },
      true,
    ],
    // Launch walks a scalar per character and keeps unmatched entries, so
    // `"*"` launches as the wildcard and `""` takes the wildcard path: both
    // keep the SkillManager, so resume must keep the listing.
    ['declares a scalar wildcard tools value', { tools: '*' }, true],
    ['declares an empty-string tools value', { tools: '' }, true],""")
print('candidate r6 applied')
