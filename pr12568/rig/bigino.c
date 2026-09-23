// Lift st_ino by 2^60 for any path under $BIGINO_PREFIX — poses the
// 64-bit file ids an NTFS volume reports. Distinctness is preserved.
#include <sys/stat.h>
#include <fcntl.h>
#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include <sys/param.h>
#define DYLD_INTERPOSE(_r, _o) \
  __attribute__((used)) static struct { const void *r; const void *o; } \
  _interpose_##_o __attribute__((section("__DATA,__interpose"))) = { (const void *)(unsigned long)&_r, (const void *)(unsigned long)&_o };
static void lift(const char *p, struct stat *st) {
  const char *pre = getenv("BIGINO_PREFIX");
  if (!pre || !p || !st || st->st_ino == 0) return;
  if (strncmp(p, pre, strlen(pre)) != 0) return;
  st->st_ino += (1ULL << 60);
  const char *log = getenv("BIGINO_LOG");
  if (log) { FILE *f = fopen(log, "a"); if (f) { fprintf(f, "%s -> %llu\n", p, (unsigned long long)st->st_ino); fclose(f);} }
}
int my_stat(const char *p, struct stat *st) { int r = stat(p, st); if (r == 0) lift(p, st); return r; }
int my_lstat(const char *p, struct stat *st) { int r = lstat(p, st); if (r == 0) lift(p, st); return r; }
int my_fstat(int fd, struct stat *st) {
  int r = fstat(fd, st);
  if (r == 0) { char buf[MAXPATHLEN]; if (fcntl(fd, F_GETPATH, buf) != -1) lift(buf, st); }
  return r;
}
int my_fstatat(int dfd, const char *p, struct stat *st, int fl) {
  int r = fstatat(dfd, p, st, fl);
  if (r == 0 && p && p[0] == '/') lift(p, st);
  return r;
}
DYLD_INTERPOSE(my_stat, stat)
DYLD_INTERPOSE(my_lstat, lstat)
DYLD_INTERPOSE(my_fstat, fstat)
DYLD_INTERPOSE(my_fstatat, fstatat)
