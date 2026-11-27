/**
 * Zip fixtures for the package import, built with fflate, a zip implementation independent of the
 * handler's own (workbenches/benchmark/lib/zip.ts): a zip as the request carries it (base64), one
 * whose entries declare more than they hold, the shape of a zip bomb, and one whose entry count
 * only ZIP64 records carry.
 */
import { zipSync, type Zippable } from "fflate";

/** `files` zipped and base64-encoded, as `dataBase64` carries an upload. */
export function zipB64(files: Zippable): string {
  return Buffer.from(zipSync(files)).toString("base64");
}

/**
 * A zip whose named entries declare `declared` bytes uncompressed, in the local header and the
 * central directory alike, over the payload they really hold: a reader allocates what the header
 * says.
 */
export function zipB64Declaring(
  files: Record<string, Uint8Array>,
  declared: Record<string, number>,
): string {
  const zip = zipSync(files);
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const decoder = new TextDecoder();
  const nameAt = (start: number, lenAt: number, nameOffset: number): string =>
    decoder.decode(
      zip.subarray(start + nameOffset, start + nameOffset + view.getUint16(start + lenAt, true)),
    );
  for (let i = 0; i + 4 <= zip.byteLength; i++) {
    const signature = view.getUint32(i, true);
    if (signature === 0x04034b50) {
      const size = declared[nameAt(i, 26, 30)];
      if (size !== undefined) view.setUint32(i + 22, size, true);
    }
    if (signature === 0x02014b50) {
      const size = declared[nameAt(i, 28, 46)];
      if (size !== undefined) view.setUint32(i + 24, size, true);
    }
  }
  return Buffer.from(zip).toString("base64");
}

/**
 * fflate's `zipSync` output with its end record moved to ZIP64: the classic counts set to the
 * all-ones marker and a ZIP64 end record and locator before it that declare `count` entries. fflate
 * writes no ZIP64 records of its own, and an entry count past 65,535 does not fit the classic
 * field; with `count` other than the entries the directory holds, the records disagree with it.
 */
export function withZip64Count(zip: Uint8Array, count: number): Uint8Array {
  // zipSync writes a 22-byte end record with no archive comment.
  const endOffset = zip.byteLength - 22;
  const end = Buffer.from(zip.subarray(endOffset));
  const record = Buffer.alloc(56);
  record.writeUInt32LE(0x06064b50, 0);
  record.writeBigUInt64LE(44n, 4);
  record.writeUInt16LE(45, 12); // version 4.5, made by and needed to extract
  record.writeUInt16LE(45, 14);
  record.writeBigUInt64LE(BigInt(count), 24);
  record.writeBigUInt64LE(BigInt(count), 32);
  record.writeBigUInt64LE(BigInt(end.readUInt32LE(12)), 40); // directory size
  record.writeBigUInt64LE(BigInt(end.readUInt32LE(16)), 48); // directory offset
  const locator = Buffer.alloc(20);
  locator.writeUInt32LE(0x07064b50, 0);
  locator.writeBigUInt64LE(BigInt(endOffset), 8);
  locator.writeUInt32LE(1, 16); // one disk
  end.writeUInt16LE(0xffff, 8);
  end.writeUInt16LE(0xffff, 10);
  return new Uint8Array(Buffer.concat([zip.subarray(0, endOffset), record, locator, end]));
}
