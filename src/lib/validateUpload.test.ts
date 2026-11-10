import { describe, expect, it } from "vitest";
import { validateUpload } from "./validateUpload";

describe("Unit tests for validateUpload", () => {
  it("allows PDF files", () => {
    const result = validateUpload({
      name: "document.pdf",
      type: "application/pdf",
      size: 1,
    });

    expect(result).toEqual({ ok: true });
  });

  it("allows PPTX files", () => {
    const result = validateUpload({
      name: "slides.pptx",
      type: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      size: 1,
    });

    expect(result).toEqual({ ok: true });
  });

  it("allows PNG files", () => {
    const result = validateUpload({
      name: "image.png",
      type: "image/png",
      size: 1,
    });

    expect(result).toEqual({ ok: true });
  });

  it("allows JPEG files", () => {
    const result = validateUpload({
      name: "image.jpg",
      type: "image/jpeg",
      size: 1,
    });

    expect(result).toEqual({ ok: true });
  });

  it("allows plain text files", () => {
    const result = validateUpload({
      name: "notes.txt",
      type: "text/plain",
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
