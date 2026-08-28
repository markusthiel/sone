/**
 * SONE — share tokens that can be shown again.
 *
 * The first design stored only a SHA-256 hash of a share token. That is right
 * for a password and wrong here, and the difference is worth writing down
 * because it looked the same to me at the time.
 *
 * A password must not be recoverable *by anyone*, including the operator: it is
 * the person's secret, reused elsewhere, and its value is that nobody can read
 * it. A share link is not a secret belonging to anybody. It is a capability the
 * page's administrator issued, and that administrator can already mint another
 * one at will — so refusing to show them the one they issued protects nothing
 * and costs them the link.
 *
 * The cost of hash-only was real: a link shown once and then lost had to be
 * revoked and replaced, and everyone holding the old one lost access for no
 * reason.
 *
 * ## Why not plaintext
 *
 * A database leak would then hand over working links. The counter-argument is
 * tempting — whoever has the database already has the content those links point
 * at — but it does not hold in one case that matters: read-only SQL access
 * (a compromised reporting user, a stray replica, a backup on a shared disk)
 * would be escalated into *write* access through an editable link. Content
 * disclosure is bad; silent modification is worse.
 *
 * ## So: encrypted with a key the database does not contain
 *
 * AES-256-GCM under a key derived from SONE_SECRET_KEY, which lives in the
 * environment. A database dump on its own is inert. An attacker holding both
 * the dump and the secret can forge sessions outright, so the tokens are not
 * what is protecting anything at that point.
 *
 * The key is derived with a distinct label rather than used directly, so this
 * ciphertext cannot be confused with anything else signed or encrypted under
 * the same secret.
 */

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'node:crypto';

/** AES-256-GCM: 12-byte nonce, 16-byte tag. */
const NONCE_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;

/**
 * Distinct per purpose, so one secret can safely serve several.
 *
 * Changing this string makes every stored token undecryptable. That is a
 * migration, not a tweak.
 */
const HKDF_INFO = 'sone/share-token/v1';

function keyFrom(secret: string): Buffer {
  // No salt: the secret is already high-entropy random (the config refuses
  // anything under 32 characters), and a per-record salt would have to be
  // stored beside the ciphertext without adding anything against an attacker
  // who has the record.
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret, 'utf8'), Buffer.alloc(0), HKDF_INFO, KEY_BYTES));
}

/**
 * Encrypt a token for storage.
 *
 * Layout: nonce ‖ ciphertext ‖ tag. Self-describing, so no separate columns to
 * keep in step.
 */
export function encryptShareToken(token: string, secret: string): Buffer {
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(secret), nonce);
  const body = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return Buffer.concat([nonce, body, cipher.getAuthTag()]);
}

/**
 * Decrypt a stored token, or null.
 *
 * Null rather than throwing, because every reason for failure has the same
 * answer for the caller: the link cannot be shown again, offer to replace it.
 * Those reasons are a token stored before this existed, a rotated secret, and a
 * corrupted or tampered record — GCM's tag is what turns the last one into a
 * clean failure rather than plausible nonsense.
 */
export function decryptShareToken(stored: Buffer, secret: string): string | null {
  if (stored.length <= NONCE_BYTES + TAG_BYTES) return null;

  try {
    const nonce = stored.subarray(0, NONCE_BYTES);
    const body = stored.subarray(NONCE_BYTES, stored.length - TAG_BYTES);
    const tag = stored.subarray(stored.length - TAG_BYTES);

    const decipher = createDecipheriv('aes-256-gcm', keyFrom(secret), nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
