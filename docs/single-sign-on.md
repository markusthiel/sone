# Single sign-on

SONE speaks OpenID Connect, so any provider that does will work: Keycloak,
Authentik, Authelia, Zitadel, Entra ID, Google, Okta, GitLab. There is no
per-provider integration to choose — setting one up is filling in two fields.

The reasoning behind the choices below is in
[ADR-0024](adr/0024-oidc.md).

## What you need

- The provider's **issuer URL**. For Keycloak this is
  `https://your-keycloak/realms/<realm>` — the realm, not the admin console and
  not the `.well-known` path, which SONE appends itself.
- A **client id** and **client secret** from a confidential client.
- Your instance's public URL, which SONE already knows as `SONE_PUBLIC_URL`.

## At the provider

Create a client with:

- **Redirect URI**: `https://your-sone/api/auth/oidc/callback` — exactly that
  path, on the same public URL SONE is configured with. If they disagree the
  provider will refuse the sign-in, which is the point of the setting.
- **Client authentication on** (Keycloak calls this a confidential client). A
  public client has no secret, and SONE will not enable single sign-on without
  one.
- **Standard flow** enabled. Nothing else is needed: no implicit flow, no direct
  access grants.
- Scopes `openid`, `email` and `profile`, which SONE requests.

### Keycloak, concretely

1. Clients → Create client → OpenID Connect, client id e.g. `sone`.
2. Client authentication **On**; Standard flow **On**; the rest off.
3. Valid redirect URIs: `https://your-sone/api/auth/oidc/callback`.
4. Save, then Credentials → copy the client secret.
5. The issuer is `https://your-keycloak/realms/<realm>`. Confirm it by opening
   `<issuer>/.well-known/openid-configuration` in a browser: the `issuer` field
   in that document must match exactly, including whether it has a trailing
   slash. SONE checks this and refuses a document that answers for a different
   issuer.

## In SONE

Set the secret in the server's environment and restart it:

```
SONE_OIDC_CLIENT_SECRET=the-secret-from-the-provider
```

It is deliberately not configurable in the interface. A secret in the database
is a secret in every backup, and a secret in a form is one on a screen.

Then, as an instance administrator, go to **Settings → Single sign-on** and fill
in:

- **Issuer** — the URL above.
- **Client ID** — as created at the provider.
- **Button label** — what the sign-in page says. People recognise their own login
  by name, not by the protocol behind it.
- **Let people without an account here sign up through the provider** — off by
  default. Trusting a provider to say who somebody is does not oblige you to let
  everybody there in.
- **Show the button on the sign-in page** — this is the switch. It cannot be
  turned on while the secret is missing.

## What happens on first sign-in

An account is matched by the provider's subject claim, never by email address.
An email is a label: it can be changed and reassigned, so matching on it would
hand account takeover to whoever can edit an address at the provider.

That has two consequences worth knowing before you test:

- **An existing SONE account is not adopted** because the addresses match.
  Linking an existing account is a deliberate act by somebody already signed in.
- **A new account is only created** when sign-up through the provider is on
  *and* the provider reports the address as verified. A provider that will not
  say whether it checked has not checked.

If neither applies, sign-in fails with `no_account_here`. That is the intended
answer, not a fault.

## Passwords still work

The password form stays on the sign-in page beside the button, and the instance
administrator can always sign in with a password.

This is deliberate: an instance whose only door is somebody else's service
cannot be repaired when that service is unreachable, and a lockout of the only
person who can fix the configuration is the one failure this must not have.

## When it does not work

Errors are codes rather than sentences. The ones you are most likely to meet:

| Code | What it means |
| --- | --- |
| `not_configured` | No settings, or the switch is off, or the secret is missing. |
| `issuer_mismatch` | The discovery document names a different issuer than the one configured. Compare them character by character, including the trailing slash. |
| `bad_discovery_document` | An endpoint in the document is not https or not on the issuer's own origin. |
| `discovery_failed` | The provider could not be reached, or did not answer with a discovery document. Check that the container can reach it. |
| `state_mismatch` | The response does not belong to a sign-in this instance started — usually a stale tab, occasionally a cookie that did not survive the redirect. |
| `wrong_audience` | The token is for a different client at the same provider. The client id here and there disagree. |
| `wrong_nonce` | The token does not belong to this attempt. Retry once; if it persists, something is replaying a response. |
| `expired` | Clocks disagree by more than a minute. Check the time on both machines. |
| `no_account_here` | The person is unknown here and sign-up through the provider is off, or their address is unverified. |

The server logs the same codes with more detail. Nothing on the sign-in page
says which check failed: telling somebody which one to work on next is a
courtesy best not extended.

## Not implemented

**SAML.** A second protocol with its own cryptography, doubling the surface of
the one part of this application where a mistake is unrecoverable. Most
providers that speak SAML also speak OIDC.

**Group and role mapping.** Signing in and deciding who may do what are separate
questions. Mapping provider groups to workspace roles would make the directory
the authority on permissions here — a change made there would silently change
what people can do in documents. Roles are set in SONE.
