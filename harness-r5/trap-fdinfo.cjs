process.on("exit",()=>process._rawDebug("FDINFO0 "+require("fs").readFileSync("/proc/self/fdinfo/0","utf8").split("\n")[1]))
