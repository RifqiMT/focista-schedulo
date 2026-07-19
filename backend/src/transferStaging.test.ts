import { describe, expect, it } from "vitest";
import {
  INLINE_TRANSFER_MAX_BYTES,
  LOCAL_INLINE_TRANSFER_MAX_BYTES,
  inlineExportMaxBytes,
  isExportStagingPathname,
  isImportStagingPathname
} from "./transferStaging";

describe("transferStaging", () => {
  it("keeps inline transfer under Vercel Hobby body limits", () => {
    expect(INLINE_TRANSFER_MAX_BYTES).toBeLessThan(4.5 * 1024 * 1024);
    expect(INLINE_TRANSFER_MAX_BYTES).toBeGreaterThan(1024 * 1024);
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
});
