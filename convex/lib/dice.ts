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

/** An Rng that hands out `values` in order (each within the die's sides), then falls back to `base`. */
export function replaying(values: readonly number[], base: (sides: number) => number): (sides: number) => number {
  let i = 0;
  return (sides: number) => {
    const n = values[i++];
    return n !== undefined && n >= 1 && n <= sides ? n : base(sides);
  };
}
