package com.alibaba.qwen.code.runtimebroker;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;

/**
 * Runs the PR's own H2 cross-process stress test
 * (Issue13183AdversarialTest#concurrentCrossProcessAdmitAndReleaseNeverContradict)
 * N times in one JVM against whichever runtime-broker jar is on the classpath.
 * Each invocation builds a fresh in-memory H2 database (UUID-named).
 * usage: StressRepeat <runs>
 */
public final class StressRepeat {
    private StressRepeat() {
    }

    public static void main(String[] args) throws Exception {
        int runs = Integer.parseInt(args[0]);
        Class<?> type = Class.forName("com.alibaba.qwen.code.runtimebroker.Issue13183AdversarialTest");
        Method test = type.getDeclaredMethod("concurrentCrossProcessAdmitAndReleaseNeverContradict");
        test.setAccessible(true);
        var constructor = type.getDeclaredConstructor();
        constructor.setAccessible(true);
        int red = 0;
        StringBuilder reasons = new StringBuilder();
        for (int i = 0; i < runs; i++) {
            try {
                test.invoke(constructor.newInstance());
            } catch (InvocationTargetException failure) {
                red++;
                String message = String.valueOf(failure.getCause().getMessage());
                reasons.append("run ").append(i + 1).append(": ")
                        .append(message.length() > 120 ? message.substring(0, 120) : message).append('\n');
            }
        }
        System.out.println("RESULT runs=" + runs + " red=" + red + " green=" + (runs - red));
        System.out.print(reasons);
    }
}
