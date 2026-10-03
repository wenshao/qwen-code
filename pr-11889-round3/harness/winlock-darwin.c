/*
 * winlock.dylib - macOS (DYLD_INTERPOSE) port of the Linux winlock.so used in
 * rounds 1 and 2. It models the Windows rule "a directory cannot be renamed
 * (and, in strict mode, removed) while any process holds an open handle to it
 * or to a descendant" with REAL kernel state: the predicate is evaluated by
 * asking the kernel's own file-descriptor table (libproc: proc_listpids +
 * PROC_PIDLISTFDS + PROC_PIDFDVNODEPATHINFO - the same information Linux's
 * /proc/<pid>/fd exposes) for open handles held by OTHER live processes. When
 * one holds the directory or a descendant, the rename(2)/rmdir(2) call fails
 * with a genuine EPERM at the libc boundary, which Node surfaces as the exact
 * error the issue reports. Nothing in the store, node:fs or libuv is mocked.
 *
 * env:
 *   WINLOCK_ROOT   - only paths under this prefix are subject to the rule
 *   WINLOCK_STRICT - "1" => rmdir of a held directory is refused too
 *   WINLOCK_LOG    - append a line per refusal decision
 */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <unistd.h>
#include <limits.h>
#include <fcntl.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <sys/syscall.h>
#include <sys/proc_info.h>
#include <libproc.h>
#include <dlfcn.h>

static void logline(const char *verb, const char *path, const char *holder) {
  const char *lp = getenv("WINLOCK_LOG");
  if (!lp) return;
  FILE *f = fopen(lp, "a");
  if (!f) return;
  fprintf(f, "%s\t%s\t%s\n", verb, path, holder ? holder : "-");
  fclose(f);
}

static int under_root(const char *abs) {
  const char *root = getenv("WINLOCK_ROOT");
  if (!root || !*root) return 0;
  size_t n = strlen(root);
  if (strncmp(abs, root, n) != 0) return 0;
  return abs[n] == '\0' || abs[n] == '/';
}

static int is_dir(const char *p) {
  struct stat st;
  if (lstat(p, &st) != 0) return 0;
  return S_ISDIR(st.st_mode);
}

/* Scan the kernel fd tables once per 250 ms at most: the store's rename
 * backoff would otherwise pay a full-system scan per attempt. */
static int held_by_other(const char *dir, char *holder, size_t holder_len) {
  static char cached_dir[PATH_MAX];
  static char cached_holder[512];
  static int cached_found = 0;
  static struct timeval cached_at = {0, 0};
  struct timeval now;
  gettimeofday(&now, NULL);
  long age_ms = (now.tv_sec - cached_at.tv_sec) * 1000 +
                (now.tv_usec - cached_at.tv_usec) / 1000;
  if (cached_at.tv_sec != 0 && age_ms < 250 && strcmp(cached_dir, dir) == 0) {
    if (cached_found && holder)
      snprintf(holder, holder_len, "%s", cached_holder);
    return cached_found;
  }

  int found = 0;
  pid_t self = getpid();
  size_t dlen = strlen(dir);
  int bytes = proc_listpids(PROC_ALL_PIDS, 0, NULL, 0);
  if (bytes > 0) {
    pid_t *pids = malloc((size_t)bytes);
    int n = proc_listpids(PROC_ALL_PIDS, 0, pids, bytes) / (int)sizeof(pid_t);
    for (int i = 0; i < n && !found; i++) {
      pid_t pid = pids[i];
      if (pid == self || pid == 0) continue;
      int fsz = proc_pidinfo(pid, PROC_PIDLISTFDS, 0, NULL, 0);
      if (fsz <= 0) continue;
      struct proc_fdinfo *fds = malloc((size_t)fsz);
      if (!fds) continue;
      int nf = proc_pidinfo(pid, PROC_PIDLISTFDS, 0, fds, fsz) /
               (int)sizeof(struct proc_fdinfo);
      for (int j = 0; j < nf; j++) {
        if (fds[j].proc_fdtype != PROX_FDTYPE_VNODE) continue;
        struct vnode_fdinfowithpath pvi;
        if (proc_pidfdinfo(pid, fds[j].proc_fd, PROC_PIDFDVNODEPATHINFO,
                           &pvi, sizeof(pvi)) <= 0)
          continue;
        const char *target = pvi.pvip.vip_path;
        if (strncmp(target, dir, dlen) == 0 &&
            (target[dlen] == '\0' || target[dlen] == '/')) {
          found = 1;
          if (holder)
            snprintf(holder, holder_len, "pid=%d fd=%d -> %s", pid,
                     fds[j].proc_fd, target);
          break;
        }
      }
      free(fds);
    }
    free(pids);
  }

  snprintf(cached_dir, sizeof(cached_dir), "%s", dir);
  if (found)
    snprintf(cached_holder, sizeof(cached_holder), "%s",
             holder ? holder : "-");
  cached_found = found;
  cached_at = now;
  return found;
}

