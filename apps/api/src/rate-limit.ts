import type { FastifyReply, FastifyRequest } from 'fastify';

export interface RateLimitRule {
  id: string;
  match: (urlPath: string, method: string) => boolean;
  maxRequests: number;
  windowMs: number;
}

interface Bucket {
  timestamps: number[];
}

export class SlidingWindowRateLimiter {
  private readonly buckets = new Map<string, Bucket>();

  check(key: string, maxRequests: number, windowMs: number, now = Date.now()): {
    allowed: boolean;
    remaining: number;
    retryAfterSec: number;
  } {
    const cutoff = now - windowMs;
    const existing = this.buckets.get(key);
    const active = existing ? existing.timestamps.filter((t) => t > cutoff) : [];

    if (active.length >= maxRequests) {
      const oldest = active[0] ?? now;
      const retryAfterMs = Math.max(1000, windowMs - (now - oldest));
      this.buckets.set(key, { timestamps: active });
      return {
        allowed: false,
        remaining: 0,
        retryAfterSec: Math.ceil(retryAfterMs / 1000),
      };
    }

    active.push(now);
    this.buckets.set(key, { timestamps: active });

    // Prevent unbounded growth across long-lived processes
    if (this.buckets.size > 5000) {
      for (const [bKey, bucket] of this.buckets) {
        if (bucket.timestamps.every((t) => t <= cutoff)) {
          this.buckets.delete(bKey);
        }
      }
    }

    return {
      allowed: true,
      remaining: Math.max(0, maxRequests - active.length),
      retryAfterSec: 0,
    };
  }
}

export function createRateLimitHook(rules: RateLimitRule[]) {
  const limiter = new SlidingWindowRateLimiter();

  return async (request: FastifyRequest, reply: FastifyReply) => {
    const rawUrl = request.url || '/';
    const urlPath = rawUrl.split('?')[0] || '/';

    for (const rule of rules) {
      if (!rule.match(urlPath, request.method)) continue;
      const ip = request.ip || '127.0.0.1';
      const result = limiter.check(`${rule.id}:${ip}`, rule.maxRequests, rule.windowMs);
      reply.header('X-RateLimit-Remaining', String(result.remaining));

      if (!result.allowed) {
        reply.header('Retry-After', String(result.retryAfterSec));
        return reply.status(429).send({
          error: 'Muitas solicitações em sequência. Aguarde alguns segundos e tente novamente.',
        });
      }
      break;
    }
  };
}
