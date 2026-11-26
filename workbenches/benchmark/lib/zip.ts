/**
 * A zip container over Node's own zlib, both ways: reading the archive a member uploads, and
 * writing the package a Benchmark exports. The handler compiles from this folder alone, so it
 * carries no zip library; what a Benchmark package needs is small — stored or deflated entries,
 * no encryption, no spanning, ZIP64 only for an entry count past 65,534 (APPNOTE 6.3.10).
 *
 * Reading checks the whole central directory before a byte is inflated — the end record, the
 * ZIP64 records when there are some, every entry's record inside the directory and the directory
 * ending where the end record says — and refuses a link or any other special file by the type in
 * its external attributes, since the bytes alone do not say. `admit` sees every file entry's
 * declared size first, so a cap refuses an entry before it is inflated; an entry that then
 * inflates to anything but that size, or to other bytes than its CRC-32 names, is corrupt.
 *
 * Writing is deterministic: entries in the order given, deflated at zlib's default level, every
 * one stamped 1980-01-01 00:00 (the format's first day, a local time that reads the same in every
 * zone), so the same files always give the same bytes.
 */
import { crc32, deflateRawSync, inflateRawSync } from "node:zlib";

/** Why an archive is not a zip this module reads. */
export type ZipProblem =
  /** The end record, the ZIP64 records or the directory's file records do not hold together. */
  | "directory"
  /** An entry is a symbolic link or another special file. */
  | "special"
  /** An entry's local header or data is broken, or it uses what this reader does not read. */
  | "entry";

export class ZipError extends Error {
  constructor(
    readonly problem: ZipProblem,
    message: string,
    /** The entry the problem is about, when it is one. */
    readonly entry?: string,
  ) {
    super(message);
    this.name = "ZipError";
  }
}

const LOCAL_HEADER = 0x04034b50;
const CENTRAL_HEADER = 0x02014b50;
const END_OF_DIRECTORY = 0x06054b50;
const ZIP64_END_OF_DIRECTORY = 0x06064b50;
const ZIP64_LOCATOR = 0x07064b50;
const DIGITAL_SIGNATURE = 0x05054b50;
const ZIP64_EXTRA = 0x0001;
const UTF8_FLAG = 0x0800;
const ENCRYPTED_FLAG = 0x0001;
const STORED = 0;
const DEFLATED = 8;
/** `version made by` high byte for Unix, whose external attributes carry the file type. */
const UNIX = 3;
const TYPE_MASK = 0o170000;
const REGULAR = 0o100000;
const DIRECTORY = 0o040000;

/** One file entry as the central directory declares it. */
export interface ZipEntryInfo {
  name: string;
  /** The uncompressed size the directory declares. */
  originalSize: number;
}

interface DirectoryRecord {
  name: string;
  method: number;
  crc: number;
  compressedSize: number;
  originalSize: number;
  localOffset: number;
}

const directory = () => new ZipError("directory", "Invalid ZIP central directory.");
const corrupt = (name: string, why: string) => new ZipError("entry", `${why}: ${name}`, name);

/** A name as the entry stores it: UTF-8 when its flag says so, else one byte per character. */
function nameOf(bytes: Uint8Array, utf8: boolean): string {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString(
    utf8 ? "utf8" : "latin1",
  );
}

/** The ZIP64 values an entry's extra field carries for the fields its record marks as all ones. */
function zip64Values(
  view: DataView,
  start: number,
  length: number,
  wanted: { original: boolean; compressed: boolean; offset: boolean },
): { original?: number; compressed?: number; offset?: number } {
  let at = start;
  const end = start + length;
  while (at + 4 <= end) {
    const id = view.getUint16(at, true);
    const size = view.getUint16(at + 2, true);
    if (at + 4 + size > end) throw directory();
    if (id === ZIP64_EXTRA) {
      let field = at + 4;
      const take = (want: boolean): number | undefined => {
        if (!want) return undefined;
        if (field + 8 > at + 4 + size) throw directory();
        const value = Number(view.getBigUint64(field, true));
        field += 8;
        return value;
      };
      const original = take(wanted.original);
      const compressed = take(wanted.compressed);
      const offset = take(wanted.offset);
      return {
        ...(original !== undefined ? { original } : {}),
        ...(compressed !== undefined ? { compressed } : {}),
        ...(offset !== undefined ? { offset } : {}),
      };
    }
    at += 4 + size;
  }
  if (wanted.original || wanted.compressed || wanted.offset) throw directory();
  return {};
}

