#!/usr/bin/env python3
"""Probes beyond the mutation table: slow worker start vs the startup-kill
gate (author's deferred R3 note), with and without a candidate guard."""
import os
import shutil
import sys

import mutants as m

GATE = ("ContextInstallationFaultGateTest#"
        "aBrokerKilledDuringManagedStartupStaysBlockedAfterRestart")
TEST_FILE = f"{m.TPKG}/ContextInstallationFaultGateTest.java"

# Candidate: prove the first Broker had not answered (and so had not blocked
# the binding through its own 4 x lease startup deadline) when it is killed.
CANDIDATE = [(
    """        held.awaitHeld(FaultGateRig.WAIT);

        rig.killBroker(first);""",
    """        held.awaitHeld(FaultGateRig.WAIT);
        // On a slow host the first Broker's own startup deadline (4 x the
        // operation lease) can block the binding before the kill, and the
        // gate would pass without testing the restart.
        assertFalse(warming.isDone(), "the first Broker answered warm "
                + "before it was killed");

        rig.killBroker(first);""")]

SLOW = {"PATH": f"{m.JDK}/bin:{m.SP}/slownode:" + os.environ["PATH"],
        "SLOW_WORKER_SECONDS": os.environ.get("SLOW_WORKER_SECONDS", "9")}


def copy_with(name, base_mutant=None, candidate=False):
    module = m.module_copy(name)
    if base_mutant:
        (_, rel), edits = m.MUTANTS[base_mutant]
        m.apply(f"{module}/{rel}", edits)
    if candidate:
        m.apply(f"{module}/{TEST_FILE}", CANDIDATE)
    return module


PROBES = {
    # base PR, slow worker: does the gate still pass?
    "S1a-slow-base": lambda: m.run("S1a", copy_with("S1a"), GATE,
                                   extra_env=SLOW, tag="S1a-slow-base"),
    # J5 (restart no longer blocks), slow worker: survivor?
    "S1b-slow-J5": lambda: m.run("S1b", copy_with(
        "S1b", "J5-resource-handle-no-longer-blocks-restart"), GATE,
        extra_env=SLOW, tag="S1b-slow-J5"),
    # candidate, slow worker: loud failure instead of a false pass
    "S1c-slow-candidate": lambda: m.run("S1c", copy_with(
        "S1c", candidate=True), GATE, extra_env=SLOW,
        tag="S1c-slow-candidate"),
    # candidate, normal speed: whole FG5 class still green
    "S1d-candidate": lambda: m.run("S1d", copy_with(
        "S1d", candidate=True), m.FG5, tag="S1d-candidate"),
    # candidate + J5, normal speed: still kills J5
    "S1e-candidate-J5": lambda: m.run("S1e", copy_with(
        "S1e", "J5-resource-handle-no-longer-blocks-restart",
        candidate=True), GATE, tag="S1e-candidate-J5"),
}

if __name__ == "__main__":
    for name in sys.argv[1:]:
        PROBES[name]()
