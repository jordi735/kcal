// Process-local like login codes. The clock is injectable for deterministic tests.
export class AuthThrottle {
  private buckets = new Map<string, { times: number[]; windowMs: number }>();
  private lastSweep = 0;
  private now: () => number;
  private testMode: boolean;

  constructor(options: { now?: () => number; testMode?: boolean } = {}) {
    this.now = options.now ?? Date.now;
    this.testMode = options.testMode ?? false;
  }

  // Returns Retry-After seconds, or zero after reserving this attempt.
  check(action: 'issue' | 'verify', email: string, ip: string): number {
    const now = this.now();
    if (now - this.lastSweep >= 300_000) {
      for (const [key, bucket] of this.buckets) {
        bucket.times = bucket.times.filter((time) => time > now - bucket.windowMs);
        if (bucket.times.length === 0) this.buckets.delete(key);
      }
      this.lastSweep = now;
    }
    // The E2E suite shares one IP and intentionally reissues codes rapidly.
    // Production always uses the limits below; isolated tests exercise them
    // with an injected clock, without waiting or weakening the default limits.
    const rules = this.testMode
      ? [{ scope: 'ip', value: ip, max: 100_000, windowMs: 3_600_000 }]
      : action === 'issue'
        ? [
          { scope: 'email-cooldown', value: email, max: 1, windowMs: 30_000 },
          { scope: 'email', value: email, max: 5, windowMs: 3_600_000 },
          { scope: 'ip', value: ip, max: 30, windowMs: 3_600_000 },
        ]
        : [
          { scope: 'email', value: email, max: 20, windowMs: 900_000 },
          { scope: 'ip', value: ip, max: 100, windowMs: 900_000 },
        ];
    const pending = rules.map((rule) => {
      const key = JSON.stringify([action, rule.scope, rule.value]);
      const times = (this.buckets.get(key)?.times ?? []).filter((time) => time > now - rule.windowMs);
      return { ...rule, key, times };
    });
    let retryMs = 0;
    for (const rule of pending) {
      if (rule.times.length >= rule.max) retryMs = Math.max(retryMs, rule.times[0]! + rule.windowMs - now);
    }
    if (retryMs > 0) return Math.ceil(retryMs / 1000);
    for (const rule of pending) {
      rule.times.push(now);
      this.buckets.set(rule.key, { times: rule.times, windowMs: rule.windowMs });
    }
    return 0;
  }
}
