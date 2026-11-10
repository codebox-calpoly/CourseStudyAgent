export function signalScore(confirms: number, disputes: number): number {
  if (
    !Number.isSafeInteger(confirms) ||
    !Number.isSafeInteger(disputes) ||
    confirms < 0 ||
    disputes < 0
  ) {
    throw new RangeError(
      "Confirms and disputes must be non-negative safe integers.",
    );
  }

  return (confirms + 1) / (confirms + disputes + 2);
}
