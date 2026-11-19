import JSZip from "jszip";
import { extractText as extractPdfText } from "unpdf";

const MAX_PPTX_UNCOMPRESSED_SIZE_BYTES = 50 * 1024 * 1024;

type ZipFileWithSize = JSZip.JSZipObject & {
  _data?: {
    uncompressedSize?: unknown;
  };
};

const XML_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeXmlEntities(text: string): string {
  return text
    .replace(
      /&(amp|lt|gt|quot|apos);/g,
      (match: string, entity: string) => XML_ENTITIES[entity] ?? match,
    )
    .replace(/&#(x[0-9a-f]+|\d+);/gi, (_match, value: string) =>
      String.fromCodePoint(
        value.toLowerCase().startsWith("x")
          ? Number.parseInt(value.slice(1), 16)
          : Number.parseInt(value, 10),
      ),
    );
}

function assertPptxSizeWithinLimit(files: JSZip.JSZipObject[]): void {
  let totalUncompressedSize = 0;

  for (const file of files) {
    const uncompressedSize = (file as ZipFileWithSize)._data?.uncompressedSize;

    if (
      typeof uncompressedSize !== "number" ||
      !Number.isSafeInteger(uncompressedSize) ||
      uncompressedSize < 0
    ) {
      throw new Error("Could not determine PPTX uncompressed size");
    }

    totalUncompressedSize += uncompressedSize;

    if (totalUncompressedSize > MAX_PPTX_UNCOMPRESSED_SIZE_BYTES) {
      throw new Error("PPTX uncompressed size exceeds 50 MB");
    }
  }
}

async function extractPptxText(bytes: Uint8Array): Promise<string> {
  const zip = await JSZip.loadAsync(bytes);

  const slides = Object.values(zip.files)
    .flatMap((file) => {
      const match = /^ppt\/slides\/slide(\d+)\.xml$/.exec(file.name);

      if (!match || file.dir) {
        return [];
      }

      return [
        {
          number: Number(match[1]),
          file,
        },
      ];
    })
    .sort((first, second) => first.number - second.number);

  assertPptxSizeWithinLimit(slides.map(({ file }) => file));

  const slideTexts = await Promise.all(
    slides.map(async ({ file }) => {
      const xml = await file.async("string");

      const textRuns = Array.from(
        xml.matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g),
        (match) => decodeXmlEntities(match[1] ?? ""),
      );

      return textRuns.join("");
    }),
  );

  return slideTexts.join("\n\n");
}

function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractText(
  bytes: Uint8Array,
  mimeType: string,
): Promise<string> {
  let text: string;

  if (mimeType === "application/pdf") {
    const result = await extractPdfText(bytes, { mergePages: true });
    text = result.text;
  } else if (
    mimeType ===
    "application/vnd.openxmlformats-officedocument.presentationml.presentation"
  ) {
    text = await extractPptxText(bytes);
  } else if (mimeType === "text/plain") {
    text = new TextDecoder("utf-8").decode(bytes);
  } else if (mimeType === "image/png" || mimeType === "image/jpeg") {
    return "";
  } else {
    throw new Error(`Unsupported MIME type: ${mimeType}`);
  }

  return normalizeText(text);
}
