import { readFile } from "node:fs/promises";

import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";

import { extractText } from "./extractText";

const PPTX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const MAX_PPTX_UNCOMPRESSED_SIZE_BYTES = 50 * 1024 * 1024;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("extractText", () => {
  it("extracts known text from a PDF fixture under 5 KB", async () => {
    const fixtureUrl = new URL("./fixtures/known-text.pdf", import.meta.url);
    const bytes = new Uint8Array(await readFile(fixtureUrl));

    expect(bytes.byteLength).toBeLessThan(5 * 1024);
    await expect(extractText(bytes, "application/pdf")).resolves.toBe(
      "CourseStudyAgent PDF fixture text.",
    );
  });

  it("extracts PPTX slides in numeric order and decodes XML entities", async () => {
    const zip = new JSZip();
    const encodedFirstSlide =
      "Slide 1 &amp; &lt;tag&gt; &quot;quoted&quot; &apos;apostrophe&apos;";

    for (let slideNumber = 10; slideNumber >= 1; slideNumber--) {
      const slideText =
        slideNumber === 1 ? encodedFirstSlide : `Slide ${slideNumber}`;

      zip.file(
        `ppt/slides/slide${slideNumber}.xml`,
        `<p:sld><a:t>${slideText}</a:t></p:sld>`,
      );
    }

    const bytes = await zip.generateAsync({ type: "uint8array" });
    const expected = [
      `Slide 1 & <tag> "quoted" 'apostrophe'`,
      ...Array.from({ length: 9 }, (_, index) => `Slide ${index + 2}`),
    ].join("\n\n");

    await expect(extractText(bytes, PPTX_MIME_TYPE)).resolves.toBe(expected);
  });

  it("decodes decimal and hexadecimal numeric PPTX entities", async () => {
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      "<p:sld><a:t>PowerPoint&#8217;s &#x201C;smart quotes&#x201D;</a:t></p:sld>",
    );

    const bytes = await zip.generateAsync({ type: "uint8array" });

    await expect(extractText(bytes, PPTX_MIME_TYPE)).resolves.toBe(
      "PowerPoint’s “smart quotes”",
    );
  });

  it("extracts multiple PPTX text runs with attributes in order", async () => {
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      '<p:sld><a:t xml:space="preserve">Hello </a:t><a:t>world</a:t></p:sld>',
    );

    const bytes = await zip.generateAsync({ type: "uint8array" });

    await expect(extractText(bytes, PPTX_MIME_TYPE)).resolves.toBe(
      "Hello world",
    );
  });

  it("ignores non-slide files in a PPTX archive", async () => {
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      "<p:sld><a:t>Visible slide</a:t></p:sld>",
    );
    zip.file(
      "ppt/notesSlides/slide1.xml",
      "<p:notes><a:t>Ignored speaker notes</a:t></p:notes>",
    );
    zip.file("ppt/theme/theme1.xml", "<a:t>Ignored theme text</a:t>");
    zip.file("ppt/media/image1.png", new Uint8Array([1, 2, 3]));
    zip.folder("ppt/slides/archive");

    const bytes = await zip.generateAsync({ type: "uint8array" });

    await expect(extractText(bytes, PPTX_MIME_TYPE)).resolves.toBe(
      "Visible slide",
    );
  });

  it("returns empty text for a PPTX with no slide XML files", async () => {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", "<Types />");

    const bytes = await zip.generateAsync({ type: "uint8array" });

    await expect(extractText(bytes, PPTX_MIME_TYPE)).resolves.toBe("");
  });

  it("rejects a PPTX over the 50 MB uncompressed limit before reading files", async () => {
    const readSlide = vi.fn();
    vi.spyOn(JSZip, "loadAsync").mockResolvedValue({
      files: {
        "ppt/slides/slide1.xml": {
          name: "ppt/slides/slide1.xml",
          dir: false,
          _data: {
            uncompressedSize: MAX_PPTX_UNCOMPRESSED_SIZE_BYTES + 1,
          },
          async: readSlide,
        },
      },
    } as unknown as JSZip);

    await expect(extractText(new Uint8Array(), PPTX_MIME_TYPE)).rejects.toThrow(
      "PPTX uncompressed size exceeds 50 MB",
    );
    expect(readSlide).not.toHaveBeenCalled();
  });

  it("allows a PPTX exactly at the 50 MB uncompressed limit", async () => {
    const readSlide = vi
      .fn()
      .mockResolvedValue("<p:sld><a:t>At the limit</a:t></p:sld>");
    vi.spyOn(JSZip, "loadAsync").mockResolvedValue({
      files: {
        "ppt/slides/slide1.xml": {
          name: "ppt/slides/slide1.xml",
          dir: false,
          _data: {
            uncompressedSize: MAX_PPTX_UNCOMPRESSED_SIZE_BYTES,
          },
          async: readSlide,
        },
      },
    } as unknown as JSZip);

    await expect(extractText(new Uint8Array(), PPTX_MIME_TYPE)).resolves.toBe(
      "At the limit",
    );
    expect(readSlide).toHaveBeenCalledOnce();
  });

  it("does not count files that are not decompressed toward the limit", async () => {
    const readSlide = vi
      .fn()
      .mockResolvedValue("<p:sld><a:t>Visible slide</a:t></p:sld>");
    const readVideo = vi.fn();

    vi.spyOn(JSZip, "loadAsync").mockResolvedValue({
      files: {
        "ppt/media/video1.mp4": {
          name: "ppt/media/video1.mp4",
          dir: false,
          _data: {
            uncompressedSize: MAX_PPTX_UNCOMPRESSED_SIZE_BYTES + 1,
          },
          async: readVideo,
        },
        "ppt/slides/slide1.xml": {
          name: "ppt/slides/slide1.xml",
          dir: false,
          _data: {
            uncompressedSize: 1,
          },
          async: readSlide,
        },
      },
    } as unknown as JSZip);

    await expect(extractText(new Uint8Array(), PPTX_MIME_TYPE)).resolves.toBe(
      "Visible slide",
    );
    expect(readVideo).not.toHaveBeenCalled();
    expect(readSlide).toHaveBeenCalledOnce();
  });

  it("decodes UTF-8 text and normalizes surrounding and repeated newlines", async () => {
    const bytes = new TextEncoder().encode(
      "  Héllo, 世界!\r\n\r\n\r\n\r\nSecond paragraph.  ",
    );

    await expect(extractText(bytes, "text/plain")).resolves.toBe(
      "Héllo, 世界!\n\nSecond paragraph.",
    );
  });

  it("returns empty text for an empty text file", async () => {
    await expect(extractText(new Uint8Array(), "text/plain")).resolves.toBe("");
  });

  it("preserves exactly two newlines", async () => {
    const bytes = new TextEncoder().encode("First\n\nSecond");

    await expect(extractText(bytes, "text/plain")).resolves.toBe(
      "First\n\nSecond",
    );
  });

  it("collapses three newlines into two", async () => {
    const bytes = new TextEncoder().encode("First\n\n\nSecond");

    await expect(extractText(bytes, "text/plain")).resolves.toBe(
      "First\n\nSecond",
    );
  });

  it.each(["image/png", "image/jpeg"])(
    "returns empty text for %s images",
    async (mimeType) => {
      await expect(
        extractText(new Uint8Array([1, 2, 3]), mimeType),
      ).resolves.toBe("");
    },
  );

  it("throws for an unsupported MIME type", async () => {
    await expect(
      extractText(new Uint8Array(), "application/octet-stream"),
    ).rejects.toThrow("Unsupported MIME type: application/octet-stream");
  });

  it("rejects corrupted PDF data", async () => {
    const bytes = new TextEncoder().encode("not a valid PDF");

    await expect(extractText(bytes, "application/pdf")).rejects.toThrow();
  });

  it("rejects corrupted PPTX data", async () => {
    const bytes = new TextEncoder().encode("not a valid ZIP archive");

    await expect(extractText(bytes, PPTX_MIME_TYPE)).rejects.toThrow();
  });
});