/** The central directory's file records, every one checked to lie inside it. */
function readDirectory(zip: Uint8Array): DirectoryRecord[] {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // The end record: 22 bytes, then a comment of up to 64KB, at the very end.
  let end = -1;
  for (let i = zip.byteLength - 22; i >= Math.max(0, zip.byteLength - 22 - 0xffff); i--) {
    if (
      view.getUint32(i, true) === END_OF_DIRECTORY &&
      i + 22 + view.getUint16(i + 20, true) === zip.byteLength
    ) {
      end = i;
      break;
    }
  }
  if (end < 0) throw directory();
  let diskCount = view.getUint16(end + 8, true);
  let count = view.getUint16(end + 10, true);
  let size = view.getUint32(end + 12, true);
  let at = view.getUint32(end + 16, true);
  let directoryEnd = end;
  const locator = end - 20;
  if (locator >= 0 && view.getUint32(locator, true) === ZIP64_LOCATOR) {
    const record = Number(view.getBigUint64(locator + 8, true));
    if (
      record + 56 > locator ||
      view.getUint32(record, true) !== ZIP64_END_OF_DIRECTORY ||
      view.getBigUint64(record + 4, true) !== BigInt(locator - record - 12)
    ) {
      throw directory();
    }
    // A classic field holds either the value itself or the all-ones marker for its ZIP64 value.
    const expanded = (offset: number, classic: number, marker: number): number => {
      const value = Number(view.getBigUint64(record + offset, true));
      if (classic !== marker && classic !== value) throw directory();
      return value;
    };
    diskCount = expanded(24, diskCount, 0xffff);
    count = expanded(32, count, 0xffff);
    size = expanded(40, size, 0xffffffff);
    at = expanded(48, at, 0xffffffff);
    directoryEnd = record;
  }
  if (diskCount !== count || at + size !== directoryEnd || count * 46 > size) throw directory();
  const records: DirectoryRecord[] = [];
  for (let n = 0; n < count; n++) {
    if (at + 46 > directoryEnd || view.getUint32(at, true) !== CENTRAL_HEADER) throw directory();
    const host = view.getUint8(at + 5);
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const compressed32 = view.getUint32(at + 20, true);
    const original32 = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const attributes = view.getUint32(at + 38, true);
    const offset32 = view.getUint32(at + 42, true);
    const next = at + 46 + nameLength + extraLength + commentLength;
    if (next > directoryEnd) throw directory();
    const name = nameOf(zip.subarray(at + 46, at + 46 + nameLength), (flags & UTF8_FLAG) !== 0);
    const type = (attributes >>> 16) & TYPE_MASK;
    if (host === UNIX && type !== 0 && type !== REGULAR && type !== DIRECTORY) {
      throw new ZipError(
        "special",
        `A package holds regular files only; this entry is a link or a special file: ${name}`,
        name,
      );
    }
    if ((flags & ENCRYPTED_FLAG) !== 0) throw corrupt(name, "Encrypted zip entry");
    const big = zip64Values(view, at + 46 + nameLength, extraLength, {
      original: original32 === 0xffffffff,
      compressed: compressed32 === 0xffffffff,
      offset: offset32 === 0xffffffff,
    });
    records.push({
      name,
      method,
      crc,
      compressedSize: big.compressed ?? compressed32,
      originalSize: big.original ?? original32,
      localOffset: big.offset ?? offset32,
    });
    at = next;
  }
  // The directory may end with a digital signature after its file headers (APPNOTE 4.3.13).
  if (at + 6 <= directoryEnd && view.getUint32(at, true) === DIGITAL_SIGNATURE) {
    at += 6 + view.getUint16(at + 4, true);
  }
  if (at !== directoryEnd) throw directory();
  return records;
}

/**
 * Every file entry of `zip`, by name, in directory order; a directory entry (a name ending in
 * "/") is passed over. `admit` sees each file entry's declared size before it is inflated and
 * throws to refuse it. An entry named twice is corrupt: a copy holds one file per path.
 */
