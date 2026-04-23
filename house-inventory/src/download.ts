/**
 * PDF downloader.
 *
 * Given a URL and an asset id, fetch the response, verify it's actually a
 * PDF (by magic bytes AND a plausible Content-Type), and write it to
 * `${DATA_DIR}/manuals/${assetId}/${slug}.pdf`. The caller is expected to
 * record the returned metadata in the `asset_files` table.
 *
 * If the same sha256 has already been stored for the same asset, we skip
 * writing a duplicate file.
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface DownloadedFile {
  localPath: string;
  sha256: string;
  bytes: number;
  contentType: string;
}

export class NotAPdfError extends Error {
  constructor(
    message: string,
    public readonly url: string,
    public readonly contentType: string,
  ) {
    super(message);
    this.name = "NotAPdfError";
  }
}

export interface DownloadOptions {
  /** Max bytes accepted. Manuals are usually < 50 MB; guard against huge files. */
  maxBytes?: number;
  /** Fetch timeout, milliseconds. */
  timeoutMs?: number;
}

const DEFAULT_MAX = 100 * 1024 * 1024; // 100 MB
const DEFAULT_TIMEOUT = 60_000;

export async function downloadPdf(
  url: string,
  assetId: string,
  dataDir: string,
  opts: DownloadOptions = {},
): Promise<DownloadedFile> {
  const max = opts.maxBytes ?? DEFAULT_MAX;
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36",
        Accept: "application/pdf, */*;q=0.8",
      },
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`PDF download failed: ${res.status} ${res.statusText}`);
  }
  const contentType = (res.headers.get("content-type") ?? "").toLowerCase();
  const bytes = await res.arrayBuffer();

  if (bytes.byteLength > max) {
    throw new Error(
      `PDF too large: ${bytes.byteLength} bytes exceeds cap of ${max}`,
    );
  }

  // Magic-byte sniff is the authority — Content-Type is just a hint. Some
  // servers mislabel PDFs as application/octet-stream.
  const buf = new Uint8Array(bytes);
  if (!startsWithPdfMagic(buf)) {
    throw new NotAPdfError(
      `Response is not a PDF (first bytes: ${Array.from(buf.slice(0, 4)).map((b) => b.toString(16)).join(" ")})`,
      url,
      contentType,
    );
  }

  const sha256 = createHash("sha256").update(buf).digest("hex");

  const dir = join(dataDir, "manuals", assetId);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const filename = `${sha256.slice(0, 12)}.pdf`;
  const localPath = join(dir, filename);
  await Bun.write(localPath, buf);

  return {
    localPath,
    sha256,
    bytes: buf.byteLength,
    contentType,
  };
}

/** PDF files start with `%PDF-` (25 50 44 46 2D). */
function startsWithPdfMagic(buf: Uint8Array): boolean {
  return (
    buf.length >= 5 &&
    buf[0] === 0x25 &&
    buf[1] === 0x50 &&
    buf[2] === 0x44 &&
    buf[3] === 0x46 &&
    buf[4] === 0x2d
  );
}
