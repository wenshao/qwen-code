import json,sys
for d in sys.argv[1:]:
  r=json.load(open(d+'/result.json'))
  print('###',d,r['arm'],r['scenario'],'pt',r['promptTokensAfter'])
  for k in ('before','after'):
    x=r[k]; b=x['breakdown']
    print(f" {k:6} total={x['totalTokens']:>6} est={x['isEstimated']!s:5} MCProw={b['mcpTools']:>5} MCPdetailSum={x['mcpRowSum']:>5} diff={x['mcpRowSum']-b['mcpTools']:>5} | builtinRow={b['builtinTools']:>5} builtinDetailSum={x['builtinRowSum']:>5} | skills={b['skills']} msgs={b['messages']} unattr={b.get('unattributed')}")
    print('        rows', [(t['name'].split('__')[1],t['tokens']) for t in x['mcpRows']])
