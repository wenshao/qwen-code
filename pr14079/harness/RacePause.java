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

/**
 * Rig-only JDI driver. Attaches to the surefire fork and, whenever the main thread is about to
 * read(2) an already-open /proc/<pid>/stat inside HostedOperatorRecoveryProbe.running() called from
 * stopOwnedProcesses(), holds only that thread for N ms. The JVM's process-reaper thread keeps
 * running, so a SIGKILLed child is reaped between open() and read(): the CI interleaving, forced.
 * No source under test is modified.
 */
public class RacePause {
    private static final String TARGET = "sun.nio.ch.UnixFileDispatcherImpl";
    private static long hits;

    public static void main(String[] args) throws Exception {
        String port = args[0];
        long pauseMillis = Long.parseLong(args[1]);
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
        System.out.println("JDI attached port=" + port + " pauseMs=" + pauseMillis);
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
                        if (fromStopOwnedProcesses(breakpoint)) {
                            hits++;
                            Thread.sleep(pauseMillis);
                        }
                    } else if (event instanceof VMDeathEvent || event instanceof VMDisconnectEvent) {
                        System.out.println("JDI RESULT forcedInterleavings=" + hits);
                        return;
                    }
                }
                events.resume();
            }
        } catch (com.sun.jdi.VMDisconnectedException gone) {
            System.out.println("JDI RESULT forcedInterleavings=" + hits);
        }
    }

    private static void install(VirtualMachine vm, ReferenceType type) {
        for (Method method : type.methodsByName("read")) {
            if (method.signature().equals("(Ljava/io/FileDescriptor;JI)I")) {
                BreakpointRequest request = vm.eventRequestManager().createBreakpointRequest(method.location());
                request.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
                request.enable();
                System.out.println("JDI breakpoint at " + method);
            }
        }
    }

    private static boolean fromStopOwnedProcesses(BreakpointEvent event) throws Exception {
        boolean running = false;
        for (StackFrame frame : event.thread().frames()) {
            String type = frame.location().declaringType().name();
            String method = frame.location().method().name();
            if (type.endsWith(".HostedOperatorRecoveryProbe") && method.equals("running")) {
                running = true;
            }
            if (running && type.endsWith(".HostedOperatorRecoveryProbe") && method.equals("stopOwnedProcesses")) {
                return true;
            }
        }
        return false;
    }
}
