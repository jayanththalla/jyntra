// DOCX is a ZIP. A zip bomb is small on disk and huge when inflated, and the sizes in the archive's own headers can lie, so the
// declared sizes are NOT trusted: every entry is actually inflated here, with a hard output cap, before the file reaches a parser.
import zlib from "node:zlib";

export interface ZipLimits {
  maxEntries: number;
  maxEntryBytes: number;
  maxTotalBytes: number;
}
export const DOCX_LIMITS: ZipLimits = { maxEntries: 500, maxEntryBytes: 20 * 1024 * 1024, maxTotalBytes: 40 * 1024 * 1024 };

export class ZipTooLarge extends Error {}

/** Throws ZipTooLarge (or a generic Error for a malformed archive). Returns the real total of inflated bytes. */
export function assertSafeZip(zip: Buffer, limits: ZipLimits = DOCX_LIMITS): number {
  // End-of-central-directory record (search the last 64 KB + 22 bytes for its signature).
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (zip.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip");
  const count = zip.readUInt16LE(eocd + 10);
  if (count > limits.maxEntries) throw new ZipTooLarge("too many entries");
  let p = zip.readUInt32LE(eocd + 16);
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > zip.length || zip.readUInt32LE(p) !== 0x02014b50) throw new Error("bad central directory");
    const method = zip.readUInt16LE(p + 10);
    const compSize = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28), extraLen = zip.readUInt16LE(p + 30), commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    p += 46 + nameLen + extraLen + commentLen;
    if (local + 30 > zip.length || zip.readUInt32LE(local) !== 0x04034b50) throw new Error("bad local header");
    const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
    const data = zip.subarray(start, start + compSize);
    let size: number;
    if (method === 0) size = data.length;
    else if (method === 8) {
      try {
        // maxOutputLength makes zlib stop and throw instead of allocating the whole bomb.
        size = zlib.inflateRawSync(data, { maxOutputLength: Math.min(limits.maxEntryBytes, limits.maxTotalBytes - total) + 1 }).length;
      } catch (e) {
        if ((e as { code?: string }).code === "ERR_BUFFER_TOO_LARGE") throw new ZipTooLarge("expands too much");
        throw new Error("corrupt entry");
      }
    } else throw new Error("unsupported compression");
    if (size > limits.maxEntryBytes) throw new ZipTooLarge("entry expands too much");
    total += size;
    if (total > limits.maxTotalBytes) throw new ZipTooLarge("archive expands too much");
  }
  return total;
}
