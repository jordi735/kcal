import { isIP } from 'node:net';
import { ipKeyGenerator } from 'express-rate-limit';

type AuthAction = 'issue' | 'verify';
type Rule = { scope: string; value: string; max: number; windowMs: number };

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

  // Reserve before body parsing. Invalid/absent addresses share a bucket rather
  // than creating attacker-selected keys; req.ip comes from Express's trusted
  // proxy chain. IPv4 aliases and IPv6 /56 subnets share their source budget.
  reserveSource(action: AuthAction, ip: string | undefined): number {
    const key = ip !== undefined && ip.length <= 64 && isIP(ip) !== 0
      ? ipKeyGenerator(ip, 56) : 'unknown';
    return this.reserve(action, [{
      scope: 'ip', value: key,
      max: this.testMode ? 100_000 : action === 'issue' ? 30 : 100,
      windowMs: this.testMode || action === 'issue' ? 3_600_000 : 900_000,
    }]);
  }

  // Verification is reserved only for a live issued code, before comparing it.
  // Resending a code never resets this independent account budget.
  reserveAccount(action: AuthAction, email: string): number {
    if (this.testMode) return 0;
    return this.reserve(action, action === 'issue'
      ? [
        { scope: 'email-cooldown', value: email, max: 1, windowMs: 30_000 },
        { scope: 'email', value: email, max: 5, windowMs: 3_600_000 },
      ]
      : [{ scope: 'email', value: email, max: 20, windowMs: 900_000 }]);
  }

  // Returns Retry-After seconds, or zero after atomically reserving the rules.
  // Reservations are not refunded after parsing, delivery, or database failure.
  private reserve(action: AuthAction, rules: Rule[]): number {
    const now = this.now();
    if (now - this.lastSweep >= 300_000) {
      for (const [key, bucket] of this.buckets) {
        bucket.times = bucket.times.filter((time) => time > now - bucket.windowMs);
        if (bucket.times.length === 0) this.buckets.delete(key);
      }
      this.lastSweep = now;
    }
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
