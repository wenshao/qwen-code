# Generates the targeted mutants used in the report (run from packages/cli/src/utils
# of a PR-head checkout, then: npx vitest run src/utils/__mut__ --reporter=json ...).
# Each mutant is its own copy of write-with-backup.ts plus the PR's test file,
# in an untracked __mut__/ directory; delete the directory afterwards.
import os
src = open('write-with-backup.ts').read()
test = open('write-with-backup.test.ts').read().replace("'../config/", "'../../../config/")
base = open(os.environ['BASE_WRITER']).read()  # base checkout's writeWithBackup.ts
M = {'m000_control': src, 'm001_base_writer': base}
def rep(name, old, new):
    assert old in src, name
    M[name] = src.replace(old, new, 1)
rep('m002_rename_away', "fs.copyFileSync(targetPath, backupPath, fs.constants.COPYFILE_EXCL);", "fs.renameSync(targetPath, backupPath);")
rep('m003_auto_restore', "    if (backupCreated) {\n      throw new Error(", "    if (backupCreated) {\n      try { fs.renameSync(backupPath, targetPath); } catch {}\n      throw new Error(")
rep('m004_shared_workdir', "const workingDirectory = fs.mkdtempSync(`${targetPath}.write-`);", "const workingDirectory = `${targetPath}.write-shared`;\n  fs.mkdirSync(workingDirectory, { recursive: true });")
rep('m005_no_wx_flag', "{ encoding, flag: 'wx', flush: true }", "{ encoding, flush: true }")
CLEAN = "  try {\n    fs.rmSync(workingDirectory, { recursive: true, force: true });\n  } catch {\n    // Publication already succeeded; leftover artifacts do not invalidate it.\n  }"
rep('m006_cleanup_error_rethrown', CLEAN, "  fs.rmSync(workingDirectory, { recursive: true, force: true });")
rep('m007_no_success_cleanup', CLEAN, "")
rep('m008_delete_recovery_copy', "      if (backupCreated) {\n        fs.unlinkSync(tempPath);\n      } else {", "      if (false) {\n        fs.unlinkSync(tempPath);\n      } else {")
rep('m009_no_directory_check', "  if (fs.existsSync(targetPath) && fs.statSync(targetPath).isDirectory()) {", "  if (false) {")
rep('m010_no_copyfile_excl', "fs.copyFileSync(targetPath, backupPath, fs.constants.COPYFILE_EXCL);", "fs.copyFileSync(targetPath, backupPath);")
rep('m011_no_failure_cleanup', "        fs.rmSync(workingDirectory, { recursive: true, force: true });\n      }\n    } catch {", "      }\n    } catch {")
rep('m012_no_flush', "{ encoding, flag: 'wx', flush: true }", "{ encoding, flag: 'wx' }")
rep('m013_recovery_path_not_reported', "`Recovery copy retained at '${backupPath}'; inspect the current target before restoring it.`", "`Recovery copy retained.`")
rep('m014_backup_optional_on_copy_error', "      } catch (backupError) {\n        throw new Error(", "      } catch (backupError) {\n        if (Math.random() > 2) throw new Error(")
rep('m015_default_encoding_ignored', "fs.writeFileSync(tempPath, content, { encoding,", "fs.writeFileSync(tempPath, content, { encoding: 'utf-8',")
for name, body in M.items():
    d = os.path.join('__mut__', name); os.makedirs(d, exist_ok=True)
    open(os.path.join(d, 'write-with-backup.ts'), 'w').write(body)
    open(os.path.join(d, 'write-with-backup.test.ts'), 'w').write(test)
