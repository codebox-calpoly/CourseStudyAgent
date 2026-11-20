import { readFile } from "node:fs/promises";

import JSZip from "jszip";
import { extractText as extractPdfText } from "unpdf";
import { afterEach, describe, expect, it, vi } from "vitest";

import { extractText } from "./extractText";

const PPTX_MIME_TYPE =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";
const MAX_PPTX_UNCOMPRESSED_SIZE_BYTES = 50 * 1024 * 1024;

vi.mock("unpdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("unpdf")>();

  return {
    ...actual,
    extractText: vi.fn(actual.extractText),
  };
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("extractText", () => {
  it("extracts known text from a PDF fixture under 5 KB", async () => {
    const fixtureUrl = new URL("./fixtures/known-text.pdf", import.meta.url);
    const bytes = new Uint8Array(await readFile(fixtureUrl));

    expect(bytes.byteLength).toBeLessThan(5 * 1024);
    await expect(extractText(bytes, "application/pdf")).resolves.toEqual([
      { page: 1, text: "CourseStudyAgent PDF fixture text." },
    ]);
  });

  it("returns normalized PDF pages with original page numbers and drops empty pages", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    vi.mocked(extractPdfText).mockResolvedValueOnce({
      totalPages: 3,
      text: ["  First page.  ", " \r\n ", "Third page.\n\n\nNext paragraph."],
    });

    await expect(extractText(bytes, "application/pdf")).resolves.toEqual([
      { page: 1, text: "First page." },
      { page: 3, text: "Third page.\n\nNext paragraph." },
    ]);
    expect(extractPdfText).toHaveBeenCalledWith(bytes, { mergePages: false });
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
        `<p:sld><a:p><a:t>${slideText}</a:t></a:p></p:sld>`,
      );
    }

    const bytes = await zip.generateAsync({ type: "uint8array" });
    const expected = [
      { page: 1, text: `Slide 1 & <tag> "quoted" 'apostrophe'` },
      ...Array.from({ length: 9 }, (_, index) => ({
        page: index + 2,
        text: `Slide ${index + 2}`,
      })),
    ];

    await expect(extractText(bytes, PPTX_MIME_TYPE)).resolves.toEqual(expected);
  });

  it("decodes decimal and hexadecimal numeric PPTX entities", async () => {
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      "<p:sld><a:p><a:t>PowerPoint&#8217;s &#x201C;smart quotes&#x201D;</a:t></a:p></p:sld>",
    );

    const bytes = await zip.generateAsync({ type: "uint8array" });

    await expect(extractText(bytes, PPTX_MIME_TYPE)).resolves.toEqual([
      { page: 1, text: "PowerPoint’s “smart quotes”" },
    ]);
  });

  it("extracts multiple PPTX text runs with attributes in order", async () => {
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      '<p:sld><a:p><a:t xml:space="preserve">Hello </a:t><a:t>world</a:t></a:p></p:sld>',
    );

    const bytes = await zip.generateAsync({ type: "uint8array" });

    await expect(extractText(bytes, PPTX_MIME_TYPE)).resolves.toEqual([
      { page: 1, text: "Hello world" },
    ]);
  });

  it("separates PPTX paragraphs without separating runs within a paragraph", async () => {
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      '<p:sld><a:p><a:t>Processes</a:t></a:p><a:p><a:t xml:space="preserve">Isolated </a:t><a:t>memory</a:t></a:p></p:sld>',
    );

    const bytes = await zip.generateAsync({ type: "uint8array" });

    await expect(extractText(bytes, PPTX_MIME_TYPE)).resolves.toEqual([
      { page: 1, text: "Processes\nIsolated memory" },
    ]);
  });

  it("ignores non-slide files in a PPTX archive", async () => {
    const zip = new JSZip();
    zip.file(
      "ppt/slides/slide1.xml",
      "<p:sld><a:p><a:t>Visible slide</a:t></a:p></p:sld>",
    );
    zip.file(
      "ppt/notesSlides/slide1.xml",
      "<p:notes><a:p><a:t>Ignored speaker notes</a:t></a:p></p:notes>",
    );
    zip.file("ppt/theme/theme1.xml", "<a:t>Ignored theme text</a:t>");
    zip.file("ppt/media/image1.png", new Uint8Array([1, 2, 3]));
    zip.folder("ppt/slides/archive");

    const bytes = await zip.generateAsync({ type: "uint8array" });

    await expect(extractText(bytes, PPTX_MIME_TYPE)).resolves.toEqual([
      { page: 1, text: "Visible slide" },
    ]);
  });

  it("returns no sections for a PPTX with no slide XML files", async () => {
    const zip = new JSZip();
    zip.file("[Content_Types].xml", "<Types />");

    const bytes = await zip.generateAsync({ type: "uint8array" });

    await expect(extractText(bytes, PPTX_MIME_TYPE)).resolves.toEqual([]);
  });

  it("drops PPTX slides whose normalized text is empty", async () => {
    const zip = new JSZip();
    zip.file("ppt/slides/slide1.xml", "<p:sld><a:p></a:p></p:sld>");
    zip.file(
      "ppt/slides/slide2.xml",
      "<p:sld><a:p><a:t>Visible slide</a:t></a:p></p:sld>",
    );

    const bytes = await zip.generateAsync({ type: "uint8array" });

    await expect(extractText(bytes, PPTX_MIME_TYPE)).resolves.toEqual([
      { page: 2, text: "Visible slide" },
    ]);
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
      .mockResolvedValue("<p:sld><a:p><a:t>At the limit</a:t></a:p></p:sld>");
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

    await expect(
      extractText(new Uint8Array(), PPTX_MIME_TYPE),
    ).resolves.toEqual([{ page: 1, text: "At the limit" }]);
    expect(readSlide).toHaveBeenCalledOnce();
  });

  it("does not count files that are not decompressed toward the limit", async () => {
    const readSlide = vi
      .fn()
      .mockResolvedValue("<p:sld><a:p><a:t>Visible slide</a:t></a:p></p:sld>");
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

    await expect(
      extractText(new Uint8Array(), PPTX_MIME_TYPE),
    ).resolves.toEqual([{ page: 1, text: "Visible slide" }]);
    expect(readVideo).not.toHaveBeenCalled();
    expect(readSlide).toHaveBeenCalledOnce();
  });

  it("decodes UTF-8 text and normalizes surrounding and repeated newlines", async () => {
    const bytes = new TextEncoder().encode(
      "  Héllo, 世界!\r\n\r\n\r\n\r\nSecond paragraph.  ",
    );

    await expect(extractText(bytes, "text/plain")).resolves.toEqual([
      { page: null, text: "Héllo, 世界!\n\nSecond paragraph." },
    ]);
  });

  it("returns no sections for an empty text file", async () => {
    await expect(extractText(new Uint8Array(), "text/plain")).resolves.toEqual(
      [],
    );
  });

  it("preserves exactly two newlines", async () => {
    const bytes = new TextEncoder().encode("First\n\nSecond");

    await expect(extractText(bytes, "text/plain")).resolves.toEqual([
      { page: null, text: "First\n\nSecond" },
    ]);
  });

  it("collapses three newlines into two", async () => {
    const bytes = new TextEncoder().encode("First\n\n\nSecond");

    await expect(extractText(bytes, "text/plain")).resolves.toEqual([
      { page: null, text: "First\n\nSecond" },
    ]);
  });

  it.each(["image/png", "image/jpeg"] as const)(
    "returns no sections for %s images",
    async (mimeType) => {
      await expect(
        extractText(new Uint8Array([1, 2, 3]), mimeType),
      ).resolves.toEqual([]);
    },
  );

  it("rejects corrupted PDF data", async () => {
    const bytes = new TextEncoder().encode("not a valid PDF");

    await expect(extractText(bytes, "application/pdf")).rejects.toThrow();
  });

  it("rejects corrupted PPTX data", async () => {
    const bytes = new TextEncoder().encode("not a valid ZIP archive");

    await expect(extractText(bytes, PPTX_MIME_TYPE)).rejects.toThrow();
  });
});
