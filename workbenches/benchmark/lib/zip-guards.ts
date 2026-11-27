/**
 * The caps and checks a Benchmark package's zip is held to, both ways. Copied from the harness's
 * archive guards (packages/server services/skill-import-limits.ts and zip-entries.ts), which a
 * workbench cannot import.
 */
import { WorkbenchError } from "./errors.js";
import { ZipError, readZip } from "./zip.js";

/** Zipped cap: within the host's 20MB body limit after base64. */
export const MAX_ARCHIVE_BYTES = 14 * 1024 * 1024;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_TOTAL_BYTES = 20 * 1024 * 1024;

function archiveInvalid(message: string): WorkbenchError {
  return new WorkbenchError(400, "benchmark_archive_invalid", message);
}

/**
 * One zip entry path (zip-slip guard): no absolute path (a leading "/" or a drive letter), no
 * backslash and no ".." segment, so an archive never writes outside its target.
 */
export function assertSafeEntryPath(name: string): void {
  if (name.includes("\\")) throw archiveInvalid(`Invalid zip entry path (backslash): ${name}`);
  if (name.startsWith("/") || /^[A-Za-z]:/.test(name)) {
    throw archiveInvalid(`Invalid zip entry path (absolute): ${name}`);
  }
  if (name.split("/").some((segment) => segment === "..")) {
    throw archiveInvalid(`Invalid zip entry path (traversal): ${name}`);
  }
}

/**
 * The archive's file entries with the caps enforced from the central directory, before a byte is
 * inflated: an entry declaring more than 5MB, or entries declaring more than 20MB together, are
 * refused with `tooLarge(message)` (zeros deflate at about 1000:1, so caps measured on what comes
 * back would bound nothing). A directory entry counts towards nothing and is never returned. A
 * directory that does not hold together, a link or special file, and a broken entry are 400
 * `benchmark_archive_invalid`.
 */
export function unzipBounded(
  archive: Uint8Array,
  tooLarge: (message: string) => WorkbenchError,
): Map<string, Uint8Array> {
  let declared = 0;
  try {
    return readZip(archive, ({ name, originalSize }) => {
      if (originalSize > MAX_FILE_BYTES) {
        throw tooLarge(`Zip entry exceeds the 5MB uncompressed limit: ${name}`);
      }
      declared += originalSize;
      if (declared > MAX_TOTAL_BYTES) {
        throw tooLarge("The zip archive exceeds the 20MB uncompressed limit.");
      }
    });
  } catch (error) {
    if (error instanceof WorkbenchError) throw error;
    if (error instanceof ZipError && error.problem !== "entry") {
      throw archiveInvalid(error.message);
    }
    throw archiveInvalid("dataBase64 is not a valid zip archive.");
  }
}

/**
 * A control character, NUL above all: no disk takes NUL in a name, and a name holding any other
 * one never lists as it is.
 */
export const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;

/**
 * Every path a copy will hold, as a disk that ignores letter case and Unicode normal form (macOS,
 * Windows) sees it: two entries it takes for one would land one over the other, and a file where
 * another entry needs a directory would fail the write half-way. `invalid` makes the refusal.
 */
export function assertDistinctPaths(paths: Iterable<string>, invalid: (m: string) => Error): void {
  const claimed = new Map<string, { path: string; directory: boolean }>();
  const claim = (p: string, directory: boolean): void => {
    const key = p.normalize("NFC").toLowerCase();
    const prior = claimed.get(key);
    if (prior === undefined) {
      claimed.set(key, { path: p, directory });
    } else if (prior.directory !== directory) {
      throw invalid(
        `Invalid zip entry path (a file where a directory must be): ${directory ? prior.path : p}`,
      );
    } else if (prior.path !== p) {
      throw invalid(
        `Invalid zip entry path (the same name as ${prior.path} where letter case is ignored): ${p}`,
      );
    }
  };
  for (const rel of paths) {
    const segments = rel.split("/");
    for (let i = 1; i < segments.length; i++) claim(segments.slice(0, i).join("/"), true);
    claim(rel, false);
  }
}
