// VERIFICATION RIG ONLY (untracked, PR #13037): Managed WebShell against the
// local Spring rig. Query: ?session=<id>&actor=<actor>&theme=light&save=opfs|none
//   save=opfs  replaces only the native save-file dialog (which headless
//              automation cannot click) with an Origin Private File System
//              handle; the bundled browserArtifactSave path and the browser's
//              FileSystemWritableFileStream are otherwise unchanged.
//   save=none  removes showSaveFilePicker to model a browser without it.
import { createRoot } from 'react-dom/client';
import { ManagedAgentWebShell } from '../../ManagedAgentWebShell';

const params = new URLSearchParams(window.location.search);
const actor = params.get('actor') ?? 'alice';
const tenant = params.get('tenant') ?? 't-o3';
const rig = {
  blobs: 0,
  blobBytes: 0,
  maxBlob: 0,
  objectUrls: 0,
  saves: [] as Array<{ name: string }>,
  requests: [] as Array<{ url: string; range: string | null; ifMatch: string | null; auth: string | null; status?: number; aborted?: boolean }>,
};
(window as unknown as { __rig: typeof rig }).__rig = rig;

const NativeBlob = window.Blob;
window.Blob = class extends NativeBlob {
  constructor(parts?: BlobPart[], options?: BlobPropertyBag) {
    super(parts, options);
    rig.blobs += 1;
    rig.blobBytes += this.size;
    rig.maxBlob = Math.max(rig.maxBlob, this.size);
  }
} as typeof Blob;
const nativeCreate = URL.createObjectURL.bind(URL);
URL.createObjectURL = (value: Blob | MediaSource) => {
  rig.objectUrls += 1;
  return nativeCreate(value);
};

const nativeFetch = window.fetch.bind(window);
window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!url.includes('/artifacts/') || !url.includes('/content')) return nativeFetch(input, init);
  const headers = new Headers(init?.headers);
  const entry: (typeof rig.requests)[number] = {
    url: url.replace(/^.*\/v1\/agents/, '/v1/agents').slice(0, 200),
    range: headers.get('range'),
    ifMatch: headers.get('if-match'),
    auth: headers.get('x-rig-actor'),
  };
  rig.requests.push(entry);
  init?.signal?.addEventListener('abort', () => {
    entry.aborted = true;
  });
  const response = await nativeFetch(input, init);
  entry.status = response.status;
  return response;
};

const save = params.get('save');
if (save === 'opfs') {
  (window as unknown as { showSaveFilePicker: unknown }).showSaveFilePicker = async (options: { suggestedName: string }) => {
    const root = await navigator.storage.getDirectory();
    rig.saves.push({ name: options.suggestedName });
    return root.getFileHandle(options.suggestedName, { create: true });
  };
} else if (save === 'none') {
  delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker;
}

createRoot(document.getElementById('root')!).render(
  <ManagedAgentWebShell
    baseUrl={window.location.origin}
    productScope={`${tenant}:${actor}`}
    getHeaders={() => ({ 'X-Qwen-Tenant-Id': tenant, 'X-Rig-Actor': actor })}
    enableWorkspaceBinding
    sessionId={params.get('session') ?? undefined}
    theme={(params.get('theme') as never) ?? undefined}
    language={(params.get('language') as never) ?? 'en'}
  />,
);
