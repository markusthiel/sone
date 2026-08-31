/**
 * SONE web — der Katalog auf Deutsch (ADR-0041).
 *
 * Typed against the English catalogue, so a key added there and forgotten here is
 * a compile error. The comments in this file are German because whoever edits it
 * is translating; every other file in this codebase is commented in English.
 *
 * Anrede: „du" oder „Sie", eingestellt von dem, der die Instanz betreibt. Im
 * Katalog ein `select` auf `address`, das jeder Meldung automatisch mitgegeben
 * wird — also nur dort ein Zweig, wo die Anrede überhaupt vorkommt. Ein zweiter
 * deutscher Katalog wäre jeder String doppelt, und zwei Kataloge driften.
 *
 * Wer hier übersetzt: die Zweige heißen `formal` und `other`. `other` ist das Du,
 * weil es der Standard ist; eine Sprache ohne Anredeunterschied braucht gar
 * keinen Zweig.
 */

import type { en } from './messages.en.ts';

export const de: Record<keyof typeof en, string> = {
  'account.label': '{name} — Konto und Einstellungen',
  'account.yourSettings':
    '{address, select, formal {Ihre Einstellungen} other {Deine Einstellungen}}',
  'account.thisWorkspace': 'Dieser Workspace',
  'account.administration': 'Verwaltung',
  'account.trash': 'Papierkorb',
  'account.signOut': 'Abmelden',
  'account.version': 'Version und Lizenz',

  'move.workspace.title': 'In einen anderen Workspace verschieben',
  'move.workspace.label': '{title} in einen anderen Workspace verschieben',
  'move.workspace.nowhere':
    'Es gibt keinen Ort dafür. Ein Eintrag kann nur in einen Workspace, ' +
    '{address, select, formal {den Sie besitzen oder verwalten} ' +
    'other {den du besitzt oder verwaltest}}.',
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

  // --- was schiefgegangen ist --------------------------------------------
  'error.invalid_credentials': 'Diese E-Mail-Adresse und dieses Passwort passen nicht zusammen.',
  'error.rate_limited': 'Zu viele Versuche. Bitte ein paar Minuten warten.',
  'error.weak_password': 'Ein Passwort braucht mindestens 12 Zeichen.',
  'error.missing_fields': 'Bitte alle Felder ausfüllen.',
  'error.invitation_invalid': 'Diese Einladung ist abgelaufen oder schon benutzt.',
  'error.no_workspace':
    '{address, select, formal {Ihr Konto ist} other {Dein Konto ist}} noch in keinem ' +
    'Workspace Mitglied.',
  'error.network_error': 'Der Server ist nicht erreichbar.',
  'error.invalid_role': 'Ein Freigabe-Link kann diese Rolle nicht vergeben.',
  'error.too_many_rows': 'Das sind mehr als fünfzig Einträge. Bitte in kleineren Stücken einfügen.',
  'error.not_archived': 'Dieser Eintrag ist nicht im Papierkorb.',
  'error.parent_missing':
    'Der Ordner, in dem das lag, ist weg. Erst diesen Ordner wiederherstellen, oder das ' +
    'hier woandershin verschieben.',
  'error.clipboard_unavailable':
    'Automatisches Kopieren ging nicht. Den Link markieren und von Hand kopieren.',
  'error.file_too_large': 'Diese Datei ist zu groß.',
  'error.clipboard_refused':
    'Dieser Browser hat der Seite den Zugriff auf die Zwischenablage verweigert. Die ' +
    'Zeilen markieren und Kopieren drücken tut dasselbe.',
  // Diagnosen für Betreiber: die Begriffe bleiben, weil man sie in der eigenen
  // Konfiguration wiederfinden muss.
  'error.proxy_rejected_size':
    'Der Webserver vor SONE hat die Datei als zu groß abgelehnt. Sein Upload-Limit ist ' +
    'ein anderes als das von SONE — bei nginx ist es client_max_body_size, das ohne ' +
    'Änderung nur 1 MB erlaubt.',
  'error.proxy_error':
    'Etwas zwischen Browser und SONE hat die Anfrage abgelehnt. Das Log des Reverse ' +
    'Proxy sagt mehr als das von SONE.',
  'error.unsupported_file_type': 'Dieser Dateityp wird nicht unterstützt.',
  'error.empty_file': 'Diese Datei ist leer.',
  'error.storage_unavailable':
    'SONE konnte die Datei nicht auf die Platte schreiben. Das Server-Log nennt das ' +
    'Verzeichnis; meist gehört das Volume einem anderen Benutzer als dem im Container.',
  'error.file_missing_from_storage':
    'Die Datei ist verzeichnet, fehlt aber im Speicher. Vielleicht wurde die Instanz ohne ' +
    'ihre Dateien wiederhergestellt.',
  'error.rows_required': 'Es war nichts ausgewählt.',
  'error.unknown_error': 'Da ist etwas schiefgegangen.',

  'action.cancel': 'Abbrechen',
  'action.move': 'Verschieben',
  'action.moving': 'Wird verschoben…',
};
