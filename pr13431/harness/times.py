import sys, glob, xml.etree.ElementTree as ET
for a in sys.argv[1:]:
    for f in glob.glob(f'/root/pr13431-rig/out/{a}/failsafe-reports/TEST-*HostedWorkspaceToolTurnIT.xml'):
        for tc in ET.parse(f).getroot().iter('testcase'):
            status = 'FAIL' if tc.find('failure') is not None or tc.find('error') is not None else 'ok'
            print(f"{a:15s} {tc.get('name')[:58]:58s} {float(tc.get('time')):7.1f}s {status}")
