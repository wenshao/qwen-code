#!/usr/bin/env python3
"""Apply one named mutant to a pristine copy. Usage: mutants.py <id> | --list"""
import hashlib, sys, pathlib

SP = pathlib.Path(__file__).resolve().parent
SRC = SP / "ms/app/src/main/java/com/qwen/mobileshell"
NFP, MA = "NativeFilePicker.kt", "MainActivity.kt"

M = [
    # id, file, description, old, new
    ("M00", None, "pristine control", None, None),
    # --- NativeFilePicker.open()
    ("C01", NFP, "open() ignores the in-flight flag", "if (awaitingResult || !isCurrent() ||", "if (!isCurrent() ||"),
    ("C02", NFP, "open() ignores isCurrent()", "if (awaitingResult || !isCurrent() ||", "if (awaitingResult ||"),
    ("C03", NFP, "open() accepts any mode (MODE_SAVE)", " || params.mode !in listOf(FileChooserParams.MODE_OPEN, FileChooserParams.MODE_OPEN_MULTIPLE)) {", ") {"),
    ("C04", NFP, "refusal path returns false (R2-2)", "callback.onReceiveValue(null)\n            return true\n        }", "callback.onReceiveValue(null)\n            return false\n        }"),
    ("C05", NFP, "intent type always */* (single MIME hint lost)", 'type = if (types.size == 1) types.single() else "*/*"', 'type = "*/*"'),
    ("C06", NFP, "EXTRA_MIME_TYPES never set", "if (types.size > 1) putExtra(Intent.EXTRA_MIME_TYPES, types.toTypedArray())", ""),
    ("C07", NFP, "EXTRA_ALLOW_MULTIPLE forced false", "putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple)", "putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false)"),
    ("C08", NFP, "launch intent loses FLAG_GRANT_READ", "            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)\n        }", "        }"),
    ("C09", NFP, "SecurityException launch catch removed (R2-1)", "        } catch (_: SecurityException) {\n            launchFailed()\n        }\n", "        }\n"),
    ("C10", NFP, "launchFailed() keeps the slot", "    private fun launchFailed() {\n        awaitingResult = false\n", "    private fun launchFailed() {\n"),
    # --- cancel()/result()
    ("C11", NFP, "cancel() releases the slot early", "        val request = pending\n        pending = null\n        // The OS", "        val request = pending\n        pending = null\n        awaitingResult = false\n        // The OS"),
    ("C12", NFP, "result() ignores isCurrent()", "code == Activity.RESULT_OK && request.isCurrent()", "code == Activity.RESULT_OK"),
    ("C13", NFP, "result() ignores the result code", "if (code == Activity.RESULT_OK && request.isCurrent())", "if (request.isCurrent())"),
    ("C14", NFP, "result() RuntimeException catch removed", "try { validateResult(data, request.multiple) } catch (_: RuntimeException) { null }", "validateResult(data, request.multiple)"),
    # --- validateResult()
    ("C15", NFP, "validateResult() always null (feature dead)", "if (data == null || data.flags and", "if (true || data == null || data.flags and"),
    ("C16", NFP, "result grant-flag check removed", "if (data == null || data.flags and Intent.FLAG_GRANT_READ_URI_PERMISSION == 0) return null", "if (data == null) return null"),
    ("C17", NFP, "clip.itemCount > 100 cap removed", "        if (clip != null && clip.itemCount > 100) return null\n", ""),
    ("C18", NFP, "uris.size > 100 cap removed", "uris.isEmpty() || uris.size > 100 ||", "uris.isEmpty() ||"),
    ("C19", NFP, "both 100 caps removed", "        if (clip != null && clip.itemCount > 100) return null\n", "", ("uris.isEmpty() || uris.size > 100 ||", "uris.isEmpty() ||")),
    ("C20", NFP, "result data.data ignored", "            data.data?.let(::add)\n", ""),
    ("C21", NFP, "null clip item skipped instead of rejecting", "add(clip.getItemAt(index).uri ?: return null)", "clip.getItemAt(index).uri?.let(::add)"),
    ("C22", NFP, "dedupe removed", "        }.distinct()\n", "        }\n"),
    ("C23", NFP, "empty-selection check removed", "if (uris.isEmpty() || uris.size", "if (uris.size"),
    ("C24", NFP, "single-mode cardinality check removed", "(!multiple && uris.size != 1)", "false"),
    ("C25", NFP, "content-scheme check removed", 'uri.scheme != "content" || uri.authority', "uri.authority"),
    ("C26", NFP, "blank-authority check removed", 'if (uri.scheme != "content" || uri.authority.isNullOrBlank()) return null', 'if (uri.scheme != "content") return null'),
    ("C27", NFP, "own-UID provider check removed", "            if (provider.applicationInfo.uid == context.applicationInfo.uid) return null\n", ""),
    ("C28", NFP, "checkUriPermission check removed", "            if (context.checkUriPermission(uri, Process.myPid(), Process.myUid(), Intent.FLAG_GRANT_READ_URI_PERMISSION) != PackageManager.PERMISSION_GRANTED) return null\n", ""),
    # --- mimeTypes()
    ("C29", NFP, "MIME hints not lowercased", ".map { it.trim().lowercase(Locale.ROOT) }", ".map { it.trim() }"),
    ("C30", NFP, "extension hints not mapped", "val type = if (hint.startsWith('.')) MimeTypeMap.getSingleton().getMimeTypeFromExtension(hint.substringAfterLast('.')) else hint", "val type = hint"),
    ("C31", NFP, "MIME syntax validation removed", " || !type.matches(Regex(", " || false && !type.matches(Regex("),
    ("C32", NFP, "MIME hints not deduplicated", "            return result.distinct()", "            return result"),
    # --- MainActivity wiring (bot R1-1)
    ("W01", MA, "onShowFileChooser override deleted (feature dead in the app)", "            override fun onShowFileChooser(view: WebView, callback: ValueCallback<Array<Uri>>, params: FileChooserParams): Boolean =\n                filePicker.open(params, {\n                    view === webView && view.parent != null && OriginPolicy.isSameOrigin(profile.origin, view.url.orEmpty())\n                }, callback)\n\n", ""),
    ("W02", MA, "launcher drops the result data", "filePicker.result(it.resultCode, it.data)", "filePicker.result(it.resultCode, null)"),
    ("W03", MA, "isCurrent predicate always true", "view === webView && view.parent != null && OriginPolicy.isSameOrigin(profile.origin, view.url.orEmpty())", "true"),
    ("W04", MA, "isCurrent drops view identity/attachment", "view === webView && view.parent != null && OriginPolicy", "OriginPolicy"),
    ("W05", MA, "onPageStarted cancel removed", "                if (view === webView) filePicker.cancel()\n", ""),
    ("W06", MA, "showConnectionError cancel removed", "    private fun showConnectionError(view: WebView, profile: ConnectionProfile) {\n        filePicker.cancel()\n", "    private fun showConnectionError(view: WebView, profile: ConnectionProfile) {\n"),
    ("W07", MA, "destroyConnection cancel removed", "        connectionAttempt++\n        filePicker.cancel()\n", "        connectionAttempt++\n"),
    ("W08", MA, "saved-state key renamed on write", 'outState.putBoolean("file-picker-in-flight"', 'outState.putBoolean("file-picker-in-flight-renamed"'),
    ("W09", MA, "restored flag ignored on create", 'filePicker.restoreAwaitingResult(savedInstanceState?.getBoolean("file-picker-in-flight") ?: false)', "filePicker.restoreAwaitingResult(false)"),
]

