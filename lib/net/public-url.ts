// Public HTTPS destination checks: used for application links and logo fetches.
// Private, local, and credential-bearing URLs are rejected so we never follow them as a server.
import dns from "node:dns/promises";
import net from "node:net";

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === "::1" || l === "::" || l.startsWith("fe80") || /^f[cd]/.test(l)) return true;
    const m = l.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return m ? isPrivateAddress(m[1]) : false;
  }
  return true;
}

const BLOCKED_HOST = /^localhost$|\.localhost$|\.local$|\.internal$|\.arpa$/i;

let resolver: (host: string) => Promise<string[]> = async (h) => (await dns.lookup(h, { all: true })).map((a) => a.address);
/** Tests replace DNS so no network is used. */
export const setPublicHostResolver = (fn: (host: string) => Promise<string[]>) => {
  resolver = fn;
};

export class UnsafeUrlError extends Error {
  /** "dns" = the host did not resolve (a network condition, NOT proof the address is private); "private" = it resolved to a non-public address. */
  constructor(message: string, public kind: "policy" | "dns" | "private" = "policy") {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

/** HTTPS-only public URL. Rejects javascript:, data:, file:, credentials, and private hosts. */
export async function assertPublicHttpsUrl(raw: string): Promise<URL> {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new UnsafeUrlError("malformed URL");
  }
  if (u.protocol !== "https:") throw new UnsafeUrlError("only HTTPS is allowed");
  if (u.username || u.password) throw new UnsafeUrlError("embedded credentials are not allowed");
  if (!u.hostname) throw new UnsafeUrlError("missing host");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (BLOCKED_HOST.test(host)) throw new UnsafeUrlError("that address is not public");
  const ips = net.isIP(host) ? [host] : await resolver(host).catch(() => []);
  if (!ips.length) throw new UnsafeUrlError("that address is not public", "dns"); // message kept for existing callers; `kind` tells the cause
  if (ips.some(isPrivateAddress)) throw new UnsafeUrlError("that address is not public", "private");
  return u;
}
