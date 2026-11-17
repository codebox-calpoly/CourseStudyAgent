/** Collect unique citation numbers in first-appearance order. */
export function parseCitations(text: string, sourceCount: number) {
  if (!Number.isSafeInteger(sourceCount) || sourceCount < 0) {
    throw new Error("sourceCount must be a nonnegative safe integer");
  }

  const citations: number[] = [];
  const invalidCitations: number[] = [];
  const seen = new Set<number>();
  for (const match of text.matchAll(/\[(\d+)\]/g)) {
    const number = Number(match[1]);
    if (seen.has(number)) continue;
    seen.add(number);
    if (Number.isSafeInteger(number) && number >= 1 && number <= sourceCount) {
      citations.push(number);
    } else {
      invalidCitations.push(number);
    }
  }
  return { citations, invalidCitations };
}
