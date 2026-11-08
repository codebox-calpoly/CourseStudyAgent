export function chunkText(
  text: string,
  size: number,
  overlap: number,
): string[] {
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error("Size must be greater than zero");
  }
  if (!Number.isInteger(overlap) || overlap < 0) {
    throw new Error("Overlap cannot be negative");
  }
  if (overlap >= size) {
    throw new Error("Overlap must be smaller than size");
  }

  const chunks: string[] = [];

  let start = 0;
  while (start < text.length) {
    chunks.push(text.slice(start, start + size));

    if (start + size >= text.length) {
      break;
    }

    start = start + size - overlap;
  }

  return chunks;
}
