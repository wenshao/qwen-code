import sys,glob,xml.etree.ElementTree as ET
for f in sorted(glob.glob(sys.argv[1]+'/TEST-*.xml')):
    r=ET.parse(f).getroot()
    print(f"{r.get('name').split('.')[-1]}: tests={r.get('tests')} failures={r.get('failures')} errors={r.get('errors')} skipped={r.get('skipped')} time={r.get('time')}")
    for tc in r.iter('testcase'):
        for k in ('failure','error'):
            e=tc.find(k)
            if e is not None: print(f"   {k.upper()} {tc.get('name')}: {(e.get('message') or '')[:260]}")
