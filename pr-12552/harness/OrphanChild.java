package com.alibaba.qwen.code.runtimebroker;
import java.nio.file.Path;
import java.util.List;
public class OrphanChild {
    public static void main(String[] a) throws Exception {
        var p = new LocalProcessRuntimeProvisioner(List.of("node", a[0], "managed-runtime-worker"), Path.of("").toAbsolutePath(), new HttpRuntimeTransport());
        var svc = RealWorkerE2E.service(p, "o");
        var rec = svc.warm("h").toCompletableFuture().get();
        System.out.println("PORT " + rec.getLease().getEndpoint().getPort());
        System.out.flush();
        Thread.sleep(600_000);
    }
}
