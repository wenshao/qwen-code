S = 'dist/chunks/server-KC74N2DY.js'
R = 'dist/chunks/run-qwen-serve-ST5CMY2R.js'
G1 = 'app.use((req,res,next)=>{if(req.path==="/health"||req.path==="/capabilities"||req.path==="/session"||req.path.startsWith("/session/"))next();else res.sendStatus(404)})'
G2 = 'app.use((req,res,next)=>{if(req.path==="/capabilities"||req.path==="/health")next();else res.sendStatus(404)})}const mutate'
A1 = 'if(opts.profile==="hosted-harness")opts={...opts,requireAuth:true};'
A2 = 'requireAuth:optsIn.profile==="hosted-harness"?true:optsIn.requireAuth'
MUTANTS = [
 ('M14+15', 'both private route gates removed', [(S, G1, 'void 0', 1), (S, G2, 'void 0}const mutate', 1)]),
 ('M18x', 'requireAuth forcing removed at all three sites', [(S, A1, '', 1), (R, A2, 'requireAuth:optsIn.requireAuth', 2)]),
]
MUTANTS.append(('M20', 'ACP HTTP/WS surface enabled in hosted profile', [(S, 'const acpHttpEnabledAtBoot=opts.profile!=="hosted-harness"&&resolveAcpHttpEnabled(', 'const acpHttpEnabledAtBoot=resolveAcpHttpEnabled(', 1)]))
