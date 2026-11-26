/**
 * The caps and checks a Benchmark package's zip is held to, both ways. Copied from the harness's
 * archive guards (packages/server services/skill-import-limits.ts and zip-entries.ts), which a
 * plugin cannot import until the server face exports them.
 */
import { strFromU8, unzipSync } from "fflate";
import { WorkbenchError } from "./errors.js";

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
 * `unzipSync` with the caps enforced from the central directory, before a byte is inflated:
 * `unzipSync` allocates each entry's declared size and inflates into it, so caps measured on what
 * comes back bound nothing (zeros deflate at about 1000:1, and an entry that overstates its size
 * hands back a short view of a buffer of the declared length). A directory entry counts towards
 * nothing and is never returned. A broken cap throws `tooLarge(message)`; a corrupt archive throws
 * whatever fflate throws, for the caller to translate.
 */
export function unzipBounded(
  archive: Uint8Array,
  tooLarge: (message: string) => WorkbenchError,
): Record<string, Uint8Array> {
  let declared = 0;
  return unzipSync(checkCentralDirectory(archive), {
    filter: ({ name, originalSize }) => {
      if (name.endsWith("/")) return false;
      if (originalSize > MAX_FILE_BYTES) {
        throw tooLarge(`Zip entry exceeds the 5MB uncompressed limit: ${name}`);
      }
      declared += originalSize;
      if (declared > MAX_TOTAL_BYTES) {
        throw tooLarge("The zip archive exceeds the 20MB uncompressed limit.");
      }
      return true;
    },
  });
}

/** fflate writes a 16-bit entry count. Add the ZIP64 end records when that field fills up.
 * Archive sizes and offsets fit in 32 bits under the package's byte limit (APPNOTE §4.3.14–16). */
export function withZip64FileCount(zip: Uint8Array, fileCount: number): Uint8Array {
  if (fileCount < 0xffff) return zip;

  // zipSync writes a 22-byte end record with no archive comment.
  const endOffset = zip.byteLength - 22;
  const end = Buffer.from(zip.subarray(endOffset));
  const directoryEnd = Buffer.alloc(56);
  directoryEnd.writeUInt32LE(0x06064b50, 0);
  directoryEnd.writeBigUInt64LE(44n, 4);
  directoryEnd.writeUInt16LE(45, 12); // ZIP version 4.5, made by and needed to extract
  directoryEnd.writeUInt16LE(45, 14);
  directoryEnd.writeBigUInt64LE(BigInt(fileCount), 24);
  directoryEnd.writeBigUInt64LE(BigInt(fileCount), 32);
  directoryEnd.writeBigUInt64LE(BigInt(end.readUInt32LE(12)), 40); // directory size
  directoryEnd.writeBigUInt64LE(BigInt(end.readUInt32LE(16)), 48); // directory offset

  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeBigUInt64LE(BigInt(endOffset), 8);
  locator.writeUInt32LE(1, 16); // one disk
  end.writeUInt16LE(0xffff, 8);
  end.writeUInt16LE(0xffff, 10);
  return Buffer.concat([zip.subarray(0, endOffset), directoryEnd, locator, end]);
}

/**
 * A control character, NUL above all: no disk takes NUL in a name, and a name holding any other
 * one never lists as it is.
 */
export const CONTROL_CHARACTER = /[\u0000-\u001f\u007f-\u009f]/;

/** Check the full directory before fflate uses its entry count to drive decompression. */
function checkCentralDirectory(zip: Uint8Array): Uint8Array {
  const invalid = () => archiveInvalid("Invalid ZIP central directory.");
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // The end-of-central-directory record: 22 bytes, then a comment of up to 64KB, at the very end.
  let end = -1;
  for (let i = zip.byteLength - 22; i >= Math.max(0, zip.byteLength - 22 - 0xffff); i--) {
    if (
      view.getUint32(i, true) === 0x06054b50 &&
      i + 22 + view.getUint16(i + 20, true) === zip.byteLength
    ) {
      end = i;
      break;
    }
  }
  if (end < 0) throw invalid();
  let diskCount = view.getUint16(end + 8, true);
  let count = view.getUint16(end + 10, true);
  let size = view.getUint32(end + 12, true);
  let at = view.getUint32(end + 16, true);
  let directoryEnd = end;
  const locator = end - 20;
  if (locator >= 0 && view.getUint32(locator, true) === 0x07064b50) {
    const record = Number(view.getBigUint64(locator + 8, true));
    if (
      record + 56 > locator ||
      view.getUint32(record, true) !== 0x06064b50 ||
      view.getBigUint64(record + 4, true) !== BigInt(locator - record - 12)
    ) {
      throw invalid();
    }
    // A ZIP32 field contains either the value itself or the all-ones marker for its ZIP64 value.
    const expanded = (offset: number, classic: number, marker: number): number => {
      const value = Number(view.getBigUint64(record + offset, true));
      if (classic !== marker && classic !== value) throw invalid();
      return value;
    };
    diskCount = expanded(24, diskCount, 0xffff);
    count = expanded(32, count, 0xffff);
    size = expanded(40, size, 0xffffffff);
    at = expanded(48, at, 0xffffffff);
    directoryEnd = record;
  }
  if (diskCount !== count || at + size !== directoryEnd || count * 46 > size) throw invalid();
  for (let n = 0; n < count; n++) {
    if (at + 46 > directoryEnd || view.getUint32(at, true) !== 0x02014b50) throw invalid();
    const host = view.getUint8(at + 5);
    const utf8 = (view.getUint16(at + 8, true) & 0x800) !== 0;
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const next = at + 46 + nameLength + extraLength + commentLength;
    if (next > directoryEnd) throw invalid();
    const type = (view.getUint32(at + 38, true) >>> 16) & 0o170000;
    if (host === 3 && type !== 0 && type !== 0o100000 && type !== 0o040000) {
      const name = strFromU8(zip.subarray(at + 46, at + 46 + nameLength), !utf8);
      throw archiveInvalid(
        `A package holds regular files only; this entry is a link or a special file: ${name}`,
      );
    }
    at = next;
  }
  // The directory may end with a digital signature after its file headers (APPNOTE §4.3.12).
  if (at + 6 <= directoryEnd && view.getUint32(at, true) === 0x05054b50) {
    at += 6 + view.getUint16(at + 4, true);
  }
  if (at !== directoryEnd) throw invalid();
  // Start fflate's footer search at the checked record, even if the archive comment contains a signature.
  return zip.subarray(0, end + 22);
}

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
