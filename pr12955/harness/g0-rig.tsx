// VERIFICATION RIG ONLY (untracked): managed Web Shell against the local G0 Spring rig.
import { createRoot } from 'react-dom/client';
import { ManagedAgentWebShell } from '../../ManagedAgentWebShell';

const params = new URLSearchParams(window.location.search);
createRoot(document.getElementById('root')!).render(
  <ManagedAgentWebShell
    baseUrl={window.location.origin}
    productScope="t-g0:alice"
    getHeaders={() => ({ 'X-Qwen-Tenant-Id': 't-g0', 'X-Rig-Actor': 'alice' })}
    enableWorkspaceBinding
    sessionId={params.get('session') ?? undefined}
    theme={(params.get('theme') as never) ?? undefined}
    language="en"
  />,
);
