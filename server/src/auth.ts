import type { FastifyReply, FastifyRequest } from 'fastify';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import crypto from 'node:crypto';
import { config } from './config.js';

export interface Identity {
  provider: 'tailscale' | 'cloudflare' | 'token' | 'none';
  login: string;
  name?: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    identity?: Identity;
  }
}

const COOKIE = 'ima_session';
let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function header(req: FastifyRequest, name: string): string | undefined {
  const v = req.headers[name.toLowerCase()];
  return Array.isArray(v) ? v[0] : v;
}

function isLoopback(req: FastifyRequest): boolean {
  const ip = req.ip;
  return ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

export function sessionTokenFor(appToken: string): string {
  return crypto.createHmac('sha256', appToken).update('ima-session-v1').digest('hex');
}

function tokenOk(req: FastifyRequest): boolean {
  if (!config.appToken) return true;
  const auth = header(req, 'authorization');
  if (auth?.startsWith('Bearer ') && safeEqual(auth.slice(7), config.appToken)) return true;
  const cookie = (req as FastifyRequest & { cookies?: Record<string, string> }).cookies?.[COOKIE];
  if (cookie && safeEqual(cookie, sessionTokenFor(config.appToken))) return true;
  const q = (req.query as Record<string, string | undefined>)?.token;
  if (q && safeEqual(q, config.appToken)) return true;
  return false;
}

async function identify(req: FastifyRequest): Promise<Identity | null> {
  switch (config.authMode) {
    case 'none':
      return { provider: 'none', login: 'local' };

    case 'token':
      return config.appToken ? { provider: 'token', login: 'token-user' } : null;

    case 'tailscale': {
      // `tailscale serve` proxies from loopback and injects identity headers. Only trust them
      // when the request actually came from loopback (i.e. from tailscaled), never from the LAN.
      if (!isLoopback(req)) return null;
      const login = header(req, 'tailscale-user-login')?.toLowerCase();
      if (!login) return null;
      if (config.tailscale.allowedLogins.length && !config.tailscale.allowedLogins.includes(login)) return null;
      return { provider: 'tailscale', login, name: header(req, 'tailscale-user-name') };
    }

    case 'cloudflare': {
      const jwt = header(req, 'cf-access-jwt-assertion');
      if (!jwt || !config.cloudflare.teamDomain || !config.cloudflare.aud) return null;
      const issuer = `https://${config.cloudflare.teamDomain}`;
      jwks ??= createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
      try {
        const { payload } = await jwtVerify(jwt, jwks, { issuer, audience: config.cloudflare.aud });
        const email = String(payload.email ?? payload.sub ?? '').toLowerCase();
        if (!email) return null;
        if (config.cloudflare.allowedEmails.length && !config.cloudflare.allowedEmails.includes(email)) return null;
        return { provider: 'cloudflare', login: email };
      } catch {
        return null;
      }
    }
  }
  return null;
}

/** Fastify preHandler: rejects unauthenticated requests. */
export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  const id = await identify(req);
  if (!id) {
    reply.code(401).send({ error: 'unauthorized', reason: `No valid ${config.authMode} identity` });
    return reply;
  }
  if (!tokenOk(req)) {
    reply.code(401).send({ error: 'unauthorized', reason: 'app token required', needToken: true });
    return reply;
  }
  req.identity = id;
}

export function sessionCookieName() {
  return COOKIE;
}
