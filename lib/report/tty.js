/*
 * Terminal paint, and nothing else. Colours only when stdout is a person -
 * piped output stays clean bytes, which is what lets a test assert on it and
 * a script cut it up.
 */
const tty = process.stdout.isTTY;
const red = (s) => (tty ? `\x1b[31m${s}\x1b[0m` : s);
const yellow = (s) => (tty ? `\x1b[33m${s}\x1b[0m` : s);
const green = (s) => (tty ? `\x1b[32m${s}\x1b[0m` : s);
const dim = (s) => (tty ? `\x1b[2m${s}\x1b[0m` : s);

const truncate = (s, n) => {
  const text = String(s ?? '')
    .trim()
    .replace(/\s+/g, ' ');
  return [...text].length > n ? [...text].slice(0, n - 1).join('') + '…' : text;
};

export { dim, green, red, truncate, tty, yellow };
