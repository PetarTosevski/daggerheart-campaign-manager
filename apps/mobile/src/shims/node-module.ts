/** Device stand-in. Jest keeps Node's real `node:module`. */
export function createRequire(): never {
  throw new Error("node:module is only available in Node tests");
}
