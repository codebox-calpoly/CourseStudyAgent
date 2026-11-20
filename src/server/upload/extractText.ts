import JSZip from "jszip";
import { extractText as extractPdfText } from "unpdf";

import type { AllowedMimeType } from "@/lib/validateUpload";

export type ExtractedSection = { page: number | null; text: string };

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

function extractSlideText(xml: string): string {
  const paragraphs = Array.from(
    xml.matchAll(/<a:p(?:\s[^>]*)?>([\s\S]*?)<\/a:p>/g),
    (paragraphMatch) =>
      Array.from(
        (paragraphMatch[1] ?? "").matchAll(
          /<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g,
        ),
        (textMatch) => decodeXmlEntities(textMatch[1] ?? ""),
      ).join(""),
  );

  return paragraphs.filter(Boolean).join("\n");
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

async function extractPptxSections(
  bytes: Uint8Array,
): Promise<ExtractedSection[]> {
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

  return Promise.all(
    slides.map(async ({ number, file }) => {
      const xml = await file.async("string");

      return {
        page: number,
        text: extractSlideText(xml),
      };
    }),
  );
}

function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function extractText(
  bytes: Uint8Array,
  mimeType: AllowedMimeType,
): Promise<ExtractedSection[]> {
  let sections: ExtractedSection[];

  switch (mimeType) {
    case "application/pdf": {
      const result = await extractPdfText(bytes, { mergePages: false });

      sections = result.text.map((text, index) => ({
        page: index + 1,
        text,
      }));
      break;
    }
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
      sections = await extractPptxSections(bytes);
      break;
    case "text/plain":
      sections = [
        {
          page: null,
          text: new TextDecoder("utf-8").decode(bytes),
        },
      ];
      break;
    case "image/png":
    case "image/jpeg":
      sections = [];
      break;
    default: {
      const unhandledMimeType: never = mimeType;
      throw new Error(`Unhandled MIME type: ${unhandledMimeType}`);
    }
  }

  return sections
    .map((section) => ({
      ...section,
      text: normalizeText(section.text),
    }))
    .filter((section) => section.text.length > 0);
}
