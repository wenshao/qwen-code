/*
 * winlock.so - models the Windows "a directory cannot be renamed (and, in
 * strict mode, cannot be removed) while any process holds an open handle to it
 * or to a descendant directory" rule, on Linux, with REAL kernel state:
 * the predicate is evaluated by scanning /proc/<pid>/fd for open handles held
 * by OTHER processes. Nothing is faked inside node - the syscall really fails
 * and node surfaces a genuine EPERM errno.
 *
 * env:
 *   WINLOCK_ROOT   - only paths under this prefix are subject to the rule
 *   WINLOCK_STRICT - "1" => rmdir/unlink of a held directory is refused too
 *   WINLOCK_LOG    - append a line per refusal/allow decision
 */
#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
#include <dlfcn.h>
#include <dirent.h>
#include <unistd.h>
#include <limits.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <fcntl.h>

static int (*real_rename)(const char *, const char *) = NULL;
static int (*real_renameat)(int, const char *, int, const char *) = NULL;
static int (*real_renameat2)(int, const char *, int, const char *, unsigned int) = NULL;
static int (*real_rmdir)(const char *) = NULL;

static void init(void) {
  if (!real_rename) real_rename = dlsym(RTLD_NEXT, "rename");
  if (!real_renameat) real_renameat = dlsym(RTLD_NEXT, "renameat");
  if (!real_renameat2) real_renameat2 = dlsym(RTLD_NEXT, "renameat2");
  if (!real_rmdir) real_rmdir = dlsym(RTLD_NEXT, "rmdir");
}

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

/* true when some OTHER live process holds an open fd on `dir` or a descendant */
static int held_by_other(const char *dir, char *holder, size_t holder_len) {
  DIR *proc = opendir("/proc");
  if (!proc) return 0;
  size_t dlen = strlen(dir);
  pid_t self = getpid();
  struct dirent *pe;
  int found = 0;
  while (!found && (pe = readdir(proc))) {
    if (pe->d_name[0] < '0' || pe->d_name[0] > '9') continue;
    pid_t pid = (pid_t)atoi(pe->d_name);
    if (pid == self) continue;
    char fdpath[PATH_MAX];
    snprintf(fdpath, sizeof(fdpath), "/proc/%d/fd", pid);
    DIR *fds = opendir(fdpath);
    if (!fds) continue;
    struct dirent *fe;
    while ((fe = readdir(fds))) {
      if (fe->d_name[0] == '.') continue;
      char link[PATH_MAX], target[PATH_MAX];
      snprintf(link, sizeof(link), "%s/%s", fdpath, fe->d_name);
      ssize_t n = readlink(link, target, sizeof(target) - 1);
      if (n <= 0) continue;
      target[n] = '\0';
      if (strncmp(target, dir, dlen) == 0 && (target[dlen] == '\0' || target[dlen] == '/')) {
        found = 1;
        if (holder) snprintf(holder, holder_len, "pid=%d fd=%s -> %s", pid, fe->d_name, target);
        break;
      }
    }
    closedir(fds);
  }
  closedir(proc);
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

int rename(const char *oldp, const char *newp) {
  init();
  if (refuse(oldp, "rename")) { errno = EPERM; return -1; }
  return real_rename(oldp, newp);
}

int renameat(int ofd, const char *oldp, int nfd, const char *newp) {
  init();
  if (ofd == AT_FDCWD && refuse(oldp, "renameat")) { errno = EPERM; return -1; }
  return real_renameat(ofd, oldp, nfd, newp);
}

int renameat2(int ofd, const char *oldp, int nfd, const char *newp, unsigned int flags) {
  init();
  if (ofd == AT_FDCWD && refuse(oldp, "renameat2")) { errno = EPERM; return -1; }
  if (!real_renameat2) { errno = ENOSYS; return -1; }
  return real_renameat2(ofd, oldp, nfd, newp, flags);
}

int rmdir(const char *p) {
  init();
  const char *strict = getenv("WINLOCK_STRICT");
  if (strict && strict[0] == '1' && refuse(p, "rmdir")) { errno = EPERM; return -1; }
  return real_rmdir(p);
}
