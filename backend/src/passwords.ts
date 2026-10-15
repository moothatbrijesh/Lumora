import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';

// OWASP's scrypt N=2^15, r=8, p=3 profile; asynchronous to avoid blocking Node.
const options = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
function derive(password: string, salt: string) {
  return new Promise<Buffer>((resolve, reject) => {
    scrypt(password, salt, 64, options, (error, key) => error ? reject(error) : resolve(key));
  });
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const key = await derive(password, salt);
  return `scrypt-v1$${salt}$${key.toString('hex')}`;
}

export async function verifyPassword(password: string, encoded: string | null) {
  const match = encoded?.match(/^scrypt-v1\$([0-9a-f]{32})\$([0-9a-f]{128})$/);
  // Do the same expensive work even for an unknown email or password-less demo user.
  const actual = await derive(password, match?.[1] ?? '0'.repeat(32));
  const expected = Buffer.from(match?.[2] ?? '0'.repeat(128), 'hex');
  return timingSafeEqual(actual, expected) && Boolean(match);
}
