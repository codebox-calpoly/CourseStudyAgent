const maxSize = 25 * 1024 * 1024; // 25MB in bytes
const allowedMimeTypes = new Set<string>([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/png",
  "image/jpeg",
  "text/plain",
]);

export function validateUpload(file: {
  name: string;
  type: string;
  size: number;
}): { ok: true } | { ok: false; reason: string } {
  if (!allowedMimeTypes.has(file.type)) {
    return {
      ok: false,
      reason: "Unsupported file type",
    };
  }

  if (file.size <= 0) {
    return {
      ok: false,
      reason: "File is empty",
    };
  }

  if (file.size > maxSize) {
    return {
      ok: false,
      reason: "File exceeds the 25MB size limit",
    };
  }

  return { ok: true };
}