ORIG = {NFP: (SP / "NativeFilePicker.kt.orig").read_text(), MA: (SP / "MainActivity.kt.orig").read_text()}


def apply(mid):
    for f, text in ORIG.items():
        (SRC / f).write_text(text)
    row = next(r for r in M if r[0] == mid)
    if row[1] is None:
        return "pristine"
    f = row[1]
    text = ORIG[f]
    pairs = [(row[3], row[4])] + list(row[5:])
    for old, new in pairs:
        n = text.count(old)
        if n != 1:
            sys.exit(f"{mid}: expected exactly one match, found {n}: {old!r}")
        text = text.replace(old, new)
    if text == ORIG[f]:
        sys.exit(f"{mid}: mutant identical to original")
    (SRC / f).write_text(text)
    return f"{f} sha={hashlib.sha256(text.encode()).hexdigest()[:12]}"


if __name__ == "__main__":
    if sys.argv[1] == "--list":
        for r in M:
            print(r[0], r[2])
    elif sys.argv[1] == "--check":
        seen = set()
        for r in M:
            h = apply(r[0])
            print(r[0], h)
            assert h not in seen or r[1] is None, f"duplicate mutant {r[0]}"
            seen.add(h)
        apply("M00")
    else:
        print(apply(sys.argv[1]))
