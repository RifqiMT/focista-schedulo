import { describe, expect, it } from "vitest";
import { INLINE_TRANSFER_MAX_BYTES, blobAccess, canUseBlobTransfer } from "./blobTransfer";

describe("blobTransfer", () => {
  it("keeps inline transfer under Vercel Hobby body limits", () => {
    expect(INLINE_TRANSFER_MAX_BYTES).toBeLessThan(4.5 * 1024 * 1024);
    expect(INLINE_TRANSFER_MAX_BYTES).toBeGreaterThan(1024 * 1024);
  });

  it("defaults blob access to private", () => {
    expect(blobAccess()).toBe("private");
  });

  it("detects missing blob credentials", () => {
    const prevToken = process.env.BLOB_READ_WRITE_TOKEN;
    const prevStore = process.env.BLOB_STORE_ID;
    const prevOidc = process.env.VERCEL_OIDC_TOKEN;
    delete process.env.BLOB_READ_WRITE_TOKEN;
    delete process.env.BLOB_STORE_ID;
    delete process.env.VERCEL_OIDC_TOKEN;
    expect(canUseBlobTransfer()).toBe(false);
    if (prevToken !== undefined) process.env.BLOB_READ_WRITE_TOKEN = prevToken;
    if (prevStore !== undefined) process.env.BLOB_STORE_ID = prevStore;
    if (prevOidc !== undefined) process.env.VERCEL_OIDC_TOKEN = prevOidc;
  });
});
