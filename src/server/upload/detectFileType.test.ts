import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { detectFileType } from "./detectFileType";

describe("detectFileType", () => {
  it("detects a PDF from its signature", async () => {
    const bytes = new TextEncoder().encode("%PDF-1.7");

    await expect(detectFileType(bytes)).resolves.toBe("application/pdf");
  });

  it("detects a PNG from its signature", async () => {
    const bytes = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);

    await expect(detectFileType(bytes)).resolves.toBe("image/png");
  });

  it("detects a JPEG from its signature", async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff]);

    await expect(detectFileType(bytes)).resolves.toBe("image/jpeg");
  });

  it("detects a PPTX by inspecting its ZIP contents", async () => {
    const zip = new JSZip();
    zip.file("ppt/presentation.xml", "<presentation />");
    const bytes = await zip.generateAsync({ type: "uint8array" });

    await expect(detectFileType(bytes)).resolves.toBe(
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    );
  });

  it("detects valid UTF-8 plain text", async () => {
    const bytes = new TextEncoder().encode("Course notes");

    await expect(detectFileType(bytes)).resolves.toBe("text/plain");
  });

  it("detects valid multibyte UTF-8 plain text", async () => {
    const bytes = new TextEncoder().encode("Résumé 日本語");

    await expect(detectFileType(bytes)).resolves.toBe("text/plain");
  });

  it("rejects executable bytes renamed as a PDF", async () => {
    const bytes = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]);

    await expect(detectFileType(bytes)).resolves.toBeNull();
  });

  it("rejects a ZIP that is not a PPTX", async () => {
    const zip = new JSZip();
    zip.file("notes.txt", "Course notes");
    const bytes = await zip.generateAsync({ type: "uint8array" });

    await expect(detectFileType(bytes)).resolves.toBeNull();
  });

  it("rejects an empty ZIP", async () => {
    const zip = new JSZip();
    const bytes = await zip.generateAsync({ type: "uint8array" });

    await expect(detectFileType(bytes)).resolves.toBeNull();
  });

  it("rejects a ZIP with an incorrect PPTX path", async () => {
    const zip = new JSZip();
    zip.file("ppt/slides.xml", "<slides />");
    const bytes = await zip.generateAsync({ type: "uint8array" });

    await expect(detectFileType(bytes)).resolves.toBeNull();
  });

  it("rejects text containing a zero byte", async () => {
    const bytes = new Uint8Array([0x68, 0x69, 0x00]);

    await expect(detectFileType(bytes)).resolves.toBeNull();
  });

  it("rejects invalid UTF-8", async () => {
    const bytes = new Uint8Array([0xc3, 0x28]);

    await expect(detectFileType(bytes)).resolves.toBeNull();
  });

  it("rejects a truncated JPEG signature", async () => {
    const bytes = new Uint8Array([0xff, 0xd8]);

    await expect(detectFileType(bytes)).resolves.toBeNull();
  });

  it("does not detect a signature that is not at the beginning", async () => {
    const bytes = new Uint8Array([
      0x01, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);

    await expect(detectFileType(bytes)).resolves.toBeNull();
  });

  it("rejects a malformed ZIP", async () => {
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04]);

    await expect(detectFileType(bytes)).resolves.toBeNull();
  });

  it("rejects an empty file", async () => {
    await expect(detectFileType(new Uint8Array())).resolves.toBeNull();
  });
});
