# (id, description, [(old, new, expected_hits)]) -- anchors resolved by content in dist/
G1_OLD = 'if(req.path==="/health"||req.path==="/capabilities"||req.path==="/session"||req.path.startsWith("/session/"))next();else res.sendStatus(404)'
G2_OLD = 'app.use((req,res,next)=>{if(req.path==="/capabilities"||req.path==="/health")next();else res.sendStatus(404)})'
H_SRV = 'if(opts.profile==="hosted-harness")opts={...opts,requireAuth:true};'
H_RUN = 'requireAuth:optsIn.profile==="hosted-harness"?true:optsIn.requireAuth'
W_OLD = 'if(store.writerId!==contract.bootId){error2(res,409,"hosted_harness_generation_mismatch");return}'
E_OLD = 'entry=>entry?.role==="model"&&!!entry.parts?.some(part=>!!part.text)'
F_OLD = 'setHistory(history.filter((entry,index)=>entry.role==="user"?answered(history[index+1]):answered(entry)))'
L_OLD = 'skipFileCheckpointing:true,lenientToolWarmup:true});const authType=config.getModelsConfig()'

MUTANTS = [
    ('M0', 'no mutation (control)', []),
    ('D1', 'original defect 1: drop lenientToolWarmup', [(L_OLD, 'skipFileCheckpointing:true});const authType=config.getModelsConfig()', 1)]),
    ('D2', 'original defect 2: unfiltered setHistory(history)', [(F_OLD, 'setHistory(history)', 1)]),
    ('E', 'empty-answer filter removed (any model entry counts as answered)', [(E_OLD, 'entry=>entry?.role==="model"', 1)]),
    ('Eold', 'pre-#12713 filter: user kept iff next entry is model', [(F_OLD, 'setHistory(history.filter((entry,index)=>entry.role!=="user"||history[index+1]?.role==="model"))', 1)]),
    ('G1', 'pre-auth Hosted route gate removed', [(G1_OLD, 'next()', 1)]),
    ('G2', 'post-auth /session/ catch-all gate removed', [(G2_OLD, '', 1)]),
    ('G12', 'both Hosted route gates removed', [(G1_OLD, 'next()', 1), (G2_OLD, '', 1)]),
    ('H3', '/health auth forcing removed at all 3 sites', [(H_SRV, '', 1), (H_RUN, 'requireAuth:optsIn.requireAuth', 2)]),
    ('Hsrv', '/health auth forcing removed in createServeApp only', [(H_SRV, '', 1)]),
    ('Hrun', '/health auth forcing removed in runQwenServe only (2 sites)', [(H_RUN, 'requireAuth:optsIn.requireAuth', 2)]),
    ('W', 'Store writerId == bootId check removed', [(W_OLD, '', 1)]),
]
