# Writes loop variants next to head's built extensionManager.js (zzvariant-<k>.js) for variant-refresh.mjs.
D='/root/verify/pr13379/head/packages/core/dist/src/extension'
src=open(f'{D}/extensionManager.js').read()
start=src.index('        const batchSize = 4;\n'); end=src.index('        return extensions;\n', start)
orig=src[start:end]
LOAD="this.loadExtension({ extensionDir: path.join(extensionsDir, subdir), workspaceDir }, options)"
def pool(n): return f"""        const settled = new Array(subdirs.length);
        let next = 0, stop = false;
        const worker = async () => {{
            while (!stop && next < subdirs.length) {{
                const i = next++; const subdir = subdirs[i];
                try {{ settled[i] = {{ status: 'fulfilled', value: await {LOAD} }}; }}
                catch (reason) {{ settled[i] = {{ status: 'rejected', reason }}; stop = true; }}
            }}
        }};
        await Promise.all(Array.from({{ length: Math.min({n}, subdirs.length) }}, worker));
        for (const result of settled) {{
            if (!result) continue;
            if (result.status === 'rejected') throw result.reason;
            if (result.value != null) extensions.push(result.value);
        }}
"""
V={'batch1':orig.replace('batchSize = 4','batchSize = 1'),'batch4':orig,'batch8':orig.replace('batchSize = 4','batchSize = 8'),'batch16':orig.replace('batchSize = 4','batchSize = 16'),'pool4':pool(4),'pool8':pool(8)}
for k,v in V.items():
    open(f'{D}/zzvariant-{k}.js','w').write(src[:start]+v+src[end:])
