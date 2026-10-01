# Round 2 mutants for a8beb51cd5 (run from packages/cli/src/utils of the head2 checkout, AFTER the build:
# __mut__ must never coexist with tsc/copy_files). Then: npx vitest run src/utils/__mut__ --reporter=json ...
# m0xx = R1 mutants re-targeted at the new source; n1xx = mutants of the new identical-copy cleanup.
import os
src = open('write-with-backup.ts').read()
test = open('write-with-backup.test.ts').read().replace("'../config/", "'../../../config/")
base = open(os.environ['BASE_WRITER']).read()      # base 78143fe335 writeWithBackup.ts
r1head = open(os.environ['R1_WRITER']).read()       # d0be922868 write-with-backup.ts (pre-fix)
M = {'m000_control': src, 'm001_base_writer': base, 'n100_r1_head_writer': r1head}
def rep(name, old, new):
    assert old in src, name
    M[name] = src.replace(old, new, 1)
rep('m002_rename_away', "fs.copyFileSync(targetPath, backupPath, fs.constants.COPYFILE_EXCL);", "fs.renameSync(targetPath, backupPath);")
rep('m003_auto_restore', "    if (recoveryRetained) {\n      throw new Error(", "    if (recoveryRetained) {\n      try { fs.renameSync(backupPath, targetPath); } catch {}\n      throw new Error(")
rep('m004_shared_workdir', "const workingDirectory = fs.mkdtempSync(`${targetPath}.write-`);", "const workingDirectory = `${targetPath}.write-shared`;\n  fs.mkdirSync(workingDirectory, { recursive: true });")
CLEAN = "  try {\n    fs.rmSync(workingDirectory, { recursive: true, force: true });\n  } catch {\n    // Publication already succeeded; leftover artifacts do not invalidate it.\n  }"
rep('m006_cleanup_error_rethrown', CLEAN, "  fs.rmSync(workingDirectory, { recursive: true, force: true });")
rep('m007_no_success_cleanup', CLEAN, "")
rep('m008_delete_recovery_copy', "      if (recoveryRetained) {\n        fs.unlinkSync(tempPath);\n      } else {", "      if (false) {\n        fs.unlinkSync(tempPath);\n      } else {")
rep('m011_no_failure_cleanup', "        fs.rmSync(workingDirectory, { recursive: true, force: true });\n      }\n    } catch {", "      }\n    } catch {")
rep('m013_recovery_path_not_reported', "`Recovery copy retained at '${backupPath}'; inspect the current target before restoring it.`", "`Recovery copy retained.`")
rep('m014_backup_optional_on_copy_error', "      } catch (backupError) {\n        throw new Error(", "      } catch (backupError) {\n        if (Math.random() > 2) throw new Error(")
rep('m015_default_encoding_ignored', "fs.writeFileSync(tempPath, content, { encoding,", "fs.writeFileSync(tempPath, content, { encoding: 'utf-8',")
FIX = "const recoveryRetained =\n      backupCreated && !sameContents(backupPath, targetPath);"
rep('n101_revert_fix_keep_every_copy', FIX, "const recoveryRetained = backupCreated;")
rep('n102_always_identical', "return fs.readFileSync(first).equals(fs.readFileSync(second));", "return true;")
rep('n103_unreadable_counts_as_identical', "  } catch {\n    return false;\n  }\n}", "  } catch {\n    return true;\n  }\n}")
rep('n104_compare_staged_not_backup', "!sameContents(backupPath, targetPath)", "!sameContents(tempPath, targetPath)")
rep('n105_identical_dir_left_behind', "      } else {\n        fs.rmSync(workingDirectory, { recursive: true, force: true });\n      }", "      } else {\n        fs.unlinkSync(tempPath);\n      }")
rep('n106_message_claims_removed_copy', "    if (recoveryRetained) {\n      throw new Error(", "    if (backupCreated) {\n      throw new Error(")
rep('n107_size_only_compare', "return fs.readFileSync(first).equals(fs.readFileSync(second));", "return fs.statSync(first).size === fs.statSync(second).size;")
rep('n108_compare_before_failure_ignores_copy_flag', FIX, "const recoveryRetained =\n      !sameContents(backupPath, targetPath);")
rep('n109_string_compare_utf8', "return fs.readFileSync(first).equals(fs.readFileSync(second));", "return fs.readFileSync(first, 'utf8') === fs.readFileSync(second, 'utf8');")
for name, body in M.items():
    d = os.path.join('__mut__', name); os.makedirs(d, exist_ok=True)
    open(os.path.join(d, 'write-with-backup.ts'), 'w').write(body)
    open(os.path.join(d, 'write-with-backup.test.ts'), 'w').write(test)
print(len(M), 'mutants')