static int refuse(const char *path, const char *verb) {
  char abs[PATH_MAX];
  if (!realpath(path, abs)) return 0;
  if (!under_root(abs)) return 0;
  if (!is_dir(abs)) return 0;
  char holder[512] = {0};
  if (held_by_other(abs, holder, sizeof(holder))) {
    logline(verb, abs, holder);
    return 1;
  }
  return 0;
}

/* The replacement bodies call the raw syscall, not the libc symbol, so the
 * interposer never re-enters itself. syscall() sets errno exactly like the
 * libc wrappers do. */
static void trace(const char *entry, const char *oldp) {
  if (getenv("WINLOCK_DEBUG"))
    fprintf(stderr, "[winlock] %s(%s)\n", entry, oldp ? oldp : "?");
}

static int wl_rename(const char *oldp, const char *newp) {
  trace("rename", oldp);
  if (refuse(oldp, "rename")) {
    errno = EPERM;
    return -1;
  }
  return syscall(SYS_rename, oldp, newp);
}

static int wl_renameat(int ofd, const char *oldp, int nfd, const char *newp) {
  trace("renameat", oldp);
  if (ofd == AT_FDCWD && refuse(oldp, "renameat")) {
    errno = EPERM;
    return -1;
  }
  return syscall(SYS_renameat, ofd, oldp, nfd, newp);
}

static int wl_renamex_np(const char *oldp, const char *newp,
                         unsigned int flags) {
  trace("renamex_np", oldp);
  if (refuse(oldp, "renamex_np")) {
    errno = EPERM;
    return -1;
  }
  static int (*real_fn)(const char *, const char *, unsigned int) = NULL;
  if (!real_fn) real_fn = dlsym(RTLD_NEXT, "renamex_np");
  return real_fn(oldp, newp, flags);
}

static int wl_renameatx_np(int ofd, const char *oldp, int nfd,
                           const char *newp, unsigned int flags) {
  trace("renameatx_np", oldp);
  if (ofd == AT_FDCWD && refuse(oldp, "renameatx_np")) {
    errno = EPERM;
    return -1;
  }
  static int (*real_fn)(int, const char *, int, const char *, unsigned int) =
      NULL;
  if (!real_fn) real_fn = dlsym(RTLD_NEXT, "renameatx_np");
  return real_fn(ofd, oldp, nfd, newp, flags);
}

static int wl_rmdir(const char *p) {
  trace("rmdir", p);
  const char *strict = getenv("WINLOCK_STRICT");
  if (strict && strict[0] == '1' && refuse(p, "rmdir")) {
    errno = EPERM;
    return -1;
  }
  return syscall(SYS_rmdir, p);
}

extern int renamex_np(const char *, const char *, unsigned int);
extern int renameatx_np(int, const char *, int, const char *, unsigned int);

typedef struct {
  const void *replacement;
  const void *replacee;
} interpose_t;

__attribute__((used)) static const interpose_t interposers[]
    __attribute__((section("__DATA,__interpose"))) = {
        {(const void *)wl_rename, (const void *)rename},
        {(const void *)wl_renameat, (const void *)renameat},
        {(const void *)wl_renamex_np, (const void *)renamex_np},
        {(const void *)wl_renameatx_np, (const void *)renameatx_np},
        {(const void *)wl_rmdir, (const void *)rmdir},
};
