/**
 * Monico Labs — IPFS publishing inside the static web build.
 *
 * Helia is designed for browser use: this module spins up an in-page Helia
 * node (dynamic import, so it only loads when you publish), adds the site's
 * HTML, and returns the CID plus public gateway URLs. No server involved.
 *
 * Honest limits (surfaced in the UI, not hidden):
 *  - Static HTML/CSS/JS only. Anything needing a backend can't work this way.
 *  - While this page is open, your browser is the provider. We ask public
 *    gateways to cache a copy so the link can survive this tab closing, but
 *    permanent availability is NOT guaranteed without paid pinning (not used).
 */

export const IPFS_GATEWAYS = [
  "https://ipfs.io/ipfs/<cid>",
  "https://cloudflare-ipfs.com/ipfs/<cid>",
  "https://dweb.link/ipfs/<cid>",
  "https://gateway.pinata.cloud/ipfs/<cid>",
];

/** Build the public gateway URLs for a CID. Pure function — easy to test. */
export function ipfsGatewayUrls(cid: string): string[] {
  return IPFS_GATEWAYS.map((template) => template.replace("<cid>", cid));
}

export interface WarmResult {
  attempted: string[];
  warmed: string[];
}

/**
 * Best-effort gateway cache warming: light range GETs so gateways fetch and
 * cache the content. Never throws; never blocks publishing (callers fire and
 * forget). fetchImpl is injectable for tests.
 */
export async function warmGatewayCache(
  cid: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 8000
): Promise<WarmResult> {
  const urls = ipfsGatewayUrls(cid);
  const warmed: string[] = [];
  await Promise.all(
    urls.map(async (url) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetchImpl(url, {
          signal: ctrl.signal,
          headers: { Range: "bytes=0-0" },
        });
        if (res.ok || res.status === 206) warmed.push(url);
      } catch {
        /* best-effort only */
      } finally {
        clearTimeout(timer);
      }
    })
  );
  return { attempted: urls, warmed };
}

interface HeliaNodeLike {
  stop(): Promise<void>;
}

let nodePromise: Promise<HeliaNodeLike> | null = null;

/** Lazily create (and reuse) the in-page Helia node. */
export async function getBrowserIpfsNode(): Promise<HeliaNodeLike> {
  if (!nodePromise) {
    nodePromise = (async () => {
      // Dynamic import: Helia is code-split out of the initial bundle and
      // only downloads when the user actually publishes.
      const { createHelia } = await import("helia");
      return (await createHelia()) as unknown as HeliaNodeLike;
    })().catch((err) => {
      nodePromise = null;
      throw err;
    });
  }
  return nodePromise;
}

export interface BrowserPublishResult {
  cid: string;
  urls: string[];
}

/** Publish static HTML from the browser. Returns the CID + gateway URLs. */
export async function publishHtmlToIpfs(html: string): Promise<BrowserPublishResult> {
  const node = await getBrowserIpfsNode();
  const { unixfs } = await import("@helia/unixfs");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fs = unixfs(node as any);
  const bytes = new TextEncoder().encode(html);
  const cid = await fs.addBytes(bytes);
  const cidStr = cid.toString();
  const urls = ipfsGatewayUrls(cidStr);
  // Warm gateway caches in the background — publish doesn't wait for it.
  warmGatewayCache(cidStr).catch(() => {});
  return { cid: cidStr, urls };
}

/** Round-trip check: fetch content back through the local node. */
export async function catHtmlFromIpfs(cid: string): Promise<string> {
  const node = await getBrowserIpfsNode();
  const { unixfs } = await import("@helia/unixfs");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fs = unixfs(node as any);
  const chunks: Uint8Array[] = [];
  // The unixfs types ask for a CID object, but the runtime also accepts a CID
  // string — and passing the string avoids any dual-multiformats-instance
  // mismatch between this module and @helia/unixfs' bundled copy.
  const catPath = cid as unknown as Parameters<typeof fs.cat>[0];
  for await (const chunk of fs.cat(catPath)) {
    chunks.push(chunk);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder().decode(out);
}

/** Shut the in-page node down (used by tests; the app keeps it alive). */
export async function stopBrowserIpfsNode(): Promise<void> {
  if (nodePromise) {
    const node = await nodePromise.catch(() => null);
    nodePromise = null;
    await node?.stop().catch(() => {});
  }
}
