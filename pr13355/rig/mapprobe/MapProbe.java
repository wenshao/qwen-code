import java.lang.reflect.Method;

/** Calls the jar's own ManagedExtensionProjection.executionOf on a Broker row. */
public class MapProbe {
    public static void main(String[] args) throws Exception {
        Class<?> projection = Class.forName(
                "com.alibaba.qwen.code.managedagent.store.ManagedExtensionProjection");
        @SuppressWarnings({"unchecked", "rawtypes"})
        Object state = Enum.valueOf((Class<Enum>) Class.forName(
                "com.alibaba.qwen.code.runtimebroker.ToolExecutionRecord$State"), args[0]);
        String status = "NULL".equals(args[1]) ? null : args[1];
        long generation = Long.parseLong(args[2]);
        for (Method method : projection.getMethods()) {
            if (!method.getName().equals("executionOf")) continue;
            Object result = method.getParameterCount() == 3
                    ? method.invoke(null, state, status, generation)
                    : method.invoke(null, state, status);
            System.out.println("executionOf/" + method.getParameterCount()
                    + "(" + args[0] + ", " + status + (method.getParameterCount() == 3 ? ", " + generation : "")
                    + ") = " + result);
        }
    }
}
