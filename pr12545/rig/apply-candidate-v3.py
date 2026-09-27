# Apply candidate v3 (exec credit under CodeModeOnly + tests) to a qwen-code tree at 318d8cdc.
import sys
root = sys.argv[1] + '/packages/core/src/'
def patch(path, reps):
    p = root + path; s = open(p).read()
    for a, b in reps:
        assert s.count(a) == 1, (path, a[:70])
        s = s.replace(a, b)
    open(p, 'w').write(s)

patch('agents/runtime/subagent-plan-tool-policy.ts', [
("""export function toolConfigAllowsSkill(
  toolConfig: ToolConfig | undefined,
): boolean {""", """export function toolConfigAllowsSkill(
  toolConfig: ToolConfig | undefined,
  codeModeOnly = false,
): boolean {"""),
("""  const inheritsRegistry = names.includes('*');
  return inheritsRegistry || names.includes(ToolNames.SKILL);
}""", """  const inheritsRegistry = names.includes('*');
  // Under CodeModeOnly, naming `exec` inherits every code-mode-callable
  // binding (`prepareTools()`), and `skill` is one of them.
  const reachesThroughExec = codeModeOnly && names.includes(ToolNames.EXEC);
  return (
    inheritsRegistry || names.includes(ToolNames.SKILL) || reachesThroughExec
  );
}"""),
])
patch('subagents/subagent-manager.ts', [
("      const skillsAvailable = toolConfigAllowsSkill(toolConfig);", """      const skillsAvailable = toolConfigAllowsSkill(
        toolConfig,
        runtimeContext.getToolMode?.() === ToolMode.CodeModeOnly,
      );"""),
("import { toolConfigAllowsSkill } from '../agents/runtime/subagent-plan-tool-policy.js';",
 "import { toolConfigAllowsSkill } from '../agents/runtime/subagent-plan-tool-policy.js';\nimport { ToolMode } from '../tools/code-mode.js';"),
])
patch('agents/runtime/agent-core.ts', [
("    return toolConfigAllowsSkill(this.toolConfig);", """    return toolConfigAllowsSkill(
      this.toolConfig,
      this.runtimeContext.getToolMode?.() === ToolMode.CodeModeOnly,
    );"""),
])
patch('agents/background-agent-resume.ts', [
("""function subagentWillHaveSkillTool(
  subagentConfig: SubagentConfig | undefined,
): boolean {
  const tools = subagentConfig?.tools;
  return toolConfigAllowsSkill({
    tools: tools?.length ? tools : ['*'],
    disallowedTools: subagentConfig?.disallowedTools,
  });""", """function subagentWillHaveSkillTool(
  subagentConfig: SubagentConfig | undefined,
  codeModeOnly = false,
): boolean {
  const tools = subagentConfig?.tools;
  return toolConfigAllowsSkill(
    {
      tools: tools?.length ? tools : ['*'],
      disallowedTools: subagentConfig?.disallowedTools,
    },
    codeModeOnly,
  );"""),
("""                includeAvailableSkillsReminder: subagentWillHaveSkillTool(
                  target.subagentConfig,
                ),""", """                includeAvailableSkillsReminder: subagentWillHaveSkillTool(
                  target.subagentConfig,
                  activeAgentConfig.getToolMode?.() === ToolMode.CodeModeOnly,
                ),"""),
("import { toolConfigAllowsSkill } from './runtime/subagent-plan-tool-policy.js';",
 "import { toolConfigAllowsSkill } from './runtime/subagent-plan-tool-policy.js';\nimport { ToolMode } from '../tools/code-mode.js';"),
])
anchor = """        const greatGrandchild = await launch({}, grandchild);
        expect(greatGrandchild.getSkillManager()).toBe(sessionManager);
        expect(greatGrandchild.getToolRegistry().getAllToolNames()).toContain(
          ToolNames.SKILL,
        );
      });
"""
patch('subagents/subagent-manager.test.ts', [(anchor, anchor + """
      // Under CodeModeOnly an explicit list naming `exec` inherits every
      // code-mode-callable binding, `skill` included, so the agent can load
      // skills through the exec gateway and must keep its manager. The parent
      // is a real CodeModeOnly Config: dropping the tool-mode argument at the
      // createAgentHeadless call site turns this case red.
      it('keeps the manager for an exec-only agent under CodeModeOnly', async () => {
        const codeModeParent = makeFakeConfig({ codeModeOnly: true });
        vi.spyOn(codeModeParent, 'getSkillManager').mockReturnValue(
          sessionManager,
        );
        vi.spyOn(codeModeParent, 'getSubagentManager').mockReturnValue(manager);
        vi.spyOn(codeModeParent, 'getToolRegistry').mockReturnValue(
          mockToolRegistry,
        );

        const context = await launch(
          { tools: [ToolNames.EXEC] },
          codeModeParent,
        );
        expect(context.getSkillManager()).toBe(sessionManager);
        expect(context.getToolRegistry().getAllToolNames()).toContain(
          ToolNames.SKILL,
        );
      });
""")])
anchor2 = """    ])('withholds skills for %s', (_label, toolConfig) => {
      expect(toolConfigAllowsSkill(toolConfig)).toBe(false);
    });
"""
patch('agents/runtime/subagent-plan-tool-policy.test.ts', [(anchor2, anchor2 + """
    it('credits the exec gateway only under CodeModeOnly', () => {
      const execList = { tools: [ToolNames.EXEC, ToolNames.READ_FILE] };
      expect(toolConfigAllowsSkill(execList, true)).toBe(true);
      expect(toolConfigAllowsSkill(execList, false)).toBe(false);
      expect(toolConfigAllowsSkill(execList)).toBe(false);
      expect(
        toolConfigAllowsSkill(
          { ...execList, disallowedTools: [ToolNames.SKILL] },
          true,
        ),
      ).toBe(false);
      expect(toolConfigAllowsSkill({ tools: [] }, true)).toBe(false);
    });
""")])
print('candidate v3 applied')
