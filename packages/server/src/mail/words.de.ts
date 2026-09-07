/**
 * SONE server — was die Mails sagen, auf Deutsch (ADR-0133).
 *
 * Typed against the English catalogue, so a key added there and forgotten here
 * is a compile error. The comments in this file are German because whoever
 * edits it is translating; every other file in this codebase is commented in
 * English — the same arrangement `messages.de.ts` has had since ADR-0041.
 *
 * Anrede: „du" oder „Sie", eingestellt von dem, der die Instanz betreibt —
 * dieselbe Einstellung, die die Oberfläche benutzt. Im Katalog ein `select` auf
 * `address`, das jeder Meldung automatisch mitgegeben wird. Also nur dort ein
 * Zweig, wo die Anrede überhaupt vorkommt: `formal` ist das Sie, `other` das Du.
 *
 * **Eine Mail, die keine Anrede braucht, bekommt keinen Zweig.** „Ein Browser
 * ist kein Beweis dafür, wer ihn benutzt hat" ist in beiden Anreden derselbe
 * Satz, und ein Zweig darum wäre eine Zeile, die zweimal gepflegt werden muss,
 * um zweimal gleich zu sein.
 */

import type { en } from './words.en.js';

export const de: Record<keyof typeof en, string> = {
  // --- Einladung -----------------------------------------------------------
  'invitation.subject':
    '{where}: {address, select, formal {Sie wurden eingeladen} other {Du wurdest eingeladen}}',
  'invitation.heading':
    '{address, select, formal {Sie wurden zu {where} eingeladen.} other {Du wurdest zu {where} eingeladen.}}',
  'invitation.body':
    '{address, select, ' +
    'formal {Folgen Sie dem Link, um ein Konto anzulegen. Es wurde noch nichts für Sie angelegt — ' +
    'das Konto entsteht, sobald Sie ein Passwort gesetzt haben.} ' +
    'other {Folge dem Link, um ein Konto anzulegen. Es wurde noch nichts für dich angelegt — ' +
    'das Konto entsteht, sobald du ein Passwort gesetzt hast.}}',
  'invitation.expires':
    '{days, plural, one {Der Link funktioniert noch einen Tag.} other {Der Link funktioniert noch # Tage.}}',
  'invitation.action': 'Konto einrichten',
  'invitation.footer':
    '{address, select, ' +
    'formal {Wenn Sie das nicht erwartet haben, können Sie es übergehen. Es passiert nichts, ' +
    'solange Sie sich nicht anmelden.} ' +
    'other {Wenn du das nicht erwartet hast, kannst du es übergehen. Es passiert nichts, ' +
    'solange du dich nicht anmeldest.}}',

  // --- Zu einem Workspace hinzugefügt --------------------------------------
  'access.subject':
    '{where}: {address, select, formal {Sie haben Zugriff auf {workspace}} other {Du hast Zugriff auf {workspace}}}',
  'access.heading':
    '{address, select, formal {Sie können jetzt in {workspace} arbeiten.} other {Du kannst jetzt in {workspace} arbeiten.}}',
  'access.by':
    '{address, select, formal {{by} hat Ihnen Zugriff gegeben, als {role}.} other {{by} hat dir Zugriff gegeben, als {role}.}}',
  'access.anon':
    '{address, select, formal {Ihnen wurde Zugriff gegeben, als {role}.} other {Dir wurde Zugriff gegeben, als {role}.}}',
  'access.nothing':
    '{address, select, formal {Es gibt nichts zu bestätigen — es steht Ihnen schon offen.} ' +
    'other {Es gibt nichts zu bestätigen — es steht dir schon offen.}}',
  'access.action': 'Öffnen',

  // --- Zugriff entzogen ----------------------------------------------------
  'removal.subject':
    '{where}: {address, select, formal {Ihr Zugriff auf {workspace} ist beendet} other {Dein Zugriff auf {workspace} ist beendet}}',
  'removal.heading':
    '{address, select, formal {Sie haben keinen Zugriff mehr auf {workspace}.} other {Du hast keinen Zugriff mehr auf {workspace}.}}',
  'removal.by':
    '{address, select, formal {{by} hat Ihren Zugriff entfernt.} other {{by} hat deinen Zugriff entfernt.}}',
  'removal.anon':
    '{address, select, formal {Ihr Zugriff wurde entfernt.} other {Dein Zugriff wurde entfernt.}}',
  'removal.gone':
    '{address, select, ' +
    'formal {Alles, was darin mit Ihnen geteilt war, ist damit weg. Wenn das unerwartet kommt, ' +
    'fragen Sie, wer diesen Workspace betreut.} ' +
    'other {Alles, was darin mit dir geteilt war, ist damit weg. Wenn das unerwartet kommt, ' +
    'frag, wer diesen Workspace betreut.}}',

  // --- Rolle geändert ------------------------------------------------------
  'role.subject':
    '{where}: {address, select, formal {Ihre Rolle in {workspace} hat sich geändert} other {Deine Rolle in {workspace} hat sich geändert}}',
  'role.heading':
    '{address, select, formal {Sie sind jetzt {role} in {workspace}.} other {Du bist jetzt {role} in {workspace}.}}',
  'role.by':
    '{address, select, formal {{by} hat Ihre Rolle geändert.} other {{by} hat deine Rolle geändert.}}',
  'role.anon':
    '{address, select, formal {Ihre Rolle wurde geändert.} other {Deine Rolle wurde geändert.}}',
  'role.mayDiffer':
    '{address, select, formal {Was Sie dort tun können, kann sich damit geändert haben.} ' +
    'other {Was du dort tun kannst, kann sich damit geändert haben.}}',
  'role.action': 'Öffnen',

  // --- Anmeldung von einem unbekannten Browser -----------------------------
  'device.subject':
    '{where}: {address, select, formal {eine neue Anmeldung an Ihrem Konto} other {eine neue Anmeldung an deinem Konto}}',
  // Ohne Anrede, weil der Satz keine braucht.
  'device.heading':
    'Jemand hat sich von einem Browser angemeldet, den dieses Konto noch nicht benutzt hat.',
  'device.where': 'Gerade eben, von {from}.',
  'device.whereUnknown': 'Gerade eben, von einer Adresse, die diese Instanz nicht sehen konnte.',
  'device.otherwise':
    '{address, select, ' +
    'formal {Wenn Sie das waren, ist nichts zu tun. Wenn nicht, ändern Sie jetzt Ihr Passwort ' +
    'und sagen Sie Bescheid, wer diese Instanz betreibt.} ' +
    'other {Wenn du das warst, ist nichts zu tun. Wenn nicht, ändere jetzt dein Passwort ' +
    'und sag Bescheid, wer diese Instanz betreibt.}}',
  'device.action': 'Einstellungen öffnen',
  'device.footer':
    'Das wird einmal pro Browser gesendet. Ein Browser ist kein Beweis dafür, wer ihn benutzt hat.',

  // --- Die allererste Anmeldung --------------------------------------------
  'welcome.subject': '{where}: willkommen',
  'welcome.headingNamed': 'Willkommen, {name}.',
  'welcome.heading': 'Willkommen.',
  'welcome.ready':
    '{address, select, formal {Ihr Konto auf {where} ist fertig und Sie sind angemeldet.} ' +
    'other {Dein Konto auf {where} ist fertig und du bist angemeldet.}}',
  'welcome.workspaces':
    '{address, select, ' +
    'formal {Notizen liegen in Workspaces, und Sie sehen die, für die Sie freigeschaltet sind. ' +
    'Alles, was Sie schreiben, bleibt auf diesem Server.} ' +
    'other {Notizen liegen in Workspaces, und du siehst die, für die du freigeschaltet bist. ' +
    'Alles, was du schreibst, bleibt auf diesem Server.}}',
  'welcome.action': 'SONE öffnen',

  // --- Einladung nie eingelöst ---------------------------------------------
  'chase.subject': '{where}: eine Einladung wartet noch',
  'chase.heading': 'Diese Einladung hat noch niemand benutzt.',
  'chase.toAddress':
    '{address, select, ' +
    'formal {{days, plural, one {Sie haben {who} vor einem Tag zu {workspace} eingeladen.} ' +
    'other {Sie haben {who} vor # Tagen zu {workspace} eingeladen.}}} ' +
    'other {{days, plural, one {Du hast {who} vor einem Tag zu {workspace} eingeladen.} ' +
    'other {Du hast {who} vor # Tagen zu {workspace} eingeladen.}}}}',
  'chase.asLink':
    '{address, select, ' +
    'formal {{days, plural, one {Sie haben vor einem Tag einen Einladungslink für {workspace} gemacht.} ' +
    'other {Sie haben vor # Tagen einen Einladungslink für {workspace} gemacht.}}} ' +
    'other {{days, plural, one {Du hast vor einem Tag einen Einladungslink für {workspace} gemacht.} ' +
    'other {Du hast vor # Tagen einen Einladungslink für {workspace} gemacht.}}}}',
  'chase.stillWorks':
    '{address, select, ' +
    'formal {Er funktioniert noch. Schicken Sie ihn noch einmal, oder ziehen Sie ihn zurück, ' +
    'wenn es ein Versehen war.} ' +
    'other {Er funktioniert noch. Schick ihn noch einmal, oder zieh ihn zurück, ' +
    'wenn es ein Versehen war.}}',
  'chase.action': 'Einladungen öffnen',

  // --- Ein Link, der bald abläuft ------------------------------------------
  'link.subject': '{where}: ein geteilter Link läuft bald ab',
  'link.heading': 'Ein Link zu {what} funktioniert ab {when} nicht mehr.',
  'link.theyCannot': 'Wer ihn bekommen hat, kann ihn danach nicht mehr öffnen.',
  'link.makeNew':
    '{address, select, formal {Machen Sie einen neuen, wenn er noch gebraucht wird, oder lassen Sie ihn auslaufen.} ' +
    'other {Mach einen neuen, wenn er noch gebraucht wird, oder lass ihn auslaufen.}}',
  'link.somePage': 'eine Seite',
  'link.action': 'SONE öffnen',

  // --- Mailversand ausgefallen ---------------------------------------------
  'outage.subject':
    '{where}: {count, plural, one {eine Benachrichtigung ist nicht rausgegangen} ' +
    'other {# Benachrichtigungen sind nicht rausgegangen}}',
  'outage.heading': 'Mail von dieser Instanz konnte nicht gesendet werden.',
  'outage.window':
    '{count, plural, one {Seit {when} ist eine Benachrichtigung fehlgeschlagen.} ' +
    'other {Seit {when} sind # Benachrichtigungen fehlgeschlagen.}} ' +
    'Diese Nachricht ist angekommen, das Relay antwortet also wieder.',
  'outage.notResent':
    'Die fehlgeschlagenen werden nicht erneut gesendet. Die Relay-Einstellungen prüfen.',
  'outage.action': 'Verwaltung öffnen',

  // --- Ein Link, den jemand von Hand geschickt hat -------------------------
  'share.subject':
    '{address, select, formal {{by} hat etwas mit Ihnen geteilt} other {{by} hat etwas mit dir geteilt}}',
  'share.line':
    '{address, select, formal {{by} hat {what} mit Ihnen geteilt.} other {{by} hat {what} mit dir geteilt.}}',
  'share.password':
    '{address, select, formal {Dieser Link ist mit einem Passwort geschützt. Fragen Sie, wer ihn geschickt hat.} ' +
    'other {Dieser Link ist mit einem Passwort geschützt. Frag, wer ihn geschickt hat.}}',
  'share.until': 'Der Link funktioniert bis {when}.',
  'share.action': 'Seite öffnen',
  'share.footer':
    '{address, select, ' +
    'formal {Sie bekommen das, weil Ihnen jemand einen Link geschickt hat. Es gibt nichts abzubestellen.} ' +
    'other {Du bekommst das, weil dir jemand einen Link geschickt hat. Es gibt nichts abzubestellen.}}',

  // --- Ein Job, den jemand angestoßen hat, ist fertig ----------------------
  'export.subject': '{where}: der Export von {workspace} ist fertig',
  'export.heading':
    '{address, select, formal {Der Export von {workspace}, den Sie angestoßen haben, ist fertig.} ' +
    'other {Der Export von {workspace}, den du angestoßen hast, ist fertig.}}',
  'export.what': '{pages, plural, one {Eine Seite} other {# Seiten}}, {size}.',
  'export.until': 'Er kann bis {when} abgeholt werden.',
  'export.action': 'Export öffnen',
  'export.footer.notAttached':
    'Das Archiv hängt nicht an: eine Kopie eines ganzen Workspace gehört nicht in ein Postfach.',
  'export.footer.signedIn':
    '{address, select, ' +
    'formal {Der Link öffnet den Bildschirm, von dem aus Sie gefragt haben; für das Herunterladen ' +
    'müssen Sie als Sie selbst angemeldet sein.} ' +
    'other {Der Link öffnet den Bildschirm, von dem aus du gefragt hast; zum Herunterladen musst ' +
    'du als du selbst angemeldet sein.}}',

  'export.failed.subject': '{where}: der Export von {workspace} ist nicht fertig geworden',
  'export.failed.heading':
    '{address, select, formal {Der Export von {workspace}, den Sie angestoßen haben, ist nicht fertig geworden.} ' +
    'other {Der Export von {workspace}, den du angestoßen hast, ist nicht fertig geworden.}}',
  'export.failed.why':
    'Es wurde mehrfach versucht. Der Export-Bildschirm sagt, woran es lag.',
  'export.failed.action': 'Export-Bildschirm öffnen',

  // --- Was sich geändert hat -----------------------------------------------
  'digest.subject.weekly': 'SONE: was sich diese Woche geändert hat',
  'digest.subject.daily': 'SONE: was sich gestern geändert hat',
  'digest.somebody': 'jemand',
  'digest.workspace': '{workspace}:',
  'digest.byOne': '{title} — {who}',
  'digest.bySeveral':
    '{others, plural, one {{title} — {who} und eine weitere Person} ' +
    'other {{title} — {who} und # weitere Personen}}',
  'digest.changed': '{count, plural, one {eine Seite geändert} other {# Seiten geändert}}',
  'digest.more': '{count, plural, one {und eine weitere.} other {und # weitere.}}',
  'digest.action': 'SONE öffnen',

  // --- Eine Benachrichtigung -----------------------------------------------
  /*
   * Zwei Formulierungen je Art, nicht eine mit einem Namen davor.
   *
   * Deutsch kann vor „Du wurdest erwähnt" kein Subjekt setzen und grammatisch
   * bleiben, und Englisch auch nicht — „Anna You were mentioned on". Es ändert
   * sich der Satz, nicht das Präfix.
   */
  'notify.mention':
    '{address, select, formal {{by} hat Sie erwähnt auf {what}.} other {{by} hat dich erwähnt auf {what}.}}',
  'notify.mentionAlone':
    '{address, select, formal {Sie wurden erwähnt auf {what}.} other {Du wurdest erwähnt auf {what}.}}',
  'notify.reply':
    '{address, select, ' +
    'formal {{by} hat auf einen Kommentar geantwortet, in dem Sie sind, auf {what}.} ' +
    'other {{by} hat auf einen Kommentar geantwortet, in dem du bist, auf {what}.}}',
  'notify.replyAlone':
    '{address, select, ' +
    'formal {Es gibt eine Antwort in einem Kommentar, in dem Sie sind, auf {what}.} ' +
    'other {Es gibt eine Antwort in einem Kommentar, in dem du bist, auf {what}.}}',
  'notify.assignment':
    '{address, select, formal {{by} hat Ihnen eine Aufgabe gegeben auf {what}.} ' +
    'other {{by} hat dir eine Aufgabe gegeben auf {what}.}}',
  'notify.assignmentAlone':
    '{address, select, formal {Sie haben eine Aufgabe bekommen auf {what}.} ' +
    'other {Du hast eine Aufgabe bekommen auf {what}.}}',
  'notify.subjectOne': '{what}',
  'notify.subjectOneBy': '{by} — {what}',
  'notify.subjectMany':
    '{count, plural, one {eine Benachrichtigung in {workspace}} ' +
    'other {# Benachrichtigungen in {workspace}}}',
  'notify.action': 'SONE öffnen',
  'notify.footer.noText': 'Diese Nachricht enthält absichtlich keinen Kommentartext.',
  // Verweist auf den Namen des Bereichs in der Oberfläche, der die Anrede trägt.
  'notify.footer.stop':
    'Zum Abstellen anmelden und unter {address, select, formal {Sie} other {Du}} → Benachrichtigungen ändern:',
};
