/**
 * SONE — signing this instance to a push service (ADR-0180).
 *
 * A push is not sent to a browser; it is sent to whatever push service that
 * browser belongs to — Apple's, Google's, Mozilla's — at an endpoint the browser
 * handed over when it subscribed. The service will only accept a push for a
 * subscription whose `applicationServerKey` matches the key the sender signs
 * with, which is what stops anyone who learns an endpoint from pushing to it.
 *
 * That is RFC 8292, and it is all that is needed here: **nothing carries a
 * payload** (see the migration), so RFC 8291's encryption of one is not
 * implemented and its keys are never stored.
 *
 * ## Why by hand rather than a library
 *
 * What is actually required is one JWT signed with ES256 over a keypair this
 * instance already holds, and WebCrypto does every step. A dependency would
 * bring an encryption implementation that is not wanted, on a path where the
 * whole point is that nothing about a page leaves the instance.
 */

import { webcrypto } from 'node:crypto';

const subtle = webcrypto.subtle;

/** Base64url, which is what JWT and the push protocol speak. */
export function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/**
 * The private half, as WebCrypto hands it over and takes it back.
 *
 * `webcrypto.JsonWebKey` rather than the one in `node:crypto`: the two differ
 * by an index signature under `exactOptionalPropertyTypes`, and this is the one
 * `exportKey` actually returns.
 */
export type PushJwk = webcrypto.JsonWebKey;

export interface PushKeys {
  /** The uncompressed P-256 point, base64url. Handed to the browser. */
  publicKey: string;
  privateKey: PushJwk;
}

/**
 * A new keypair for this instance.
 *
 * `raw` for the public half, because that export *is* the uncompressed point
 * (`0x04 || X || Y`) the push protocol asks for — no assembling it from
 * coordinates, which is the step people get wrong.
 */
export async function generateKeys(): Promise<PushKeys> {
  const pair = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const raw = new Uint8Array(await subtle.exportKey('raw', pair.publicKey));
  const jwk = await subtle.exportKey('jwk', pair.privateKey);
  return { publicKey: base64url(raw), privateKey: jwk };
}

/** The origin of an endpoint, which is what a push service wants as `aud`. */
export function audienceOf(endpoint: string): string {
  return new URL(endpoint).origin;
}

/**
 * The `Authorization` header for one push.
 *
 * The claims are the three RFC 8292 asks for and nothing else. `sub` is this
 * instance's own address rather than anybody's mail: it exists so a push service
 * can get in touch about a misbehaving sender, and a person's address has no
 * business being sent to Apple over somebody else's comment.
 *
 * Twelve hours, well inside the twenty-four the specification allows, so a
 * clock a little out of step is not a refused push.
 */
export async function authorisation(input: {
  endpoint: string;
  keys: PushKeys;
  /** This instance's public address, for the `sub` claim. */
  contact: string;
  now?: number;
}): Promise<string> {
  const now = input.now ?? Date.now();
  const header = { typ: 'JWT', alg: 'ES256' };
  const claims = {
    aud: audienceOf(input.endpoint),
    exp: Math.floor(now / 1000) + 12 * 60 * 60,
    sub: input.contact,
  };

  const signing = `${base64url(Buffer.from(JSON.stringify(header)))}.${base64url(
    Buffer.from(JSON.stringify(claims)),
  )}`;

  const key = await subtle.importKey(
    'jwk',
    input.keys.privateKey,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  /*
   * WebCrypto returns the signature as `r || s`, sixty-four bytes, which is
   * exactly what JWS calls ES256 — no DER to unwrap, which is the other step
   * people get wrong.
   */
  const signature = new Uint8Array(
    await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, Buffer.from(signing)),
  );

  return `vapid t=${signing}.${base64url(signature)}, k=${input.keys.publicKey}`;
}

/**
 * Whether an answer from a push service means this endpoint is gone for good.
 *
 * 404 and 410 are the two the specification gives for it, and they are the only
 * two worth acting on: anything else is this afternoon's problem, not the
 * device's.
 */
export const isGone = (status: number): boolean => status === 404 || status === 410;
