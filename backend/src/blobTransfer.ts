import {
  get,
  issueSignedToken,
  put,
  presignUrl,
  del,
  type PutBlobResult
} from "@vercel/blob";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import type { IncomingMessage } from "http";

/** Stay under Vercel Hobby request/response body limits (~4.5MB). */
export const INLINE_TRANSFER_MAX_BYTES = 3_000_000;

export function blobAccess(): "private" | "public" {
  return (process.env.BLOB_ACCESS ?? "private").trim().toLowerCase() === "public"
    ? "public"
    : "private";
}

export function canUseBlobTransfer(): boolean {
  return Boolean(
    process.env.BLOB_READ_WRITE_TOKEN?.trim() ||
      (process.env.BLOB_STORE_ID?.trim() && process.env.VERCEL_OIDC_TOKEN?.trim())
  );
}

export async function readBlobText(pathname: string): Promise<string> {
  const result = await get(pathname, { access: blobAccess(), useCache: false });
  if (!result || result.statusCode !== 200 || !result.stream) {
    throw new Error(`Import blob not found: ${pathname}`);
  }
  return new Response(result.stream).text();
}

export async function putJsonBlob(
  pathname: string,
  content: string
): Promise<PutBlobResult> {
  const bytes = Buffer.byteLength(content, "utf8");
  return put(pathname, content, {
    access: blobAccess(),
    addRandomSuffix: true,
    allowOverwrite: true,
    contentType: "application/json; charset=utf-8",
    cacheControlMaxAge: 60,
    multipart: bytes > 4 * 1024 * 1024
  });
}

export async function createPresignedGetUrl(pathname: string): Promise<string> {
  const issued = await issueSignedToken({
    pathname,
    operations: ["get"],
    validUntil: Date.now() + 30 * 60 * 1000
  });
  const { presignedUrl } = await presignUrl(issued, {
    access: blobAccess(),
    operation: "get",
    pathname,
    useCache: false,
    validUntil: Date.now() + 30 * 60 * 1000
  });
  return presignedUrl;
}

export async function handleBlobClientUpload(opts: {
  body: HandleUploadBody;
  request: IncomingMessage;
}): Promise<
  | { type: "blob.generate-client-token"; clientToken: string }
  | { type: "blob.upload-completed"; response: "ok" }
> {
  return handleUpload({
    body: opts.body,
    request: opts.request,
    onBeforeGenerateToken: async (pathname) => {
      // Scope client uploads to interchange staging only.
      if (!pathname.startsWith("focista-schedulo/imports/")) {
        throw new Error("Invalid upload pathname (expected focista-schedulo/imports/...)");
      }
      return {
        allowedContentTypes: [
          "application/json",
          "text/csv",
          "text/plain",
          "application/octet-stream"
        ],
        maximumSizeInBytes: 50 * 1024 * 1024,
        addRandomSuffix: true,
        allowOverwrite: false
      };
    }
  });
}

export async function deleteBlobQuietly(urlOrPathname: string): Promise<void> {
  try {
    await del(urlOrPathname);
  } catch (err) {
    console.warn(
      "[blobTransfer] delete failed",
      err instanceof Error ? err.message : String(err)
    );
  }
}
