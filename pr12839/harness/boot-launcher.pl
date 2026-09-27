use strict; use POSIX (); use Time::HiRes ();
my ($cli, $pidfile) = @ARGV;
pipe(my $r, my $w) or die;
my $pid = fork();
if ($pid == 0) { close $w; open STDIN, '<&', $r; close $r;
  open STDOUT, '>', 'stdout5.txt'; open STDERR, '>', 'stderr5.txt';
  exec 'node', $cli, 'managed-runtime-worker' or die; }
close $r; open my $p, '>', $pidfile; print $p "$pid\n"; close $p;
syswrite $w, '{"type":"boot","version":1,"token":"';   # half a boot document
Time::HiRes::sleep(2);
kill 'KILL', $$;                                         # launcher dies holding the only write end
