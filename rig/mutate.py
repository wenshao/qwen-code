import sys, pathlib
SRC = pathlib.Path(sys.argv[1]); ORIG = pathlib.Path(sys.argv[2]); mut = sys.argv[3]
s = ORIG.read_text()
HELPER = """    private String getControlResponseSubtype(JSONObject jsonObject) {
        JSONObject responseObject = jsonObject.getJSONObject("response");
        if (responseObject != null && responseObject.containsKey("subtype")) {
            return responseObject.getString("subtype");
        }
        return jsonObject.getString("subtype");
    }"""
GUARD = """                    if ("error".equals(getControlResponseSubtype(jsonObject))) {
                        log.warn("control_response error: {}", jsonObject.toJSONString());
                    }
                    return false;"""
def rep(old, new):
    global s
    assert s.count(old) == 1, f"anchor count {s.count(old)} for mutant {mut}"
    s = s.replace(old, new)

if mut == "M1":   # drop nested lookup -> base detection level
    rep(HELPER, HELPER.replace("""        JSONObject responseObject = jsonObject.getJSONObject("response");
        if (responseObject != null && responseObject.containsKey("subtype")) {
            return responseObject.getString("subtype");
        }
        return jsonObject.getString("subtype");""", """        return jsonObject.getString("subtype");"""))
elif mut == "M2": # drop top-level fallback
    rep("""        return jsonObject.getString("subtype");
    }""", """        return null;
    }""")
elif mut == "M3": # drop containsKey guard
    rep("""if (responseObject != null && responseObject.containsKey("subtype")) {""", """if (responseObject != null) {""")
elif mut == "M4": # warn -> info (level downgrade)
    rep("""log.warn("control_response error: {}", jsonObject.toJSONString());""", """log.info("control_response error: {}", jsonObject.toJSONString());""")
elif mut == "M5": # restore early turn abort
    rep(GUARD, GUARD.replace("                    return false;", """                    return "error".equals(getControlResponseSubtype(jsonObject));"""))
elif mut == "M6": # drop the warning entirely
    rep(GUARD, "                    return false;")
elif mut == "M7": # loosen exact equality to prefix match
    rep("""if ("error".equals(getControlResponseSubtype(jsonObject))) {""", """if (getControlResponseSubtype(jsonObject) != null && getControlResponseSubtype(jsonObject).startsWith("error")) {""")
elif mut == "M8": # flip precedence: top-level wins over nested
    rep(HELPER, """    private String getControlResponseSubtype(JSONObject jsonObject) {
        if (jsonObject.containsKey("subtype")) {
            return jsonObject.getString("subtype");
        }
        JSONObject responseObject = jsonObject.getJSONObject("response");
        return responseObject == null ? null : responseObject.getString("subtype");
    }""")
elif mut == "M9": # never dispatch onControlResponse consumer (control-arm sanity)
    rep("""                    MyConcurrentUtils.runAndWait(() -> sessionEventConsumers.onControlResponse(this, controlResponse),
                            Optional.ofNullable(sessionEventConsumers.onControlResponseTimeout(this, controlResponse)).orElse(defaultEventTimeout));
                    if ("error\"""", """                    if ("error\"""")
elif mut == "M10": # always stop the read loop on any control_response (thread OPEN#3)
    rep("""                    return false;
                } else if ("control_request".equals(messageType)) {""", """                    return true;
                } else if ("control_request".equals(messageType)) {""")
elif mut == "M11": # narrow the warn payload away (thread OPEN#9)
    rep("""log.warn("control_response error: {}", jsonObject.toJSONString());""", """log.warn("control_response error: {}", "");""")
else:
    raise SystemExit("unknown mutant " + mut)
SRC.write_text(s)
print("applied", mut)
