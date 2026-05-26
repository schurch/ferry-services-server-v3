type WindowState = {
  count: number;
  resetAt: number;
};

export type RateLimitResult = {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetAt: number;
};

export class MemoryRateLimiter {
  private readonly windows = new Map<string, WindowState>();

  consume(key: string, limit: number, windowMs: number, now = Date.now()): RateLimitResult {
    const existing = this.windows.get(key);
    const state = existing && existing.resetAt > now
      ? existing
      : { count: 0, resetAt: now + windowMs };

    state.count += 1;
    this.windows.set(key, state);
    this.prune(now);

    return {
      allowed: state.count <= limit,
      limit,
      remaining: Math.max(0, limit - state.count),
      resetAt: state.resetAt
    };
  }

  private prune(now: number): void {
    if (this.windows.size < 1024) {
      return;
    }

    for (const [key, value] of this.windows.entries()) {
      if (value.resetAt <= now) {
        this.windows.delete(key);
      }
    }
  }
}
