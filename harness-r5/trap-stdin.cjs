const d = Object.getOwnPropertyDescriptor(process, 'stdin');
let n = 0;
Object.defineProperty(process, 'stdin', { configurable: true, enumerable: d.enumerable, get() { if (n++ < 1) process._rawDebug('STDIN FIRST ACCESS\n' + new Error().stack.split('\n').slice(2, 12).join('\n')); return d.get.call(this); } });
