# Each mutant: (id, file, old, new, suites, description). `old` must match exactly once.
CB = 'packages/channels/base/src/ChannelBase.ts'
GH = 'packages/channels/github/src/GithubAdapter.ts'
DWS = 'packages/channels/dws/src/dws-channel.ts'
CU = 'packages/cli/src/commands/channel/config-utils.ts'
ST = 'packages/cli/src/serve/channel-settings-store.ts'
BASE_SUITE = ('packages/channels/base', [])
GH_SUITE = ('packages/channels/github', [])
DWS_SUITE = ('packages/channels/dws', [])
CLI_CU = ('packages/cli', ['src/commands/channel/'])
CLI_ST = ('packages/cli', ['src/serve/channel-settings-store.test.ts', 'src/serve/channel-management-service.test.ts'])
MUTANTS = [
  ('M01', CB, "return isGroup && this.groupSenderGate ? this.groupSenderGate : this.gate;", "return this.gate;", BASE_SUITE, 'resolver never decouples (PR-listed mutant 1)'),
  ('M02', CB, "return isGroup && this.groupSenderGate ? this.groupSenderGate : this.gate;", "return this.groupSenderGate ?? this.gate;", BASE_SUITE, 'group axis leaks into DMs (PR-listed mutant 2)'),
  ('M03', CB, "      senderGate === this.gate &&\n      this.config.senderPolicy === 'pairing' &&", "      this.config.senderPolicy === 'pairing' &&", BASE_SUITE, 'preflight: deferred-pairing guard ignores decoupled axis'),
  ('M04', CB, ": this.senderGateFor(envelope.isGroup).isAllowed(\n            normalizedTarget.senderId,\n          )) &&", ": this.gate.isAllowed(normalizedTarget.senderId)) &&", BASE_SUITE, 'stored loop/proactive target authorization stays on DM axis'),
  ('M05', CB, "!this.senderGateFor(true).isAllowed(senderId)", "!this.gate.isAllowed(senderId)", BASE_SUITE, 'group-history RECORD filter stays on DM axis'),
  ('M06', CB, "this.senderGateFor(true).isAllowed(entry.senderId),", "this.gate.isAllowed(entry.senderId),", BASE_SUITE, 'group-history REPLAY filter stays on DM axis'),
  ('M07', CB, "config.allowedGroupUsers ?? [],", "config.allowedUsers ?? [],", BASE_SUITE, 'group allowlist reads allowedUsers'),
  ('M08', CB, "config.groupSenderPolicy === 'open' ||\n      config.groupSenderPolicy === 'allowlist'", "config.groupSenderPolicy !== undefined", BASE_SUITE, "any value (incl. 'inherit') builds a group gate"),
  ('M09', GH, "this.senderGateFor(true).isAllowed(senderId) ||", "this.gate.isAllowed(senderId) ||", GH_SUITE, 'GitHub comment lane stays on DM axis'),
  ('M10', GH, "this.senderGateFor(true).isAllowed(sender)", "this.gate.isAllowed(sender)", GH_SUITE, 'GitHub aggregate lane stays on DM axis'),
  ('M11', DWS, "const senderGate = this.senderGateFor(isGroup);\n    if (senderGate.isAllowed(delivery.senderId)) return 'allowed';", "const senderGate = this.gate;\n    if (senderGate.isAllowed(delivery.senderId)) return 'allowed';", DWS_SUITE, 'DWS redelivery eligibility stays on DM axis'),
  ('M12', DWS, "return senderGate === this.gate && this.config.senderPolicy === 'pairing'", "return this.config.senderPolicy === 'pairing'", DWS_SUITE, "DWS: decoupled group sender judged 'unknown' under DM pairing"),
  ('M13', CU, "    groupSenderPolicy: parseGroupSenderPolicy(name, rawConfig),\n", "", CLI_CU, 'settings.json groupSenderPolicy never reaches ChannelConfig'),
  ('M14', CU, "    allowedGroupUsers: parseAllowedGroupUsers(name, rawConfig),\n", "", CLI_CU, 'settings.json allowedGroupUsers never reaches ChannelConfig'),
  ('M15', CU, "  if (\n    typeof value !== 'string' ||\n    !GROUP_SENDER_POLICIES.has(", "  if (\n    false &&\n    !GROUP_SENDER_POLICIES.has(", CLI_CU, 'groupSenderPolicy validation disabled'),
  ('M16', CU, "if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {\n    throw new Error(\n      `Channel \"${channelName}\" field \"allowedGroupUsers\"", "if (false) {\n    throw new Error(\n      `Channel \"${channelName}\" field \"allowedGroupUsers\"", CLI_CU, 'allowedGroupUsers validation disabled'),
  ('M17', ST, "    groupSenderPolicy: new Set(['inherit', 'open', 'allowlist']),\n", "", CLI_ST, 'daemon store: groupSenderPolicy enum check removed'),
  ('M18', ST, "if (key === 'allowedUsers' || key === 'allowedGroupUsers') {", "if (key === 'allowedUsers') {", CLI_ST, 'daemon store: allowedGroupUsers array check removed'),
  ('M19', ST, "    groupSenderPolicy: new Set(['inherit', 'open', 'allowlist']),\n", "    groupSenderPolicy: new Set(['inherit', 'open', 'allowlist', 'pairing']),\n", CLI_ST, "daemon store accepts 'pairing'"),
]
