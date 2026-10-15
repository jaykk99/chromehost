/**
 * vortex-ipfs.ts — "Make public" publishing via IPFS. Pure JavaScript.
 *
 * Runs a Helia IPFS node (no kubo binary, no external daemon, no API keys,
 * no accounts) and publishes static site deployments as content-addressed
 * CIDs. The public link is then a plain gateway URL:
 *   https://ipfs.io/ipfs/<cid>
 *
 * After publishing, the app "warms" several major public gateways with a
 * tiny range-GET so they fetch and cache a copy. That keeps the link working
 * even when this device is OFF — as long as the gateways hold it cached.
 * A permanent guarantee would require paid pinning; we don't do that, and
 * the UI/docs say so honestly.
 *
 * Scope: STATIC sites only (HTML/CSS/JS). There is no server here, so
 * anything needing a backend cannot work — publish refuses those honestly.
 *
 * helia / @helia/unixfs are ESM-only, while this project ships as CommonJS,
 * so they are loaded with dynamic import() inside async functions.
 */

import fs from "fs";
import path from "path";
import { vortexDataDir } from "./vortex-sqlite";

export const IPFS_GATEWAYS = [
  "https://ipfs.io/ipfs",
  "https://cloudflare-ipfs.com/ipfs",
  "https://dweb.link/ipfs",
  "https://gateway.pinata.cloud/ipfs",
];

/** Public gateway URLs for a CID. */
export function ipfsGatewayUrls(cid: string): string[] {
  return IPFS_GATEWAYS.map((g) => `${g}/${cid}`);
}

type HeliaNode = any;
type UnixFSApi = any;

let heliaNode: HeliaNode | null = null;
let unixFs: UnixFSApi | null = null;
let nodeRepoPath: string | null = null;

/** Where the Helia repo (DHT cache, blocks) lives. */
export function ipfsRepoPath(): string {
  const dir = path.join(vortexDataDir(), "ipfs-repo");
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch {
    // createHelia will surface a clear error if unusable
  }
  return dir;
}

/**
 * Start (or reuse) the embedded Helia node. Idempotent.
 * `repoPath` override is for tests (use a temp dir).
 */
export async function startIpfsNode(repoPath?: string): Promise<HeliaNode> {
  if (heliaNode) return heliaNode;
  const { createHelia } = await import("helia");
  const { unixfs } = await import("@helia/unixfs");
  // helia v7 dropped the `repo` path option — createHelia now takes explicit
  // datastore/blockstore instances. We use in-memory stores from
  // datastore-core/blockstore-core (already present, no new deps): blocks live
  // for the life of this process, and publishBytesToIpfs warms public gateways
  // so the CID stays reachable after we go offline. `repo` is kept for API
  // compatibility (callers may pass a test dir); the directory is still created.
  const { MemoryDatastore } = await import("datastore-core");
  const { MemoryBlockstore } = await import("blockstore-core");
  const repo = repoPath || ipfsRepoPath();
  heliaNode = await createHelia({
    datastore: new MemoryDatastore(),
    blockstore: new MemoryBlockstore(),
  });
  unixFs = unixfs(heliaNode);
  nodeRepoPath = repo;
  try {
    console.error(`[vortex-ipfs] Helia node started. Peer ID: ${heliaNode.libp2p.peerId.toString()}`);
  } catch {
    console.error("[vortex-ipfs] Helia node started.");
  }
  return heliaNode;
}

/** Stop the node (releases the repo lock). */
export async function stopIpfsNode(): Promise<void> {
  if (heliaNode) {
    try {
      await heliaNode.stop();
    } catch {
      // ignore
    }
    heliaNode = null;
    unixFs = null;
    nodeRepoPath = null;
  }
}

/** Our peer ID, or null when the node isn't running. */
export function getIpfsPeerId(): string | null {
  try {
    return heliaNode ? heliaNode.libp2p.peerId.toString() : null;
  } catch {
    return null;
  }
}

async function ensureFs(repoPath?: string): Promise<UnixFSApi> {
  if (!unixFs) await startIpfsNode(repoPath);
  return unixFs;
}

export interface IpfsPublishResult {
  cid: string;
  urls: string[];
  peerId: string | null;
  /** How many gateways acknowledged the warm-up fetch. Best-effort. */
  warmedGateways: number;
}

/**
 * Publish raw bytes (a static site file) to IPFS. Returns the CID plus
 * public gateway URLs. Warming is kicked off but never blocks the result.
 */
export async function publishBytesToIpfs(
  data: Uint8Array,
  opts: { repoPath?: string; warm?: boolean } = {}
): Promise<IpfsPublishResult> {
  const f = await ensureFs(opts.repoPath);
  const cid = await f.addBytes(data);
  const cidStr = cid.toString();
  const urls = ipfsGatewayUrls(cidStr);
  // Fire-and-forget: warm gateway caches so the link survives us going offline.
  let warmed = 0;
  if (opts.warm !== false) {
    warmGatewayCache(cidStr)
      .then((r) => {
        warmed = r.warmed.length;
      })
      .catch(() => {
        // never fail a publish because warming failed
      });
  }
  return { cid: cidStr, urls, peerId: getIpfsPeerId(), warmedGateways: warmed };
}

/** Read bytes back through our own node (proves the publish round-trips). */
export async function catBytesFromIpfs(cid: string, repoPath?: string): Promise<Uint8Array> {
  const f = await ensureFs(repoPath);
  const chunks: Uint8Array[] = [];
  for await (const chunk of f.cat(cid)) {
    chunks.push(chunk);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}

export interface WarmResult {
  attempted: number;
  warmed: string[];
}

/**
 * Ask major public gateways to fetch+cache the CID (tiny 1KB range GET).
 * Best-effort: timeouts and failures are swallowed. `fetchImpl` is
 * injectable so tests can mock it — never assert live gateway behavior.
 */
export async function warmGatewayCache(
  cid: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 20000
): Promise<WarmResult> {
  const urls = ipfsGatewayUrls(cid);
  const warmed: string[] = [];
  await Promise.all(
    urls.map(async (u) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetchImpl(u, {
          headers: { Range: "bytes=0-1023" },
          signal: ctrl.signal,
          redirect: "follow",
        } as any);
        // 200 or 206 means the gateway served (and cached) bytes.
        if (res && (res.ok || (res as any).status === 206)) {
          try {
            await (res as any).arrayBuffer();
          } catch {
                // body read is best-effort too
          }
          warmed.push(u);
        }
      } catch {
        // gateway unreachable / timeout — best effort, ignore
      } finally {
        clearTimeout(timer);
      }
    })
  );
  return { attempted: urls.length, warmed };
}
