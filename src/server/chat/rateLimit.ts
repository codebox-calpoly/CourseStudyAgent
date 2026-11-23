/** In-memory only: this limit is not shared across multiple server instances. */
export function createRateLimiter(now: () => number = Date.now) {
  const windows = new Map<string, { count: number; expires: number }>();
  return (userId: string): boolean => {
    const time = now();
    for (const [id, window] of windows) {
      if (window.expires <= time) windows.delete(id);
    }
    const window = windows.get(userId) ?? { count: 0, expires: time + 60_000 };
    windows.set(userId, window);
    if (window.count >= 20) return false;
    window.count += 1;
    return true;
  };
}
