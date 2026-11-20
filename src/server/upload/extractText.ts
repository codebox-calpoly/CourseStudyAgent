import { posix as path } from "node:path";

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

function getXmlAttribute(element: string, name: string): string | undefined {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(
    element,
  );
  const value = match?.[1] ?? match?.[2];

  return value === undefined ? undefined : decodeXmlEntities(value);
}

function findNotesTarget(relationshipsXml: string): string | undefined {
  for (const match of relationshipsXml.matchAll(
    /<Relationship\b[^>]*\/?\s*>/g,
  )) {
    const relationship = match[0];
    const type = getXmlAttribute(relationship, "Type");

    if (
      type?.endsWith("/notesSlide") &&
      getXmlAttribute(relationship, "TargetMode") !== "External"
    ) {
      return getXmlAttribute(relationship, "Target");
    }
  }

  return undefined;
}

function resolveRelationshipTarget(sourcePath: string, target: string): string {
  if (target.startsWith("/")) {
    return path.normalize(target.slice(1));
  }

  return path.normalize(path.join(path.dirname(sourcePath), target));
}

function extractSpeakerNotesText(xml: string): string {
  const bodyShapeTexts: string[] = [];

  for (const match of xml.matchAll(/<p:sp(?:\s[^>]*)?>[\s\S]*?<\/p:sp>/g)) {
    const shape = match[0];
    const placeholder = /<p:ph\b[^>]*\/?\s*>/.exec(shape)?.[0];

    if (!placeholder || getXmlAttribute(placeholder, "type") !== "body") {
      continue;
    }

    bodyShapeTexts.push(extractSlideText(shape));
  }

  return bodyShapeTexts.filter(Boolean).join("\n");
}

function uniqueZipFiles(files: JSZip.JSZipObject[]): JSZip.JSZipObject[] {
  return [...new Map(files.map((file) => [file.name, file])).values()];
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

  const slidesWithRelationships = slides.map((slide) => {
    const relationshipPath = path.join(
      path.dirname(slide.file.name),
      "_rels",
      `${path.basename(slide.file.name)}.rels`,
    );
    const relationshipFile = zip.files[relationshipPath];

    return {
      ...slide,
      relationshipFile:
        relationshipFile && !relationshipFile.dir
          ? relationshipFile
          : undefined,
    };
  });

  assertPptxSizeWithinLimit(
    uniqueZipFiles(
      slidesWithRelationships.flatMap(({ file, relationshipFile }) =>
        relationshipFile ? [file, relationshipFile] : [file],
      ),
    ),
  );

  const notesFiles = await Promise.all(
    slidesWithRelationships.map(async ({ file, relationshipFile }) => {
      if (!relationshipFile) {
        return undefined;
      }

      const relationshipsXml = await relationshipFile.async("string");
      const notesTarget = findNotesTarget(relationshipsXml);

      if (!notesTarget) {
        return undefined;
      }

      const notesPath = resolveRelationshipTarget(file.name, notesTarget);
      const notesFile = zip.files[notesPath];

      return notesFile && !notesFile.dir ? notesFile : undefined;
    }),
  );

  assertPptxSizeWithinLimit(
    uniqueZipFiles([
      ...slidesWithRelationships.flatMap(({ file, relationshipFile }) =>
        relationshipFile ? [file, relationshipFile] : [file],
      ),
      ...notesFiles.filter(
        (file): file is JSZip.JSZipObject => file !== undefined,
      ),
    ]),
  );

  return Promise.all(
    slidesWithRelationships.map(async ({ number, file }, index) => {
      const notesFile = notesFiles[index];
      const [xml, notesXml] = await Promise.all([
        file.async("string"),
        notesFile?.async("string"),
      ]);
      const slideText = extractSlideText(xml);
      const notesText = notesXml ? extractSpeakerNotesText(notesXml) : "";

      return {
        page: number,
        text: notesText
          ? `${slideText}\n\nSpeaker notes:\n${notesText}`
          : slideText,
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
