/**
 * SONE web — which language the interface speaks (ADR-0041).
 *
 * The locale is resolved once, in a stated order: the person's own setting, then
 * the workspace's default, then the browser's list, then English. The person's
 * comes first because a workspace has one language and its members need not share
 * it — which is the whole reason both fields exist.
 *
 * Changing it does not reload. Reloading throws away a half-typed paragraph, and
 * somebody changing the language has very often just arrived and is in the middle
 * of something.
 *
 * Catalogues other than English arrive on demand, so an English instance never
 * pays for the others and a German one fetches German once.
 */

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';

import { formatMessage, type MessageValues } from './format.ts';
import { en, type MessageKey } from './messages.en.ts';

/** Locales with a catalogue. The server's list is the same one (ADR-0011). */
export const LOCALES = ['en', 'de'] as const;
export type Locale = (typeof LOCALES)[number];
export const FALLBACK: Locale = 'en';

function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * The first of these that names a locale we have.
 *
 * A browser sends `de-DE`; the language before the region is what matters here,
 * because a catalogue is per language until somebody has a reason to split it.
 */
export function resolveLocale(
  personal: string | null | undefined,
  workspace: string | null | undefined,
  browser: readonly string[] = typeof navigator === 'undefined' ? [] : navigator.languages,
): Locale {
  for (const candidate of [personal, workspace, ...browser]) {
    if (!candidate) continue;
    const language = candidate.split('-')[0]?.toLowerCase();
    if (isLocale(language)) return language;
  }
  return FALLBACK;
}

type Catalogue = Record<string, string>;

interface LocaleState {
  locale: Locale;
  catalogue: Catalogue;
  setLocale: (locale: Locale) => void;
}

const LocaleContext = createContext<LocaleState>({
  locale: FALLBACK,
  catalogue: en,
  setLocale: () => undefined,
});

export function LocaleProvider({
  initial,
  children,
}: {
  initial: Locale;
  children: ReactNode;
}): ReactElement {
  const [locale, setLocale] = useState<Locale>(initial);
  const [catalogue, setCatalogue] = useState<Catalogue>(en);

  useEffect(() => {
    if (locale === 'en') {
      setCatalogue(en);
      return;
    }
    let cancelled = false;
    void import('./messages.de.ts').then((module) => {
      if (!cancelled) setCatalogue(module.de);
    });
    return () => {
      cancelled = true;
    };
  }, [locale]);

  // The document says which language it is in, for the browser's own spelling
  // and for anything reading the page aloud.
  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo(() => ({ locale, catalogue, setLocale }), [locale, catalogue]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/**
 * Translate.
 *
 * A missing key falls back to the English message rather than to the key: a
 * half-translated screen should read as a sentence in the wrong language, not as
 * `move.workspace.title`.
 */
export function useT(): {
  t: (key: MessageKey, values?: MessageValues) => string;
  locale: Locale;
  setLocale: (locale: Locale) => void;
} {
  const { locale, catalogue, setLocale } = useContext(LocaleContext);
  return useMemo(
    () => ({
      locale,
      setLocale,
      t: (key, values) => formatMessage(catalogue[key] ?? en[key] ?? key, values, locale),
    }),
    [locale, catalogue, setLocale],
  );
}
