// Hardening checks: zip bombs (real inflation, not declared sizes), rate-limit client identity, bucket growth.
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { assertSafeZip, ZipTooLarge, DOCX_LIMITS } from "@/lib/kb/zipguard";
import { extractText } from "@/lib/kb/extract";
import { clientIp, rateLimit, rateLimitUser, LIMITS } from "@/lib/rate-limit";

let passed = 0;
async function t(name: string, fn: () => void | Promise<void>) {
  try { await fn(); passed++; console.log(`  ✓ ${name}`); } catch (e) { process.exitCode = 1; console.log(`  ✗ ${name}\n    ${(e as Error).message.split("\n").slice(0, 4).join("\n    ")}`); }
}

/** Minimal zip writer (deflate). `lieAbout` rewrites the declared uncompressed size, as a malicious archive would. */
function zip(entries: { name: string; data: Buffer }[], lieAbout?: number): Buffer {
  const parts: Buffer[] = [], central: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const comp = zlib.deflateRawSync(e.data, { level: 9 });
    const name = Buffer.from(e.name);
    const declared = lieAbout ?? e.data.length;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(declared, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(declared, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    parts.push(lh, name, comp); central.push(ch, name);
    offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}

async function main() {
  console.log("document upload limits");
  await t("a normal archive passes and reports its real inflated size", () => {
    assert.equal(assertSafeZip(zip([{ name: "word/document.xml", data: Buffer.from("<w:t>hello</w:t>".repeat(100)) }])), 1600);
  });
  await t("a zip bomb that DECLARES a tiny size is still refused (declared sizes are not trusted)", () => {
    const bomb = zip([{ name: "word/document.xml", data: Buffer.alloc(200 * 1024 * 1024) }], 10);
    assert.ok(bomb.length < 1024 * 1024, `bomb is only ${bomb.length} bytes on disk`);
    assert.throws(() => assertSafeZip(bomb), ZipTooLarge);
  });
  await t("many entries that are each fine but together too big are refused", () => {
    const e = Array.from({ length: 6 }, (_, i) => ({ name: `f${i}`, data: Buffer.alloc(8 * 1024 * 1024) }));
    assert.throws(() => assertSafeZip(zip(e)), ZipTooLarge);
  });
  await t("too many entries are refused", () => {
    const e = Array.from({ length: DOCX_LIMITS.maxEntries + 1 }, (_, i) => ({ name: `f${i}`, data: Buffer.from("x") }));
    assert.throws(() => assertSafeZip(zip(e)), ZipTooLarge);
  });
  await t("extractText turns a bomb into a clear 'too_large' answer and never calls the parser", async () => {
    const r = await extractText({ name: "resume.docx", bytes: zip([{ name: "word/document.xml", data: Buffer.alloc(200 * 1024 * 1024) }], 10) });
    assert.ok("error" in r && r.error === "too_large", JSON.stringify(r).slice(0, 120));
  });
  await t("garbage that starts with PK is 'unreadable', not a crash", async () => {
    const r = await extractText({ name: "x.docx", bytes: Buffer.concat([Buffer.from("PK"), Buffer.alloc(300, 7)]) });
    assert.ok("error" in r && r.error === "unreadable");
  });

  console.log("rate-limit identity and growth");
  const req = (xff: string) => new Request("http://x/", { headers: { "x-forwarded-for": xff } });
  await t("a client-supplied X-Forwarded-For prefix is ignored: the address our proxy appended is used", () => {
    assert.equal(clientIp(req("1.2.3.4, 9.9.9.9"), {}), "9.9.9.9");
    assert.equal(clientIp(req("evil, 9.9.9.9"), { TRUSTED_PROXY_HOPS: "1" }), "9.9.9.9");
    assert.equal(clientIp(req("a, b, c"), { TRUSTED_PROXY_HOPS: "2" }), "b");
    assert.equal(clientIp(req("1.2.3.4"), { TRUSTED_PROXY_HOPS: "0" }), "unknown", "with no proxy the header is not trusted at all");
  });
  await t("rotating the spoofed prefix does not reset the limit", () => {
    const max = LIMITS.createProfile.max;
    let blocked = 0;
    for (let i = 0; i < max + 3; i++) if (rateLimit(req(`10.0.0.${i}, 8.8.4.4`), "createProfile")) blocked++;
    assert.equal(blocked, 3);
  });
  await t("a per-account limit holds across different IP addresses", () => {
    const max = LIMITS.write.max;
    let blocked = 0;
    for (let i = 0; i < max + 2; i++) if (rateLimitUser(4242, "write")) blocked++;
    assert.equal(blocked, 2);
    assert.equal(rateLimitUser(4243, "write"), null, "another account is unaffected");
  });
  await t("distinct keys cannot grow memory without bound", () => {
    for (let i = 0; i < 25_000; i++) rateLimitUser(100_000 + i, "read");
    const size = ((globalThis as any).__sfRate as Map<string, unknown>).size;
    assert.ok(size <= 20_000, `size ${size}`);
  });
  console.log(`\n${passed} hardening checks passed`);
}
main();
