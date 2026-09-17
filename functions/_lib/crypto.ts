/** 加密原语：全部基于 WebCrypto，无外部依赖 */

const encoder = new TextEncoder();

export function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '='));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** 常数时间字符串比较，避免时序侧信道 */
export function timingSafeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

export const PASSWORD_ALGORITHM = 'pbkdf2-sha256';

export async function hashPassword(password: string, iterations: number): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  );
  return `${PASSWORD_ALGORITHM}$${iterations}$${toBase64Url(salt)}$${toBase64Url(new Uint8Array(bits))}`;
}

export interface PasswordCheck {
  ok: boolean;
  /** 存储的迭代次数低于当前默认值，建议在下次登录时升级 */
  needsRehash: boolean;
}

export async function verifyPassword(password: string, stored: string, defaultIterations: number): Promise<PasswordCheck> {
  const parts = stored.split('$');
  if (parts.length !== 4 || parts[0] !== PASSWORD_ALGORITHM) return { ok: false, needsRehash: false };
  const iterations = Number.parseInt(parts[1] ?? '', 10);
  const salt = parts[2] ?? '';
  const expected = parts[3] ?? '';
  if (!Number.isFinite(iterations) || iterations <= 0 || iterations > 5_000_000 || !salt || !expected) {
    return { ok: false, needsRehash: false };
  }
  let saltBytes: Uint8Array;
  try {
    saltBytes = fromBase64Url(salt);
  } catch {
    return { ok: false, needsRehash: false };
  }
  const key = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: saltBytes, iterations },
    key,
    256,
  );
  const actual = toBase64Url(new Uint8Array(bits));
  return { ok: timingSafeEqual(actual, expected), needsRehash: iterations < defaultIterations };
}
