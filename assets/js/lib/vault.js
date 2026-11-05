// The admin password unlocks a GitHub token stored encrypted in data/admin-key.json.
// PBKDF2-SHA256 derives an AES-GCM key from the password; a wrong password fails to decrypt.
// Works in browsers and in Node 20+ (globalThis.crypto).
//
// This is only as strong as the password: anyone can download admin-key.json and try
// passwords offline, so a short password can be guessed. The token should be a
// fine-grained token limited to this one repository.

const ITERATIONS = 600000;
const enc = new TextEncoder();
const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

async function deriveKey(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

/** @returns {Promise<object>} the contents of data/admin-key.json */
export async function seal(password, secret) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt, ITERATIONS);
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(secret)));
  return { v: 1, kdf: 'PBKDF2-SHA256', iterations: ITERATIONS, salt: b64(salt), iv: b64(iv), data: b64(data) };
}

/** @returns {Promise<object|null>} the secret, or null when the password is wrong */
export async function unseal(password, box) {
  try {
    const key = await deriveKey(password, unb64(box.salt), box.iterations);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(box.iv) }, key, unb64(box.data));
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return null;
  }
}
