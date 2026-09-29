import * as L from './lib.mjs';
const { d } = L;
L.openLog('s0-prepare');
const [bid, gen, hk] = d.sql("SELECT binding_id, runtime_generation, holder_key FROM managed_workspace_execution_lease WHERE holder_key IS NOT NULL")[0];
L.say(`held lease: binding ${bid} gen ${gen} holder ${hk.slice(0, 12)}…`);
L.sayMaint('s0-prepare-exact-holder', L.maint(['prepare', bid, gen, hk, 'INC-12977 escaped writer']));
L.say(L.bstr(L.binding(d.sql(`SELECT isolation_key FROM qwen_runtime_binding WHERE binding_id='${bid}'`)[0][0])));
L.say(L.astr());
