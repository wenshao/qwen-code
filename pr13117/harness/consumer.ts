// VERIFICATION RIG ONLY (PR #13117): a typed consumer that reads the tenant refusal of each WebShell operation.
import type { operations } from './managed-agent-api';
export type webShellTranscriptRefusal = operations['webShellTranscript']['responses'][403]['content']['application/json']['error']['code'];
export type webShellStreamEventsRefusal = operations['webShellStreamEvents']['responses'][403]['content']['application/json']['error']['code'];
export type webShellSubmitTurnRefusal = operations['webShellSubmitTurn']['responses'][403]['content']['application/json']['error']['code'];
export type webShellCancelTurnRefusal = operations['webShellCancelTurn']['responses'][403]['content']['application/json']['error']['code'];
export type webShellQueryWorkspacesRefusal = operations['webShellQueryWorkspaces']['responses'][403]['content']['application/json']['error']['code'];
export type webShellGetWorkspaceRefusal = operations['webShellGetWorkspace']['responses'][403]['content']['application/json']['error']['code'];
export type webShellGetSessionRefusal = operations['webShellGetSession']['responses'][403]['content']['application/json']['error']['code'];
export type webShellListSessionsRefusal = operations['webShellListSessions']['responses'][403]['content']['application/json']['error']['code'];
