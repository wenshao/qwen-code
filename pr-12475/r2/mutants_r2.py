# Round-2 mutants: guards added at 4d3e7255a5 (autofix round 1), absent from the round-1 matrix.
CB = 'packages/channels/base/src/ChannelBase.ts'
GH = 'packages/channels/github/src/GithubAdapter.ts'
GL = 'packages/channels/gitlab/src/GitlabAdapter.ts'
BASE_SUITE = ('packages/channels/base', ['src/ChannelBase.test.ts'])
GH_SUITE = ('packages/channels/github', ['src/GithubAdapter.test.ts'])
GL_SUITE = ('packages/channels/gitlab', ['src/GitlabAdapter.test.ts'])
MUTANTS = [
  ('M20', CB, "    if (target.isGroup && this.groupSenderGate && authorized.length === 0) {\n      return false;\n    }\n", "", BASE_SUITE, 'R1-1: empty allowedUsers means unrestricted for decoupled group targets'),
  ('M21', CB, "      this.logPreflightRejected(\n        senderGate === this.gate ? 'sender_denied' : 'group_sender_denied',\n      );", "      this.logPreflightRejected('sender_denied');", BASE_SUITE, 'R1-13: preflight rejection logs one reason for both axes'),
  ('M22', GH, "    if (this.config.allowedGroupUsers) {\n      const allowedGroup = this.config.allowedGroupUsers.map((u) =>\n        u.toLowerCase(),\n      );\n      this.config.allowedGroupUsers = allowedGroup;\n      this.groupSenderGate?.replaceAllowedUsers(allowedGroup);\n    }\n", "", GH_SUITE, 'R1-2: GitHub connect() drops allowedGroupUsers normalization'),
  ('M23', GL, "    if (this.config.allowedGroupUsers) {\n      const allowedGroup = this.config.allowedGroupUsers.map((u) =>\n        u.toLowerCase(),\n      );\n      this.config.allowedGroupUsers = allowedGroup;\n      this.groupSenderGate?.replaceAllowedUsers(allowedGroup);\n    }\n", "", GL_SUITE, 'R1-2: GitLab connect() drops allowedGroupUsers normalization'),
]
