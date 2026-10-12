// VERIFICATION RIG ONLY (PR #13973): host page for the standalone ManagedAgentWebShell
// against the rig's real Spring. ?actor= ?tenant= ?presets=<json> ?lang= ?theme= ?session=
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ManagedAgentWebShell } from '../../ManagedAgentWebShell';

const query = new URLSearchParams(window.location.search);
const actor = query.get('actor') ?? 'alice';
const tenant = query.get('tenant') ?? 't13973';
const presets = query.get('presets') ? JSON.parse(query.get('presets')!) : undefined;

function Host() {
  const [sessionId, setSessionId] = useState<string | undefined>(query.get('session') ?? undefined);
  (window as unknown as { __rig: unknown }).__rig = { select: setSessionId, sessionId };
  return (
    <div style={{ height: '100vh', boxSizing: 'border-box' }}>
      <ManagedAgentWebShell
        baseUrl={window.location.origin}
        productScope={JSON.stringify([tenant, actor])}
        getHeaders={() => ({ 'X-Qwen-Tenant-Id': tenant, 'X-Qwen-Actor-Id': actor })}
        enableWorkspaceBinding
        {...({ modelPresets: presets } as object)}
        language={query.get('lang') === 'zh' ? 'zh-CN' : 'en'}
        theme={query.get('theme') === 'light' ? 'light' : 'dark'}
        sessionId={sessionId}
        onSessionChange={setSessionId}
        style={{ height: '100%' }}
      />
    </div>
  );
}
createRoot(document.getElementById('root')!).render(<Host />);
