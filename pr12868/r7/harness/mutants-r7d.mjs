// PR #12868 round 7, head 9cb9dc86e8: mutants of the lines commit 9cb9dc86e8
// adds, and new anchors for the mutants of 50fb28301e whose lines it rewrote.
const BROKER = 'packages/sdk-java/runtime-broker/src/main/java/com/alibaba/qwen/code/runtimebroker';
const SERVER = `${BROKER}/RuntimeBrokerHttpServer.java`;
const WORKER = 'packages/cli/src/serve/managed-runtime-provider-worker.ts';
const ADMITS = '      !workspaceAdmits(this.workspace, directory)\n';

export const superseded7d = new Set();
export const reanchored7d = {
  // the background check is back where mutant T9 first found it
  T9: { find: "            normalized['is_background'] === true", replace: '            false' },
  P7: { find: ADMITS, replace: '      false\n' },
  P8: { find: "      directory !== '' &&\n", replace: '' },
  P9: { find: ADMITS, replace: '      workspaceAdmits(this.workspace, directory)\n' },
};
export const round7d = [
  { id: 'Q1', suite: 'broker', file: SERVER, what: 'a provider execution left UNKNOWN is not reconciled over Broker HTTP',
    find: `                && (Integer.valueOf(3).equals(reference.get("runtimeProtocol"))
                        || ProviderRuntimeProtocol.isReference(reference))`,
    replace: '                && Integer.valueOf(3).equals(reference.get("runtimeProtocol"))' },
  { id: 'Q2', suite: 'ts', file: WORKER, what: 'the directory of a Shell call is not checked when the call is prepared',
    find: '    return super.validateToolParamValues(params) ?? this.outside(params);', replace: '    return super.validateToolParamValues(params);' },
  { id: 'Q3', suite: 'ts', file: WORKER, what: 'the directory of a Shell call is not checked again before it runs',
    find: '      if (refusal) throw new Error(refusal);\n', replace: '' },
  { id: 'Q4', suite: 'ts', file: WORKER, what: 'a relative directory is admitted',
    find: '  if (!path.isAbsolute(directory)) return false;\n', replace: '' },
  { id: 'Q5', suite: 'ts', file: WORKER, what: 'the directory is taken as written, links not followed',
    find: '    const real = fs.realpathSync.native(directory);', replace: '    const real = path.resolve(directory);' },
  { id: 'Q6', suite: 'ts', file: WORKER, what: 'a directory that cannot be resolved is admitted',
    find: `      .some((root) => isPathWithinRoot(real, fs.realpathSync.native(root)));
  } catch {
    return false;`,
    replace: `      .some((root) => isPathWithinRoot(real, fs.realpathSync.native(root)));
  } catch {
    return true;` },
];
