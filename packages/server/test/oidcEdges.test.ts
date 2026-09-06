/**
 * Three things at the edge of the sign-in, and only one of them is small
 * (ADR-0108).
 *
 * `claude/durchgang-nie-gelaufen.md` lists them together as "OIDC-Kleinkram":
 *
 *   1. discovery runs twice per sign-in, uncached and without a timeout
 *   2. an unknown `kid` fails the sign-in instead of refetching the keys
 *   3. `settingsFor` answers `404 not_configured` for three different states
 *
 * (1) is not small: nothing bounds any of the three outbound calls, so a
 * provider that accepts the connection and then says nothing holds a sign-in
 * request open for as long as it likes.
 *
 * And (1) and (2) are **one decision, not two.** The verifier says so itself:
 *
 * > Providers rotate keys and publish the new one before using it, so an
 * > unknown `kid` means "fetch again", not "reject" — but that decision belongs
 * > to the caller holding the cache, and here it simply finds nothing.
 *
 * There is no cache. Every sign-in fetches the keys afresh, which is why (2)
 * has never bitten anybody — and why adding the cache **on its own** would have
 * introduced an outage at the provider's next key rotation. The two ship
 * together or not at all.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { OidcError, ProviderDirectory } from '../src/auth/oidcFlow.js';

const ISSUER = 'https://login.example.org';

const DOCUMENT = {
  issuer: ISSUER,
  authorization_endpoint: `${ISSUER}/authorize`,
  token_endpoint: `${ISSUER}/token`,
  jwks_uri: `${ISSUER}/keys`,
};

/** A provider that answers, and counts what it was asked. */
function provider(keys: unknown[] = [{ kid: 'one' }]): {
  fetch: typeof globalThis.fetch;
  calls: string[];
  keys: unknown[];
} {
  const state = { keys };
  const calls: string[] = [];
  const fetch = (async (url: string) => {
    calls.push(String(url));
    // A copy, because a real response is fresh JSON every time — returning the
    // array itself let a later mutation reach inside the cache and made this
    // test lie about what was remembered.
    const body = String(url).endsWith('/keys') ? { keys: [...state.keys] } : DOCUMENT;
    return { ok: true, json: async () => body } as never;
  }) as unknown as typeof globalThis.fetch;
  return { fetch, calls, keys: state.keys };
}

describe('a provider that never answers', () => {
  test('does not hold a sign-in open for ever', async () => {
    /*
     * The one that is not small.
     *
     * Node's `fetch` has no default timeout. A provider that accepts the
     * connection and then says nothing — a half-open firewall, an overloaded
     * identity server, a DNS name that now points somewhere quiet — leaves the
     * request outstanding, and the person waiting on a blank page.
     *
     * Written as a fetch that never settles, which is exactly what that looks
     * like from here. Before this change the assertion below never ran: the
     * test hung, which is the finding.
     */
    const directory = new ProviderDirectory({
      fetchImpl: (() => new Promise(() => {})) as unknown as typeof globalThis.fetch,
      timeoutMs: 50,
    });

    await assert.rejects(
      directory.discover(ISSUER),
      (err: unknown) => err instanceof OidcError && err.code === 'discovery_timeout',
      'a provider that says nothing is a provider problem, and it is named',
    );
  });

  test('and the timeout is bounded for the keys too', async () => {
    // Same argument, and the call that happens *after* the authorization code
    // has been spent — so hanging here costs the person their sign-in attempt
    // rather than merely their patience.
    const directory = new ProviderDirectory({
      fetchImpl: (async (url: string) =>
        String(url).endsWith('/keys')
          ? new Promise(() => {})
          : ({ ok: true, json: async () => DOCUMENT } as never)) as unknown as typeof globalThis.fetch,
      timeoutMs: 50,
    });

    const discovery = await directory.discover(ISSUER);
    await assert.rejects(
      directory.keys(discovery),
      (err: unknown) => err instanceof OidcError && err.code === 'jwks_timeout',
    );
  });
});

describe('asking the provider once instead of twice', () => {
  test('the document is remembered between the two halves of a sign-in', async () => {
    /*
     * Not about saving a request.
     *
     * `/start` discovers, and `/callback` discovers again — *after* the
     * authorization code has been handed over. A provider that is briefly
     * unreachable at that second moment costs the person a code that is now
     * spent, and they have to begin again. Remembering the document makes the
     * callback depend on the provider being up once rather than twice.
     */
    const one = provider();
    const directory = new ProviderDirectory({ fetchImpl: one.fetch });

    await directory.discover(ISSUER);
    await directory.discover(ISSUER);

    assert.deepEqual(one.calls, [`${ISSUER}/.well-known/openid-configuration`]);
  });

  test('and forgotten again when it is old', async () => {
    // A provider does change its endpoints, rarely. An entry that never expires
    // is a configuration this instance can never be told about.
    const one = provider();
    const directory = new ProviderDirectory({ fetchImpl: one.fetch, ttlMs: 0 });

    await directory.discover(ISSUER);
    await directory.discover(ISSUER);

    assert.equal(one.calls.length, 2);
  });
});

describe('a key the provider has not published yet', () => {
  test('is fetched again rather than refused', async () => {
    /*
     * The half that makes the cache safe (ADR-0108).
     *
     * Providers rotate signing keys: the new key appears in the JWKS, and
     * tokens signed with it arrive some time later. Without a cache every
     * sign-in fetched the keys afresh, so this never mattered — which is why
     * the verifier's own comment describes the problem in the conditional.
     *
     * With a cache it matters immediately: a rotation would make every sign-in
     * fail with `unknown_key` until the entry expired. So the cache and this
     * refetch are one change.
     */
    const one = provider([{ kid: 'old' }]);
    const directory = new ProviderDirectory({ fetchImpl: one.fetch });
    const discovery = await directory.discover(ISSUER);

    const before = await directory.keys(discovery);
    assert.deepEqual(before, [{ kid: 'old' }]);

    // The provider rotates. The cached copy is now behind.
    one.keys.length = 0;
    one.keys.push({ kid: 'new' });

    const cached = await directory.keys(discovery);
    assert.deepEqual(cached, [{ kid: 'old' }], 'still the remembered set');

    const fresh = await directory.keys(discovery, { refresh: true });
    assert.deepEqual(fresh, [{ kid: 'new' }], 'and asked again when told to');
  });

  test('but the provider is not asked twice for a key that is simply wrong', async () => {
    /*
     * The counterweight, and the reason `refresh` is the caller's word rather
     * than something the directory decides.
     *
     * A forged token names a `kid` nobody has ever published. If an unknown
     * `kid` triggered a fetch on its own, anybody could make this server call
     * its provider as often as they liked. One refetch per sign-in attempt, and
     * the caller is the one who knows it has already tried.
     */
    const one = provider([{ kid: 'old' }]);
    const directory = new ProviderDirectory({ fetchImpl: one.fetch });
    const discovery = await directory.discover(ISSUER);

    await directory.keys(discovery);
    await directory.keys(discovery);
    await directory.keys(discovery);

    const fetches = one.calls.filter((url) => url.endsWith('/keys'));
    assert.equal(fetches.length, 1, 'the directory never decides to refetch by itself');
  });
});
