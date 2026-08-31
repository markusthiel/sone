/**
 * SONE web — der Katalog auf Deutsch (ADR-0041).
 *
 * Typed against the English catalogue, so a key added there and forgotten here is
 * a compile error. The comments in this file are German because whoever edits it
 * is translating; every other file in this codebase is commented in English.
 *
 * Anrede: „du". Eine selbst gehostete Anwendung für kleine Gruppen wird von
 * Leuten benutzt, die sich kennen — und „Sie" in einer Notizanwendung klingt wie
 * ein Amt.
 */

import type { en } from './messages.en.ts';

export const de: Record<keyof typeof en, string> = {
  'account.label': '{name} — Konto und Einstellungen',
  'account.yourSettings': 'Deine Einstellungen',
  'account.thisWorkspace': 'Dieser Workspace',
  'account.administration': 'Verwaltung',
  'account.trash': 'Papierkorb',
  'account.signOut': 'Abmelden',
  'account.version': 'Version und Lizenz',

  'move.workspace.title': 'In einen anderen Workspace verschieben',
  'move.workspace.label': '{title} in einen anderen Workspace verschieben',
  'move.workspace.nowhere':
    'Es gibt keinen Ort dafür. Ein Eintrag kann nur in einen Workspace, den du besitzt ' +
    'oder verwaltest.',
  'move.workspace.working': 'Wird ermittelt, was dieser Umzug bewegt…',
  'move.workspace.intro': '{title} nach {workspace} verschieben:',
  'move.workspace.again':
    'Später zurück zu verschieben ist ein zweiter Umzug, mit denselben Folgen.',
  'move.workspace.entries':
    '{count, plural, one {# Eintrag wird} other {# Einträge werden}} verschoben.',
  'move.workspace.files':
    '{count, plural, one {# Datei kommt} other {# Dateien kommen}} mit.',
  // Zwei Formen, weil das Deutsche hier zwei Sätze braucht: „ihn" gegen „sie".
  'move.workspace.restrictions':
    '{count, plural, one {# Eintrag kommt} other {# Einträge kommen}} ohne die jetzige ' +
    'Beschränkung an — jeder im neuen Workspace kann {count, plural, one {ihn} other {sie}} lesen.',
  'move.workspace.shareLinks':
    '{count, plural, one {# Freigabe-Link hört} other {# Freigabe-Links hören}} auf zu funktionieren.',
  'move.workspace.references':
    '{count, plural, one {# Verweis} other {# Verweise}} zwischen diesen Einträgen und ' +
    'denen, die zurückbleiben, {count, plural, one {wird} other {werden}} getrennt.',
  'move.workspace.favourites':
    '{count, plural, one {# Favorit} other {# Favoriten}} von Leuten, die nicht im neuen ' +
    'Workspace sind, {count, plural, one {fällt} other {fallen}} weg.',

  'action.cancel': 'Abbrechen',
  'action.move': 'Verschieben',
  'action.moving': 'Wird verschoben…',
};
