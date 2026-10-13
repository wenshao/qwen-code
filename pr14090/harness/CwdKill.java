import com.sun.jdi.Bootstrap;
import com.sun.jdi.Method;
import com.sun.jdi.ReferenceType;
import com.sun.jdi.StackFrame;
import com.sun.jdi.VirtualMachine;
import com.sun.jdi.connect.AttachingConnector;
import com.sun.jdi.event.BreakpointEvent;
import com.sun.jdi.event.ClassPrepareEvent;
import com.sun.jdi.event.Event;
import com.sun.jdi.event.EventSet;
import com.sun.jdi.event.VMDeathEvent;
import com.sun.jdi.event.VMDisconnectEvent;
import com.sun.jdi.request.BreakpointRequest;
import com.sun.jdi.request.ClassPrepareRequest;
import com.sun.jdi.request.EventRequest;
import java.nio.file.Files;
import java.nio.file.Path;

/**
 * Rig-only JDI driver. Breaks on UnixFileSystemProvider.readSymbolicLink when it is called from
 * HostedOperatorRecoveryProbe.escaped() (i.e. after running() returned true), SIGKILLs the writer
 * named in the pid file, waits until /proc/<pid> is gone (the test JVM's reaper reaps it), then resumes.
 * No source under test is modified.
 */
public class CwdKill {
    private static final String TARGET = "sun.nio.fs.UnixFileSystemProvider";
    private static long hits;
    private static boolean zombie;

    /** kill: wait until /proc/<pid> is gone (reaped); killz: wait until the stat state is Z (zombie). */
    private static boolean settled(long pid, boolean zombie) {
        return zombie ? "Z".equals(state(pid)) : !Files.exists(Path.of("/proc", Long.toString(pid)));
    }

    private static String state(long pid) {
        try {
            String stat = Files.readString(Path.of("/proc", Long.toString(pid), "stat"));
            return String.valueOf(stat.charAt(stat.lastIndexOf(')') + 2));
        } catch (Exception gone) {
            return "gone";
        }
    }

    public static void main(String[] args) throws Exception {
        String port = args[0];
        Path pidFile = Path.of(args[1]);
        String mode = args.length > 2 ? args[2] : "kill";
        boolean kill = !"observe".equals(mode);
        zombie = "killz".equals(mode);
        AttachingConnector connector = Bootstrap.virtualMachineManager().attachingConnectors().stream()
                .filter(value -> value.name().equals("com.sun.jdi.SocketAttach")).findFirst().orElseThrow();
        var arguments = connector.defaultArguments();
        arguments.get("hostname").setValue("127.0.0.1");
        arguments.get("port").setValue(port);
        VirtualMachine vm = null;
        for (int attempt = 0; attempt < 1200 && vm == null; attempt++) {
            try {
                vm = connector.attach(arguments);
            } catch (Exception notYet) {
                Thread.sleep(250);
            }
        }
        if (vm == null) {
            throw new IllegalStateException("could not attach on port " + port);
        }
        System.out.println("JDI attached port=" + port + " kill=" + kill);
        var loaded = vm.classesByName(TARGET);
        if (loaded.isEmpty()) {
            ClassPrepareRequest prepare = vm.eventRequestManager().createClassPrepareRequest();
            prepare.addClassFilter(TARGET);
            prepare.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
            prepare.enable();
        } else {
            install(vm, loaded.getFirst());
        }
        vm.resume();
        try {
            while (true) {
                EventSet events = vm.eventQueue().remove();
                for (Event event : events) {
                    if (event instanceof ClassPrepareEvent prepared) {
                        install(vm, prepared.referenceType());
                    } else if (event instanceof BreakpointEvent breakpoint) {
                        if (fromEscaped(breakpoint)) {
                            hits++;
                            if (kill) {
                                long pid = Long.parseLong(Files.readString(pidFile).strip());
                                new ProcessBuilder("kill", "-9", Long.toString(pid)).inheritIO().start().waitFor();
                                long deadline = System.nanoTime() + 10_000_000_000L;
                                while (!settled(pid, zombie) && System.nanoTime() < deadline) {
                                    Thread.sleep(5);
                                }
                                System.out.println("JDI killed pid=" + pid + " procGone="
                                        + !Files.exists(Path.of("/proc", Long.toString(pid))) + " state=" + state(pid));
                            }
                        }
                    } else if (event instanceof VMDeathEvent || event instanceof VMDisconnectEvent) {
                        System.out.println("JDI RESULT forcedKills=" + hits);
                        return;
                    }
                }
                events.resume();
            }
        } catch (com.sun.jdi.VMDisconnectedException gone) {
            System.out.println("JDI RESULT forcedKills=" + hits);
        }
    }

    private static void install(VirtualMachine vm, ReferenceType type) {
        for (Method method : type.methodsByName("readSymbolicLink")) {
            BreakpointRequest request = vm.eventRequestManager().createBreakpointRequest(method.location());
            request.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
            request.enable();
            System.out.println("JDI breakpoint at " + method);
        }
    }

    private static boolean fromEscaped(BreakpointEvent event) throws Exception {
        for (StackFrame frame : event.thread().frames()) {
            if (frame.location().declaringType().name().endsWith(".HostedOperatorRecoveryProbe")
                    && frame.location().method().name().equals("escaped")) {
                return true;
            }
        }
        return false;
    }
}
