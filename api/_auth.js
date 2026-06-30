import { verifyToken, createClerkClient } from '@clerk/backend';
import { resolveAccess } from './_allowlist.js';

// Safe to hardcode — publishable key already ships in the frontend bundle.
const PUBLISHABLE_KEY = 'pk_test_Y29tcG9zZWQta29hbGEtNjIuY2xlcmsuYWNjb3VudHMuZGV2JA';

// Lazy-initialized so a missing CLERK_SECRET_KEY fails at request time (caught),
// not at module import time (would crash the entire function cold-start).
let _clerkClient;
function getClerkClient() {
  if (!_clerkClient) _clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });
  return _clerkClient;
}

/**
 * Verifies the Clerk JWT and resolves the caller's identity from the allowlist.
 *
 * Returns { userId, email, memberId, role } on success.
 * Throws { status: 401 } ONLY on token verification failure.
 * If email cannot be resolved, returns role:'viewer' (no throw) so the app still loads.
 *
 * Email resolution — two strategies (first one that yields an address wins):
 *   1. JWT payload `email` claim — zero network cost; requires adding to Clerk JWT template:
 *        Clerk Dashboard → JWT Templates → Default → Add: { "email": "{{user.primary_email_address}}" }
 *   2. Clerk Users API (`getUser`) — requires CLERK_SECRET_KEY in Vercel env vars:
 *        Clerk Dashboard → API Keys → Secret Keys → copy value → Vercel → Settings → Env Vars
 *
 * Required Vercel env vars:
 *   CLERK_JWT_KEY     — RSA PEM public key (Clerk → API Keys → JWT Public Key). Local verify, preferred.
 *                       If absent, falls back to JWKS fetch — then CLERK_SECRET_KEY must be set.
 *   CLERK_SECRET_KEY  — needed for strategy 2 (Users API). Also needed if CLERK_JWT_KEY is absent.
 */
export async function requireUser(req) {
  const token = req.headers['authorization']?.slice(7);
  if (!token) throw Object.assign(new Error('Unauthorized'), { status: 401 });

  let payload;
  try {
    const options = process.env.CLERK_JWT_KEY
      ? { jwtKey: process.env.CLERK_JWT_KEY }
      : { secretKey: process.env.CLERK_SECRET_KEY, publishableKey: PUBLISHABLE_KEY };
    payload = await verifyToken(token, options);
    if (!payload?.sub) throw new Error('missing sub claim');
  } catch (e) {
    console.error('[auth] token verification failed:', e.message);
    throw Object.assign(new Error('Unauthorized'), { status: 401 });
  }

  const userId = payload.sub;

  // Strategy 1: email already in JWT payload — zero network cost.
  // Enable via: Clerk Dashboard → JWT Templates → Default → add {"email":"{{user.primary_email_address}}"}
  let email = typeof payload.email === 'string' ? payload.email : null;

  // Strategy 2: Clerk Users API — requires CLERK_SECRET_KEY in Vercel env vars.
  if (!email && process.env.CLERK_SECRET_KEY) {
    try {
      const user = await getClerkClient().users.getUser(userId);
      email =
        user.emailAddresses.find(e => e.id === user.primaryEmailAddressId)?.emailAddress
        ?? user.emailAddresses[0]?.emailAddress
        ?? null;
    } catch (apiErr) {
      console.error('[auth] Clerk getUser failed:', apiErr.message);
    }
  }

  if (!email) {
    // Both strategies failed — user gets viewer access until this is fixed.
    // Fix: add CLERK_SECRET_KEY to Vercel env vars (Clerk Dashboard → API Keys → Secret Keys).
    console.error('[auth] email not resolved for userId:', userId,
      '— add CLERK_SECRET_KEY to Vercel env vars to enable role lookup');
  }

  const { memberId, role } = resolveAccess(email);
  return { userId, email, memberId, role };
}
