import { describe, expect, it } from "vitest";
import {
  INLINE_TRANSFER_MAX_BYTES,
  LOCAL_INLINE_TRANSFER_MAX_BYTES,
  TRANSFER_UPLOAD_CHUNK_MAX_BYTES,
  assembleTransferChunks,
  inlineExportMaxBytes,
  isExportStagingPathname,
  isImportStagingPathname,
  parseChunkMeta,
  transferChunkPathname
} from "./transferStaging";

describe("transferStaging", () => {
  it("keeps inline transfer under Vercel Hobby body limits", () => {
    expect(INLINE_TRANSFER_MAX_BYTES).toBeLessThan(4.5 * 1024 * 1024);
    expect(INLINE_TRANSFER_MAX_BYTES).toBeGreaterThan(1024 * 1024);
    expect(TRANSFER_UPLOAD_CHUNK_MAX_BYTES).toBeLessThan(INLINE_TRANSFER_MAX_BYTES);
  });

  it("allows a larger inline export ceiling off Vercel", () => {
    expect(LOCAL_INLINE_TRANSFER_MAX_BYTES).toBeGreaterThan(INLINE_TRANSFER_MAX_BYTES);
    expect(inlineExportMaxBytes(true)).toBe(INLINE_TRANSFER_MAX_BYTES);
    expect(inlineExportMaxBytes(false)).toBe(LOCAL_INLINE_TRANSFER_MAX_BYTES);
  });

  it("validates staging pathname prefixes", () => {
    expect(isImportStagingPathname("focista-schedulo/imports/a.json")).toBe(true);
    expect(isExportStagingPathname("focista-schedulo/exports/a.json")).toBe(true);
    expect(isImportStagingPathname("focista-schedulo/exports/a.json")).toBe(false);
  });

  it("assembles binary chunks without UTF-8 corruption across boundaries", () => {
    const text = "café-任务-🙂";
    const buf = Buffer.from(text, "utf8");
    const a = buf.subarray(0, 3);
    const b = buf.subarray(3);
    expect(assembleTransferChunks([a, b])).toBe(text);
  });

  it("parses chunk meta headers", () => {
    expect(parseChunkMeta({ index: "0", total: "3" })).toEqual({ index: 0, total: 3 });
    expect(parseChunkMeta({ index: "3", total: "3" })).toBeNull();
    expect(parseChunkMeta({})).toBeNull();
    expect(transferChunkPathname("focista-schedulo/imports/x.json", 2)).toBe(
      "focista-schedulo/imports/x.json__chunk__2"
    );
  });
});
