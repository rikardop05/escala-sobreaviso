import { verifyToken } from '@clerk/backend';

// Safe to hardcode — publishable key already ships in the frontend bundle
const PUBLISHABLE_KEY = 'pk_test_Y29tcG9zZWQta29hbGEtNjIuY2xlcmsuYWNjb3VudHMuZGV2JA';

/**
 * Verifies the Clerk JWT from the Authorization header.
 * Returns { userId } on success; throws { status: 401 } on any failure.
 *
 * Set ONE of the following in Vercel Environment Variables:
 *   CLERK_JWT_KEY    — RSA PEM public key (Clerk dashboard → API Keys → JWT Public Key)
 *                      Preferred: verification is local, no network round-trip.
 *   CLERK_SECRET_KEY — Clerk secret key. SDK fetches the public JWK on cold start
 *                      (~100 ms extra), then caches within the function instance.
 */
export async function requireUser(req) {
  const token = req.headers['authorization']?.slice(7);
  if (!token) {
    throw Object.assign(new Error('Unauthorized'), { status: 401 });
  }

  try {
    const options = process.env.CLERK_JWT_KEY
      ? { jwtKey: process.env.CLERK_JWT_KEY }
      : { secretKey: process.env.CLERK_SECRET_KEY, publishableKey: PUBLISHABLE_KEY };

    const payload = await verifyToken(token, options);
    if (!payload?.sub) throw new Error('missing sub claim');
    return { userId: payload.sub };
  } catch (e) {
    console.error('[auth] token invalid:', e.message);
    throw Object.assign(new Error('Unauthorized'), { status: 401 });
  }
}
