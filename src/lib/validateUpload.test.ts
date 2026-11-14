import { describe, expect, it } from "vitest";
import { validateUpload } from "./validateUpload";

describe("Unit tests for validateUpload", () => {
  it.each([
    ["PDF", "document.pdf", "application/pdf"],
    [
      "PPTX",
      "slides.pptx",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
    ["PNG", "image.png", "image/png"],
    ["JPEG", "image.jpg", "image/jpeg"],
    ["plain text", "notes.txt", "text/plain"],
  ])("allows %s files", (_label, name, type) => {
    const result = validateUpload({
      name,
      type,
      size: 1,
    });

    expect(result).toEqual({ ok: true });
  });

  it("rejects unsupported file types", () => {
    const result = validateUpload({
      name: "program.exe",
      type: "application/x-msdownload",
      size: 1,
    });
    expect(result).toEqual({ ok: false, reason: "Unsupported file type" });
  });

  it("rejects unsupported file types with allowed-looking filename", () => {
    const result = validateUpload({
      name: "program.pdf",
      type: "application/x-msdownload",
      size: 1,
    });

    expect(result).toEqual({ ok: false, reason: "Unsupported file type" });
  });

  it("rejects files larger than 25MB", () => {
    const result = validateUpload({
      name: "notes.pdf",
      type: "application/pdf",
      size: 25 * 1024 * 1024 + 1,
    });

    expect(result).toEqual({
      ok: false,
      reason: "File exceeds the 25MB size limit",
    });
  });

  it("allow files exactly 25MB", () => {
    const result = validateUpload({
      name: "notes.pdf",
      type: "application/pdf",
      size: 25 * 1024 * 1024,
    });

    expect(result).toEqual({
      ok: true,
    });
  });

  it("rejects empty files", () => {
    const result = validateUpload({
      name: "notes.pdf",
      type: "application/pdf",
      size: 0,
    });

    expect(result).toEqual({
      ok: false,
      reason: "File is empty",
    });
  });
});
