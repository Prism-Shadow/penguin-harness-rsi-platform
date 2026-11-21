/**
 * Zip fixtures for the package import: a zip as the request carries it (base64), and one whose
 * entries declare more than they hold, the shape of a zip bomb.
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
