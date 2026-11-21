/** The id alphabet a Benchmark, an Agent and a Project share: letters, digits, `_` and `-`. */
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

export function isValidId(id: string): boolean {
  return ID_PATTERN.test(id);
}
