// JDI gate: attach to a JVM over JDWP, park the first thread that enters a
// method (SUSPEND_EVENT_THREAD), then resume it on "release" from stdin.
// usage: java Gate.java <port> <class> <method> <argCount>
// stdin commands: arm | release | quit ; stdout lines: READY, ARMED, HIT <thread> <frames>, RELEASED
import com.sun.jdi.*;
import com.sun.jdi.connect.*;
import com.sun.jdi.event.*;
import com.sun.jdi.request.*;
import java.io.*;
import java.util.*;

public class Gate {
    public static void main(String[] a) throws Exception {
        int port = Integer.parseInt(a[0]);
        String cls = a[1], method = a[2];
        int argc = Integer.parseInt(a[3]);
        AttachingConnector c = Bootstrap.virtualMachineManager().attachingConnectors().stream()
                .filter(x -> x.name().equals("com.sun.jdi.SocketAttach")).findFirst().orElseThrow();
        Map<String, Connector.Argument> args = c.defaultArguments();
        args.get("hostname").setValue("127.0.0.1");
        args.get("port").setValue(String.valueOf(port));
        VirtualMachine vm = c.attach(args);
        List<ReferenceType> types = vm.classesByName(cls);
        if (types.isEmpty()) { System.out.println("NO-CLASS " + cls); System.exit(3); }
        List<Location> locs = new ArrayList<>();
        for (ReferenceType t : types)
            for (Method m : t.methodsByName(method))
                if (m.argumentTypeNames().size() == argc && m.location() != null) locs.add(m.location());
        if (locs.isEmpty()) { System.out.println("NO-METHOD " + method + "/" + argc); System.exit(4); }
        EventRequestManager erm = vm.eventRequestManager();
        List<BreakpointRequest> bps = new ArrayList<>();
        for (Location l : locs) {
            BreakpointRequest bp = erm.createBreakpointRequest(l);
            bp.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
            bps.add(bp);
        }
        final ThreadReference[] parked = {null};
        Thread events = new Thread(() -> {
            try {
                while (true) {
                    EventSet set = vm.eventQueue().remove();
                    for (Event e : set) {
                        if (e instanceof BreakpointEvent be) {
                            synchronized (parked) {
                                if (parked[0] == null) {
                                    parked[0] = be.thread();
                                    for (BreakpointRequest bp : bps) bp.disable();
                                    StringBuilder sb = new StringBuilder();
                                    try {
                                        for (StackFrame f : be.thread().frames()) {
                                            String n = f.location().declaringType().name();
                                            if (n.startsWith("com.alibaba.qwen")) sb.append(n.substring(n.lastIndexOf('.') + 1)).append('.').append(f.location().method().name()).append(':').append(f.location().lineNumber()).append(' ');
                                        }
                                    } catch (Exception ignored) {}
                                    System.out.println("HIT " + be.thread().name() + " virtual=" + be.thread().isVirtual() + " | " + sb);
                                    System.out.flush();
                                    continue; // keep it suspended
                                }
                            }
                            set.resume();
                        } else if (e instanceof VMDisconnectEvent || e instanceof VMDeathEvent) {
                            System.out.println("VM-GONE"); System.out.flush(); return;
                        }
                    }
                    boolean anyBp = false;
                    for (Event e : set) if (e instanceof BreakpointEvent) anyBp = true;
                    if (!anyBp) set.resume();
                }
            } catch (InterruptedException | VMDisconnectedException ex) { }
        });
        events.setDaemon(true);
        events.start();
        System.out.println("READY " + locs.size() + " location(s) " + locs);
        System.out.flush();
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));
        String line;
        while ((line = in.readLine()) != null) {
            line = line.trim();
            if (line.equals("arm")) {
                synchronized (parked) { parked[0] = null; for (BreakpointRequest bp : bps) bp.enable(); }
                System.out.println("ARMED"); System.out.flush();
            } else if (line.equals("release")) {
                synchronized (parked) {
                    if (parked[0] != null) { parked[0].resume(); System.out.println("RELEASED " + parked[0].name()); }
                    else System.out.println("RELEASED none");
                }
                System.out.flush();
            } else if (line.equals("quit")) {
                for (BreakpointRequest bp : bps) erm.deleteEventRequest(bp);
                synchronized (parked) { if (parked[0] != null) try { parked[0].resume(); } catch (Exception ignored) {} }
                vm.dispose();
                System.out.println("BYE"); System.out.flush();
                return;
            }
        }
        vm.dispose();
    }
}