export function readZip(
  zip: Uint8Array,
  admit: (entry: ZipEntryInfo) => void = () => {},
): Map<string, Uint8Array> {
  const records = readDirectory(zip);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const files = new Map<string, Uint8Array>();
  for (const record of records) {
    if (record.name.endsWith("/")) continue;
    if (files.has(record.name)) throw corrupt(record.name, "Zip entry listed twice");
    admit({ name: record.name, originalSize: record.originalSize });
    const at = record.localOffset;
    if (at + 30 > zip.byteLength || view.getUint32(at, true) !== LOCAL_HEADER) {
      throw corrupt(record.name, "Zip entry has no local header");
    }
    const start = at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
    const stop = start + record.compressedSize;
    if (stop > zip.byteLength) throw corrupt(record.name, "Zip entry runs past the archive");
    const stored = zip.subarray(start, stop);
    let data: Uint8Array;
    if (record.method === STORED) {
      data = stored;
    } else if (record.method === DEFLATED) {
      try {
        // Never more than it declared: a bomb stops at the size the cap already took.
        data = inflateRawSync(stored, { maxOutputLength: Math.max(1, record.originalSize) });
      } catch {
        throw corrupt(record.name, "Zip entry does not inflate to its declared size");
      }
    } else {
      throw corrupt(record.name, `Zip entry uses compression method ${record.method}`);
    }
    if (data.byteLength !== record.originalSize) {
      throw corrupt(record.name, "Zip entry does not inflate to its declared size");
    }
    if (crc32(data) >>> 0 !== record.crc >>> 0) {
      throw corrupt(record.name, "Zip entry does not match its checksum");
    }
    files.set(record.name, new Uint8Array(data));
  }
  return files;
}

/** 1980-01-01 00:00:00 in MS-DOS date and time fields. */
const DOS_DATE = (0 << 9) | (1 << 5) | 1;
const DOS_TIME = 0;

/**
 * `files` as a zip, in the order given: deflated entries named in UTF-8, the fixed time above,
 * and the ZIP64 end records once the entry count fills the classic 16-bit field. Sizes and offsets
 * stay 32-bit: a package is capped far below 4GB.
 */
export function writeZip(files: ReadonlyArray<readonly [string, Uint8Array]>): Uint8Array {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, data] of files) {
    const nameBytes = Buffer.from(name, "utf8");
    const body = deflateRawSync(data);
    const crc = crc32(data) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(LOCAL_HEADER, 0);
    local.writeUInt16LE(20, 4); // version needed: deflate
    local.writeUInt16LE(UTF8_FLAG, 6);
    local.writeUInt16LE(DEFLATED, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.byteLength, 18);
    local.writeUInt32LE(data.byteLength, 22);
    local.writeUInt16LE(nameBytes.byteLength, 26);
    local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(CENTRAL_HEADER, 0);
    central.writeUInt16LE(20, 4); // version made by: MS-DOS, 2.0
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(UTF8_FLAG, 8);
    central.writeUInt16LE(DEFLATED, 10);
    central.writeUInt16LE(DOS_TIME, 12);
    central.writeUInt16LE(DOS_DATE, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.byteLength, 20);
    central.writeUInt32LE(data.byteLength, 24);
    central.writeUInt16LE(nameBytes.byteLength, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBytes, body);
    centrals.push(central, nameBytes);
    offset += 30 + nameBytes.byteLength + body.byteLength;
  }
  const directoryStart = offset;
  const directorySize = centrals.reduce((sum, part) => sum + part.byteLength, 0);
  const count = files.length;
  const tail: Buffer[] = [];
  if (count >= 0xffff) {
    const record = Buffer.alloc(56);
    record.writeUInt32LE(ZIP64_END_OF_DIRECTORY, 0);
    record.writeBigUInt64LE(44n, 4);
    record.writeUInt16LE(45, 12); // version 4.5, made by and needed to extract
    record.writeUInt16LE(45, 14);
    record.writeBigUInt64LE(BigInt(count), 24);
    record.writeBigUInt64LE(BigInt(count), 32);
    record.writeBigUInt64LE(BigInt(directorySize), 40);
    record.writeBigUInt64LE(BigInt(directoryStart), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(ZIP64_LOCATOR, 0);
    locator.writeBigUInt64LE(BigInt(directoryStart + directorySize), 8);
    locator.writeUInt32LE(1, 16); // one disk
    tail.push(record, locator);
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(END_OF_DIRECTORY, 0);
  end.writeUInt16LE(Math.min(count, 0xffff), 8);
  end.writeUInt16LE(Math.min(count, 0xffff), 10);
  end.writeUInt32LE(directorySize, 12);
  end.writeUInt32LE(directoryStart, 16);
  tail.push(end);
  return new Uint8Array(Buffer.concat([...locals, ...centrals, ...tail]));
}
