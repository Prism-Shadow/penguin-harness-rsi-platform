/**
 * Moving the process to another time zone for a test, and back.
 *
 * Back means setting TZ to the zone the process was in, then restoring TZ as it was. Deleting TZ
 * alone is not enough on Windows: there Node moves the process's zone only when TZ is set to one,
 * so the zone a test set would outlive the test.
 */
export function switchTimeZone(zone: string): () => void {
  const env = process.env.TZ;
  const current = Intl.DateTimeFormat().resolvedOptions().timeZone;
  process.env.TZ = zone;
  return () => {
    process.env.TZ = current;
    if (env === undefined) delete process.env.TZ;
    else process.env.TZ = env;
  };
}
