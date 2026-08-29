/**
 * SONE web tests — reading a source file without its prose.
 *
 * Several tests here assert that something is *absent* from a file: no
 * `pointerdown` listener, no free-text input, no editor view reached for from a
 * panel. Every one of them read the raw file, and three of them matched a
 * comment explaining why the thing is absent — the test failing on the sentence
 * that documents the rule it is enforcing.
 *
 * That failure mode is worse than it looks. The obvious repair is to reword the
 * comment, which silences the test without touching the code, and the next
 * person has no way to tell that is what happened. This project is heavily
 * commented on purpose, so the collision is not rare — it happened three times
 * in one day.
 *
 * So: assertions about code read code.
 */

import { readFileSync } from 'node:fs';

/**
 * A source file with its comments removed.
 *
 * Line and block comments, and JSX comments, which are a block comment inside
 * braces and would otherwise leave `{}` behind — harmless for matching, but
 * confusing to read in a failure message.
 *
 * Strings are left alone. A test could in principle match a comment-like
 * sequence inside a string literal, but a rule about code that happens to be
 * quoted is still about code, and stripping strings would hide the very things
 * some of these tests look for.
 */
export function codeOf(url: URL): string {
  return readFileSync(url, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

/*
 * Two attempts at handling JSX comments specially are worth recording, because
 * both were the same mistake in different clothes.
 *
 * The first matched a brace, then anything, then a comment — which found an
 * ordinary code brace followed later by a comment and swallowed everything
 * between. Whole functions vanished and unrelated tests failed while this file
 * looked innocent.
 *
 * The second tightened it to a brace whose first content is a comment, and that
 * still spans: `onClick={() => { /* … *\/` is exactly that shape, and the match
 * runs on to the next `*\/}` somewhere below.
 *
 * The third removed the `{}` a stripped JSX comment leaves behind, which
 * deleted empty object literals from real code.
 *
 * So neither is done. A `{}` left where a JSX comment was is harmless to match
 * against, and the alternative is a small parser — which is a great deal of
 * machinery to make failure output tidier.
 */

/** The same, for a stylesheet, where only block comments exist. */
export function stylesOf(url: URL): string {
  return readFileSync(url, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
}
