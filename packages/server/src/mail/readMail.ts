/**
 * SONE server — finding the text somebody typed inside a mail (ADR-0060).
 *
 * A small MIME reader, and it is small **because the record refuses things**:
 * `text/plain` only, no attachments, no HTML conversion. What is left is
 * headers, a multipart split, two transfer encodings and two charsets. A
 * general MIME parser is a library; this is the six steps that remain once the
 * scope decision has been made, which is the honest reason not to take on a
 * dependency here.
 *
 * What it does not do, on purpose: nested multiparts beyond the first level of
 * `multipart/alternative` and `multipart/mixed`, message/rfc822 forwarding,
 * and any charset beyond UTF-8 and Latin-1. Each returns "no text part", which
 * the caller answers with a mail saying to send plain text — a wrong guess
 * would arrive in somebody's page as a sentence they did not write.
 */

export interface MailParts {
  headers: Map<string, string>;
  /** The plain-text body, decoded, or null when there is not one. */
  text: string | null;
  /** Whether the message carried attachments, so the reply can say they were dropped. */
  hadAttachments: boolean;
}

/** Split a message into its headers and its raw body. */
function splitHeaders(raw: string): { headers: Map<string, string>; body: string } {
  const normalised = raw.replace(/\r\n/g, '\n');
  const blank = normalised.indexOf('\n\n');
  const head = blank === -1 ? normalised : normalised.slice(0, blank);
  const body = blank === -1 ? '' : normalised.slice(blank + 2);

  const headers = new Map<string, string>();
  // Unfold first: a header may continue on a following line that begins with
  // whitespace, and a Content-Type with a boundary is often folded exactly
  // there.
  for (const line of head.replace(/\n[ \t]+/g, ' ').split('\n')) {
    const at = line.indexOf(':');
    if (at < 1) continue;
    const name = line.slice(0, at).trim().toLowerCase();
    // First wins: a second From is either a mistake or somebody trying
    // something, and neither should overwrite the first.
    if (!headers.has(name)) headers.set(name, line.slice(at + 1).trim());
  }
  return { headers, body };
}

function decodeBody(body: string, encoding: string, charset: string): string {
  const how = encoding.toLowerCase();
  let bytes: Buffer;

  if (how === 'base64') {
    bytes = Buffer.from(body.replace(/\s+/g, ''), 'base64');
  } else if (how === 'quoted-printable') {
    const joined = body.replace(/=\n/g, '');
    bytes = Buffer.from(
      joined.replace(/=([0-9A-Fa-f]{2})/g, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16)),
      ),
      'latin1',
    );
  } else {
    bytes = Buffer.from(body, 'utf8');
  }

  const which = charset.toLowerCase();
  // Latin-1 by name and by its aliases; everything else is read as UTF-8, which
  // is what a mail written this decade is.
  return which.includes('8859-1') || which.includes('latin1') || which === 'windows-1252'
    ? bytes.toString('latin1')
    : bytes.toString('utf8');
}

const parameterOf = (value: string, name: string): string => {
  const match = new RegExp(`${name}\\s*=\\s*"?([^";]+)"?`, 'i').exec(value);
  return match?.[1]?.trim() ?? '';
};

/**
 * Read one message.
 *
 * Single-part messages are the common case for a reply typed on a phone, and
 * `multipart/alternative` is the common case for one typed in a desktop client.
 * Both are handled; anything else yields no text, deliberately.
 */
export function readMail(raw: string): MailParts {
  const { headers, body } = splitHeaders(raw);
  const contentType = headers.get('content-type') ?? 'text/plain';
  const encoding = headers.get('content-transfer-encoding') ?? '7bit';

  if (!/^multipart\//i.test(contentType)) {
    const text = /^text\/plain/i.test(contentType)
      ? decodeBody(body, encoding, parameterOf(contentType, 'charset') || 'utf-8')
      : null;
    return { headers, text, hadAttachments: false };
  }

  const boundary = parameterOf(contentType, 'boundary');
  if (boundary === '') return { headers, text: null, hadAttachments: false };

  let text: string | null = null;
  let hadAttachments = false;

  for (const chunk of body.split(`--${boundary}`)) {
    const trimmed = chunk.trim();
    if (trimmed === '' || trimmed === '--') continue;

    const part = splitHeaders(chunk.replace(/^\n/, ''));
    const partType = part.headers.get('content-type') ?? 'text/plain';
    const disposition = part.headers.get('content-disposition') ?? '';

    if (/attachment/i.test(disposition)) {
      // Counted rather than kept: the reply says they were dropped, because
      // silence about a dropped file is worse than the drop (ADR-0060).
      hadAttachments = true;
      continue;
    }

    if (text === null && /^text\/plain/i.test(partType)) {
      /*
       * The newline before a boundary belongs to the boundary, not to the part
       * (RFC 2046). Without stripping it every plain part ends in a stray
       * newline — which is invisible in a mail client and turns into a trailing
       * blank line in a comment.
       */
      text = decodeBody(
        part.body,
        part.headers.get('content-transfer-encoding') ?? '7bit',
        parameterOf(partType, 'charset') || 'utf-8',
      ).replace(/\n$/, '');
    }
  }

  return { headers, text, hadAttachments };
}

/**
 * Every address a message was delivered to, for finding the token.
 *
 * `Delivered-To` first, because that is the address the *mailbox* saw and is
 * therefore the one that carries the sub-address — `To` may have been rewritten
 * by a list, a forward or somebody's filter, and the whole security of this
 * feature rests on reading the right one.
 */
export function deliveredAddresses(headers: Map<string, string>): string[] {
  const out: string[] = [];
  for (const name of ['delivered-to', 'x-original-to', 'to', 'cc']) {
    const value = headers.get(name);
    if (value) out.push(...value.split(',').map((one) => one.trim()));
  }
  return out;
}
