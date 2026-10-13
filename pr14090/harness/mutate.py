import sys, pathlib
P = "packages/sdk-java/managed-agent-server/src/test/java/com/alibaba/qwen/code/managedagent/HostedOperatorRecoveryProbe.java"
MUTANTS = {
  # M1: revert the widened catch to NoSuchFileException-only (base behaviour for ESRCH)
  "m1": [("        } catch (IOException error) {\n            // A reaped",
          "        } catch (NoSuchFileException error) {\n            // A reaped")],
  # M2: drop the liveness re-check (swallow every stat-read failure)
  "m2": [("            if (!process.isAlive()) {\n                return false;\n            }\n            throw error;\n",
          "            return false;\n")],
  # M3: invert the liveness re-check
  "m3": [("            if (!process.isAlive()) {\n                return false;\n            }\n            throw error;\n",
          "            if (process.isAlive()) {\n                return false;\n            }\n            throw error;\n")],
  # M4: revert the escaped() cwd catch to the base form
  "m4": [("        Path cwd;\n        try {\n            cwd = Files.readSymbolicLink(Path.of(\"/proc\", Long.toString(process.pid()), \"cwd\"));\n        } catch (NoSuchFileException reaped) {\n            return null;\n        }\n        assertThat(cwd).isEqualTo(directory);\n",
          "        assertThat(Files.readSymbolicLink(Path.of(\"/proc\", Long.toString(process.pid()), \"cwd\"))).isEqualTo(directory);\n")],
  # candidate A: widen the cwd catch, re-check with isAlive()
  "ca": [("        } catch (NoSuchFileException reaped) {\n            return null;\n        }\n        assertThat(cwd)",
          "        } catch (IOException error) {\n            if (!process.isAlive()) {\n                return null;\n            }\n            throw error;\n        }\n        assertThat(cwd)")],
  # candidate B: widen the cwd catch, re-check with running() (zombie-aware)
  "cb": [("        } catch (NoSuchFileException reaped) {\n            return null;\n        }\n        assertThat(cwd)",
          "        } catch (IOException error) {\n            if (!running(process)) {\n                return null;\n            }\n            throw error;\n        }\n        assertThat(cwd)")],
}
root, name = sys.argv[1], sys.argv[2]
f = pathlib.Path(root) / P
text = f.read_text()
for old, new in MUTANTS[name]:
    n = text.count(old)
    assert n == 1, (name, n)
    text = text.replace(old, new)
f.write_text(text)
print("mutated", name)
