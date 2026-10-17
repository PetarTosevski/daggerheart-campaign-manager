/** A fair roll of one die with the given number of sides, using the runtime's CSPRNG. */
export function rollDie(sides: number): number {
  const limit = Math.floor(0x100000000 / sides) * sides;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return (buf[0] % sides) + 1;
  }
}

export function rollDice(count: number, sides: number): number[] {
  return Array.from({ length: Math.max(0, count) }, () => rollDie(sides));
}
