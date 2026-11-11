export function signalScore(confirms: number, disputes: number): number {
  if (confirms < 0 || disputes < 0) {
    throw new RangeError("Confirms and disputes must be non-negative.");
  }

  return (confirms + 1) / (confirms + disputes + 2);
}
