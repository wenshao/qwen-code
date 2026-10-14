import com.sun.source.util.JavacTask;
import com.sun.tools.javac.api.JavacTaskImpl;
import com.sun.tools.javac.tree.JCTree;
import com.sun.tools.javac.tree.JCTree.*;
import com.sun.tools.javac.tree.TreeMaker;
import com.sun.tools.javac.tree.TreeTranslator;
import com.sun.tools.javac.util.Context;
import com.sun.tools.javac.util.List;
import com.sun.tools.javac.util.ListBuffer;

import javax.tools.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;

/**
 * Per-file semantic comparison of two source trees, ignoring what a pure
 * Checkstyle reformat may change: whitespace/comments/line breaks (the
 * pretty-printed parse tree has none), import order, and braces around
 * single-statement if/else/for/while/do bodies (both sides get them).
 *
 * usage: java AstEq <baseRoot> <headRoot> <outDir> < relpaths
 * prints one line per file: SAME | DIFF | HEAD_PARSE_ERROR | BASE_PARSE_ERROR
 */
public class AstEq {
    public static void main(String[] a) throws Exception {
        Path base = Path.of(a[0]), head = Path.of(a[1]), out = Path.of(a[2]);
        Files.createDirectories(out);
        BufferedReader in = new BufferedReader(new InputStreamReader(System.in));
        String rel;
        int same = 0, diff = 0, herr = 0, berr = 0;
        while ((rel = in.readLine()) != null) {
            rel = rel.trim();
            if (rel.isEmpty()) continue;
            Result rb = canon(base.resolve(rel));
            Result rh = canon(head.resolve(rel));
            String tag;
            if (rb.errors.size() > 0) { tag = "BASE_PARSE_ERROR"; berr++; }
            else if (rh.errors.size() > 0) { tag = "HEAD_PARSE_ERROR"; herr++; }
            else if (rb.text.equals(rh.text)) { tag = "SAME"; same++; }
            else { tag = "DIFF"; diff++; }
            System.out.println(tag + "\t" + rel + (rh.errors.isEmpty() ? "" : "\t" + String.join(" | ", rh.errors)));
            if (tag.equals("DIFF")) {
                String n = rel.replace('/', '_');
                Files.writeString(out.resolve(n + ".base"), rb.text);
                Files.writeString(out.resolve(n + ".head"), rh.text);
            }
        }
        System.out.println("TOTAL same=" + same + " diff=" + diff + " headParseError=" + herr + " baseParseError=" + berr);
    }

    record Result(String text, java.util.List<String> errors) {}

    static Result canon(Path p) throws IOException {
        JavaCompiler jc = ToolProvider.getSystemJavaCompiler();
        DiagnosticCollector<JavaFileObject> dc = new DiagnosticCollector<>();
        StandardJavaFileManager fm = jc.getStandardFileManager(dc, Locale.ROOT, StandardCharsets.UTF_8);
        JavacTask task = (JavacTask) jc.getTask(null, fm, dc, java.util.List.of("-proc:none", "--release", "21"), null,
                fm.getJavaFileObjects(p.toFile()));
        Iterable<? extends com.sun.source.tree.CompilationUnitTree> units = task.parse();
        java.util.List<String> errs = new ArrayList<>();
        for (Diagnostic<? extends JavaFileObject> d : dc.getDiagnostics()) {
            if (d.getKind() == Diagnostic.Kind.ERROR) {
                errs.add(d.getLineNumber() + ":" + d.getColumnNumber() + " " + d.getMessage(Locale.ROOT).replace("\n", " "));
            }
        }
        if (!errs.isEmpty()) return new Result("", errs);
        Context ctx = ((JavacTaskImpl) task).getContext();
        TreeMaker make = TreeMaker.instance(ctx);
        JCCompilationUnit cu = (JCCompilationUnit) units.iterator().next();
        new Braces(make).translate(cu);
        // sort imports, keep everything else in order
        ListBuffer<JCTree> imports = new ListBuffer<>();
        ListBuffer<JCTree> others = new ListBuffer<>();
        JCTree pkg = null;
        for (JCTree t : cu.defs) {
            if (t instanceof JCImport) imports.add(t);
            else if (t instanceof JCPackageDecl) pkg = t;
            else others.add(t);
        }
        java.util.List<JCTree> sorted = new ArrayList<>(imports.toList());
        sorted.sort(Comparator.comparing(JCTree::toString));
        ListBuffer<JCTree> defs = new ListBuffer<>();
        if (pkg != null) defs.add(pkg);
        defs.addAll(sorted);
        defs.addAll(others.toList());
        cu.defs = defs.toList();
        cu.docComments = null; // compare code, not javadoc placement
        return new Result(cu.toString(), errs);
    }

    static class Braces extends TreeTranslator {
        final TreeMaker make;
        Braces(TreeMaker m) { make = m; }
        JCStatement wrap(JCStatement s) {
            if (s == null || s instanceof JCBlock) return s;
            return make.at(s.pos).Block(0, List.of(s));
        }
        @Override public void visitIf(JCIf t) {
            super.visitIf(t);
            t.thenpart = wrap(t.thenpart);
            t.elsepart = wrap(t.elsepart);
            result = t;
        }
        @Override public void visitForLoop(JCForLoop t) { super.visitForLoop(t); t.body = wrap(t.body); result = t; }
        @Override public void visitForeachLoop(JCEnhancedForLoop t) { super.visitForeachLoop(t); t.body = wrap(t.body); result = t; }
        @Override public void visitWhileLoop(JCWhileLoop t) { super.visitWhileLoop(t); t.body = wrap(t.body); result = t; }
        @Override public void visitDoLoop(JCDoWhileLoop t) { super.visitDoLoop(t); t.body = wrap(t.body); result = t; }
    }
}
