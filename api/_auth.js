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
 * Throws { status: 401 } on any auth failure.
 *
 * Required Vercel env vars:
 *   CLERK_SECRET_KEY  — always required (for users.getUser email lookup)
 *   CLERK_JWT_KEY     — RSA PEM public key (Clerk dashboard → API Keys → JWT Public Key).
 *                       Preferred: local verification, no extra network round-trip.
 *                       If absent, falls back to JWKS fetch using CLERK_SECRET_KEY.
 */
export async function requireUser(req) {
  const token = req.headers['authorization']?.slice(7);
  if (!token) throw Object.assign(new Error('Unauthorized'), { status: 401 });

  try {
    const options = process.env.CLERK_JWT_KEY
      ? { jwtKey: process.env.CLERK_JWT_KEY }
      : { secretKey: process.env.CLERK_SECRET_KEY, publishableKey: PUBLISHABLE_KEY };

    const payload = await verifyToken(token, options);
    if (!payload?.sub) throw new Error('missing sub claim');

    const userId = payload.sub;

    // Fetch the verified primary email — JWT payload alone doesn't carry it.
    const user = await getClerkClient().users.getUser(userId);
    const email =
      user.emailAddresses.find(e => e.id === user.primaryEmailAddressId)?.emailAddress
      ?? user.emailAddresses[0]?.emailAddress
      ?? null;

    const { memberId, role } = resolveAccess(email);
    return { userId, email, memberId, role };
  } catch (e) {
    console.error('[auth] error:', e.message);
    throw Object.assign(new Error('Unauthorized'), { status: 401 });
  }
}
