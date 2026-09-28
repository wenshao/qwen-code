import com.sun.jdi.*;
import com.sun.jdi.connect.*;
import com.sun.jdi.event.*;
import com.sun.jdi.request.*;
import java.util.*;

/** VERIFICATION RIG ONLY: print exceptions thrown from com.alibaba.qwen frames of a JDWP-enabled JVM. */
public class ExTap {
  public static void main(String[] a) throws Exception {
    AttachingConnector c = Bootstrap.virtualMachineManager().attachingConnectors().stream()
        .filter(x -> x.name().equals("com.sun.jdi.SocketAttach")).findFirst().orElseThrow();
    Map<String, Connector.Argument> args = c.defaultArguments();
    args.get("hostname").setValue("127.0.0.1");
    args.get("port").setValue(a[0]);
    VirtualMachine vm = c.attach(args);
    Set<String> types = new HashSet<>(Arrays.asList(a).subList(1, a.length));
    for (String t : types) {
      ClassPrepareRequest cpr = vm.eventRequestManager().createClassPrepareRequest();
      cpr.addClassFilter(t); cpr.enable();
      for (ReferenceType rt : vm.classesByName(t)) arm(vm, rt);
    }
    if (types.isEmpty()) { ExceptionRequest r = vm.eventRequestManager().createExceptionRequest(null, true, true); r.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD); r.addClassFilter("com.alibaba.qwen.*"); r.enable(); }
    System.out.println("attached; watching " + (types.isEmpty() ? "all" : types));
    EventQueue q = vm.eventQueue();
    while (true) {
      EventSet set = q.remove();
      for (Event e : set) {
        if (e instanceof ClassPrepareEvent cpe) arm(vm, cpe.referenceType());
        if (e instanceof ExceptionEvent ee) {
          Location loc = ee.location();
          if (loc.declaringType().name().startsWith("com.alibaba.qwen")) {
            ObjectReference ex = ee.exception();
            String msg = "?";
            try {
              Value v = ex.invokeMethod(ee.thread(), ex.referenceType().methodsByName("getMessage").get(0), List.of(), ObjectReference.INVOKE_SINGLE_THREADED);
              msg = v == null ? "null" : ((StringReference) v).value();
            } catch (Exception ignore) {}
            StringBuilder sb = new StringBuilder();
            sb.append(new java.util.Date()).append(" ").append(ex.referenceType().name()).append(": ").append(msg).append("\n");
            try {
              int n = 0;
              for (StackFrame f : ee.thread().frames()) {
                Location l = f.location();
                if (l.declaringType().name().startsWith("com.alibaba.qwen")) sb.append("    at ").append(l.declaringType().name()).append(".").append(l.method().name()).append(":").append(l.lineNumber()).append("\n");
                if (++n > 40) break;
              }
            } catch (Exception ignore) {}
            System.out.print(sb);
            System.out.flush();
          }
        }
      }
      set.resume();
    }
  }
  static void arm(VirtualMachine vm, ReferenceType rt) {
    ExceptionRequest r = vm.eventRequestManager().createExceptionRequest(rt, true, true);
    r.setSuspendPolicy(EventRequest.SUSPEND_EVENT_THREAD);
    r.addClassFilter("com.alibaba.qwen.*");
    r.enable();
  }
}
