/**
 * What an entry in the tree offers this person (ADR-0095).
 *
 * **This is not a second place where rights are decided.** The server decides,
 * once, in `effectiveRole`, and sends the answer on every entry. These are two
 * readings of that answer — what a control asks before drawing itself.
 *
 * The distinction matters because ADR-0026's rule is that a second place for
 * rights is how two answers come about, and it is exactly right about
 * *deciding*. Every write here is still refused by the route that receives it;
 * the reason these functions exist is that a button which is always refused is
 * a lie, not a safeguard — a member with viewer rights on a folder got a rename
 * field and three create buttons, all of which answered 403 (ADR-0092).
 *
 * A null role means a page kept only as the path to a granted child: nothing at
 * all is offered there, which every function below answers by saying no.
 */

import { atLeast, type Role } from '@sone/core';

/** The part of an entry these questions are asked of. */
export interface WithRole {
  role: Role | null;
  /** A page reached only as the path to a child (ADR-0026). */
  pathOnly?: boolean;
}

/**
 * May they change this entry — rename it, move it, put something in it,
 * delete it, give it an icon?
 *
 * One question rather than one per verb, because the server asks one: every
 * write route on a page refuses `viewer` and `commenter` and accepts the rest.
 * Splitting it here would invent distinctions the server does not make, and an
 * invented distinction is a promise the interface cannot keep.
 */
export function mayEdit(entry: WithRole | null | undefined): boolean {
  if (!entry || entry.pathOnly || entry.role === null) return false;
  return atLeast(entry.role, 'editor');
}

/**
 * May they decide who else gets in — share links, permissions?
 *
 * Its own question, and a stricter one: `requirePageAdmin` guards those routes,
 * so an editor may write a page and may not hand it to somebody else. That is
 * the one place where "can change it" and "can pass it on" genuinely differ,
 * and it is worth the second function rather than a boolean argument.
 */
export function mayManage(entry: WithRole | null | undefined): boolean {
  if (!entry || entry.pathOnly || entry.role === null) return false;
  return entry.role === 'admin';
}
