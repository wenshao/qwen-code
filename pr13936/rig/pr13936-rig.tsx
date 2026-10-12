// PR 13936 rig host: the npm ManagedAgentWebShell embed, configured from the URL.
// ?tenant=rig&scope=rig:rig-actor&lang=en|zh-CN&sid=<session>; scope= (empty) => no productScope.
import { createRoot } from 'react-dom/client';
import { ManagedAgentWebShell } from '../../ManagedAgentWebShell';
import { WebShellThemeId } from '../../themeContext';

const q = new URLSearchParams(window.location.search);
const tenant = q.get('tenant') || 'rig';
const scope = q.has('scope') ? q.get('scope') || undefined : `${tenant}:rig-actor`;
createRoot(document.getElementById('root')!).render(
  <ManagedAgentWebShell
    baseUrl={window.location.origin}
    productScope={scope}
    getHeaders={() => ({ 'X-Qwen-Tenant-Id': tenant })}
    language={(q.get('lang') as 'en' | 'zh-CN') || 'en'}
    sessionId={q.get('sid') || undefined}
    theme={q.get('theme') === 'light' ? WebShellThemeId.Light : WebShellThemeId.Dark}
    className="bg-background text-foreground p-3 box-border"
    style={{ height: '100vh' }}
  />,
);
