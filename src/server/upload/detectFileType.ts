import type { AllowedMimeType } from "../../lib/validateUpload";
import JSZip from "jszip";

const pdfSignature = [0x25, 0x50, 0x44, 0x46, 0x2d] as const;
const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const;
const jpegSignature = [0xff, 0xd8, 0xff] as const;
const zipSignature = [0x50, 0x4b, 0x03, 0x04] as const;

function startsWithSignature(
  bytes: Uint8Array,
  signature: readonly number[],
): boolean {
  if (bytes.length < signature.length) {
    return false;
  }

  return signature.every(
    (expectedByte, index) => bytes[index] === expectedByte,
  );
}

export async function detectFileType(
  bytes: Uint8Array,
): Promise<AllowedMimeType | null> {
  // Check empty files
  if (bytes.length === 0) {
    return null;
  }

  // Check PDF
  if (startsWithSignature(bytes, pdfSignature)) {
    return "application/pdf";
  }

  // Check PNG
  if (startsWithSignature(bytes, pngSignature)) {
    return "image/png";
  }

  // Check JPEG
  if (startsWithSignature(bytes, jpegSignature)) {
    return "image/jpeg";
  }

  // Check PPTX
  if (startsWithSignature(bytes, zipSignature)) {
    try {
      const zip = await JSZip.loadAsync(bytes);
      const presentation = zip.file("ppt/presentation.xml");

      if (presentation !== null) {
        return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
      }
      return null;
    } catch {
      return null;
    }
  }

  // Check plain text
  if (bytes.includes(0)) {
    return null;
  }

  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return "text/plain";
  } catch {
    return null;
  }
}
