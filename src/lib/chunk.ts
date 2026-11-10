function findNaturalEnd(
  text: string,
  start: number,
  size: number,
  overlap: number,
): number {
  const maximumEnd = Math.min(start + size, text.length);

  if (maximumEnd === text.length) {
    return maximumEnd;
  }

  const window = text.slice(start, maximumEnd);

  // Prevent tiny chunks and guarantee that start moves forward.
  const minimumLength = Math.max(overlap + 1, Math.floor(size / 2));

  // Prefer the final paragraph boundary in the window.
  // Supports Unix and Windows line endings, with optional spaces.
  const paragraphPattern = /\r?\n[ \t]*\r?\n/g;
  let paragraphEnd = -1;

  for (const match of window.matchAll(paragraphPattern)) {
    const candidate = match.index + match[0].length;

    if (candidate >= minimumLength) {
      paragraphEnd = candidate;
    }
  }

  if (paragraphEnd !== -1) {
    return start + paragraphEnd;
  }

  // Otherwise, prefer the final sentence boundary.
  const sentencePattern = /[.!?](?:["')\]]*)(?=\s|$)/g;
  let sentenceEnd = -1;

  for (const match of window.matchAll(sentencePattern)) {
    const candidate = match.index + match[0].length;

    if (candidate >= minimumLength) {
      sentenceEnd = candidate;
    }
  }

  if (sentenceEnd !== -1) {
    return start + sentenceEnd;
  }

  // Otherwise, avoid splitting a word.
  const whitespaceIndex = window.lastIndexOf(" ");

  if (whitespaceIndex + 1 >= minimumLength) {
    return start + whitespaceIndex + 1;
  }

  // A long sentence or word must be split at the hard limit.
  return maximumEnd;
}

export function chunkText(
  text: string,
  size: number,
  overlap: number,
): string[] {
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error("Size must be a positive integer");
  }
  if (!Number.isInteger(overlap) || overlap < 0) {
    throw new Error("Overlap must be a non-negative integer");
  }
  if (overlap >= size) {
    throw new Error("Overlap must be smaller than size");
  }

  const chunks: string[] = [];

  let start = 0;
  while (start < text.length) {
    const end = findNaturalEnd(text, start, size, overlap);

    chunks.push(text.slice(start, end));

    if (end >= text.length) {
      break;
    }

    start = end - overlap;
  }

  return chunks;
}
