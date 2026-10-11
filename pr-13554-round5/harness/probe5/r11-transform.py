"""Append print-only copies of the PR's two collected-capture tests to an arm's WorkspaceRecoveryStoreTest.

usage: r11-transform.py <head WorkspaceRecoveryStoreTest.java> <arm WorkspaceRecoveryStoreTest.java> <arm-label>
The copies replace the assertions with RESULT lines (error message, capture state, last error code, live pins),
so main and round-4 arms report what they do instead of stopping at the first failed assertion.
"""
import re, sys
head_src, arm_path, label = sys.argv[1:]
src = open(head_src).read()
out = []
for name in ('collectedResourceInvalidatesTheCapture', 'collectedPublicationObjectInvalidatesTheCapture'):
    m = re.search(r'    @Test\n    void ' + name + r'\(\) \{\n(.*?)\n    \}\n', src, re.S)
    body = m.group(1)
    body = re.sub(r'assertThatThrownBy\(\(\) -> (capture\.call\(.*?\))\)\s*\.hasMessageContaining\("resource_collected"\);',
                  r'String message;\n        try {\n            \1;\n            message = "no-error";\n'
                  r'        } catch (RuntimeException error) {\n            message = String.valueOf(error.getMessage());\n        }', body, flags=re.S)
    body = re.sub(r'\s*assertThat\(capture\.inspect\(\)\.path\("state"\).*?;', '', body, flags=re.S)
    body = re.sub(r'\s*assertThat\(capture\.inspect\(\)\.path\("lastErrorCode"\).*?;', '', body, flags=re.S)
    assert 'assert' not in body, body
    body += ('\n        long pins = jdbc.queryForObject("SELECT COUNT(*) FROM managed_workspace_recovery_session x"'
             '\n                + " JOIN managed_workspace_recovery_operation o ON o.operation_id = x.operation_id"'
             '\n                + " WHERE x.session_id = ? AND o.state IN (\'CAPTURING\', \'VERIFYING\')", Long.class, session);'
             '\n        System.out.println("RESULT arm=' + label + ' case=' + name + ' error=" + message.replace(\' \', \'_\')'
             '\n                + " state=" + capture.inspect().path("state").asText()'
             '\n                + " lastErrorCode=" + capture.inspect().path("lastErrorCode").asText() + " livePins=" + pins);')
    out.append('    @Test\n    void probeR11_' + name + '() {\n' + body + '\n    }\n')
arm = open(arm_path).read()
i = arm.rstrip().rfind('}')
arm = arm[:i] + '\n' + '\n'.join(out) + '}\n'
open(arm_path, 'w').write(arm)
print('appended', len(out), 'probe methods to', arm_path)
