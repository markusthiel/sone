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

  // --- Seitenleiste und Baum ---------------------------------------------
  'sidebar.label': 'Seiten',
  'sidebar.close': 'Navigation schließen',
  'sidebar.hide': 'Seitenleiste ausblenden',
  'sidebar.search': 'Suchen',
  'sidebar.favourites': 'Favoriten',
  'sidebar.newFolder': 'Neuer Ordner',
  'sidebar.empty': 'Noch keine Seiten.',
  'sidebar.rename': 'Umbenennen',
  'sidebar.newPageIn': 'Neue Seite in {title}',
  'sidebar.removeFavourite': '{title} entfernen',

  // --- das Menü eines Eintrags -------------------------------------------
  'entry.menu': 'Mehr zu {title}',
  'entry.rename': 'Umbenennen',
  'entry.icon': 'Symbol und Farbe',
  'entry.favourite': 'Zu Favoriten hinzufügen',
  'entry.unfavourite': 'Aus Favoriten entfernen',
  'entry.share': 'Teilen…',
  'entry.move': 'Verschieben nach…',
  'entry.moveToWorkspace': 'In einen Workspace verschieben…',
  'entry.newPage': 'Neue Seite',
  'entry.newFolder': 'Neuer Ordner',
  'entry.moveUp': 'Nach oben',
  'entry.moveDown': 'Nach unten',
  'entry.delete': 'In den Papierkorb',
  'entry.deleteWithChildren':
    'In den Papierkorb, mit {count, plural, one {# Eintrag} other {# Einträgen}} darin',

  // --- der Verwaltungsbereich --------------------------------------------
  'admin.instance': 'Diese Instanz',
  'admin.instance.hint': 'Name, Registrierung und Vorgaben',
  'admin.accounts': 'Konten',
  'admin.accounts.hint': 'Alle, die hier ein Konto haben',
  'admin.workspaces': 'Alle Workspaces',
  'admin.workspaces.hint': 'Jeder Workspace hier, und wer darin ist',
  'admin.invitations': 'Einladungen',
  'admin.invitations.hint': 'Ein Konto und ein eigener Workspace — kein Team',
  'admin.sso': 'Single Sign-on',
  'admin.sso.hint': 'Anmeldung über einen Identitätsanbieter',
  'admin.maintenance': 'Wartung',
  'admin.maintenance.hint': 'Speicher, Aufgaben und Gesundheit',

  'admin.settings': 'Einstellungen',
  'admin.instanceName': 'Name der Instanz',
  'admin.signup': 'Wer ein Konto anlegen darf',
  'admin.signup.open': 'Jeder, der die Adresse hat',
  'admin.signup.invite': 'Nur mit Einladung',
  'admin.signup.closed': 'Niemand — keine neuen Konten',
  'admin.mayCreateWorkspaces': 'Mitglieder dürfen Workspaces anlegen',
  'admin.addressForm': 'Wie die Oberfläche die Leute anspricht',
  'admin.addressForm.hint':
    'Auf Deutsch und in anderen Sprachen, die das unterscheiden. Englisch hat nur ' +
    'eine Form und bleibt unberührt.',
  'admin.addressForm.informal': 'Vertraut — „du"',
  'admin.addressForm.formal': 'Förmlich — „Sie"',
  'admin.version': 'Version',
  'admin.content': 'Inhalt',
  'admin.files': 'Dateien',
  'admin.waitingToProject': 'Wartet auf Projektion',
  'admin.recentFailures': 'Letzte Fehler',
  'admin.nothingToReport': 'Nichts zu melden.',
  'admin.uploadsUnwritable': 'Uploads können nicht auf die Platte geschrieben werden',
  'admin.loading': 'Wird geladen…',
  'admin.signup.note': 'Wer schon eines hat, ist davon nicht betroffen.',
  'admin.instanceName.hint': 'Auf der Anmeldeseite und im Titel jedes Tabs.',
  'admin.settingSource.database': 'Hier gesetzt, überschreibt die Umgebung',
  'admin.reloadNote': 'Danach diese Seite neu laden — ein Neustart ist nicht nötig.',
  'action.retry': 'Erneut versuchen',

  // --- die Einstellungsbereiche und ihre Hülle ---------------------------
  'area.you': '{address, select, formal {Ihre Einstellungen} other {Deine Einstellungen}}',
  'area.workspace': 'Dieser Workspace',
  'area.instance': 'Verwaltung',
  'settings.navLabel': 'Einstellungen: {area}',
  'settings.back': '‹ Zurück zu den Notizen',
  'settings.sections': 'Abschnitte',

  // --- die eigenen Einstellungen -----------------------------------------
  'you.profile': 'Profil',
  'you.profile.hint':
    '{address, select, formal {Ihr Name, Ihre Adresse und Ihr Bild} ' +
    'other {Dein Name, deine Adresse und dein Bild}}',
  'you.signIn': 'Anmelden',
  'you.signIn.hint': '{address, select, formal {Ihr Passwort} other {Dein Passwort}}',
  'you.appearance': 'Aussehen',
  'you.appearance.hint':
    'Wie SONE {address, select, formal {für Sie} other {für dich}} aussieht',
  'you.landing': '{address, select, formal {Wo Sie landen} other {Wo du landest}}',
  'you.landing.hint': 'Die Seite, mit der jeder Workspace öffnet',
  'you.about': 'Über',
  'you.about.hint': 'Version und Lizenz',

  'you.picture': 'Bild',
  'you.picture.hint':
    'Jede Größe — es wird hier verkleinert, bevor es gesendet wird, und klein gezeigt.',
  'you.name': 'Name',
  'you.name.hint':
    'Was andere neben allem sehen, was {address, select, formal {Sie hier schreiben} ' +
    'other {du hier schreibst}}.',
  'you.email': 'E-Mail',
  'you.workspace': 'Workspace',
  'you.workspace.hint':
    'Wo {address, select, formal {Sie gerade sind} other {du gerade bist}}.',
  'you.saved': 'Gespeichert.',

  'you.currentPassword': 'Aktuelles Passwort',
  'you.newPassword': 'Neues Passwort',

  'you.theme': 'Erscheinungsbild',
  'you.theme.system': 'Wie das System',
  'you.theme.light': 'Hell',
  'you.theme.dark': 'Dunkel',
  'you.interfaceSize': 'Schriftgröße der Oberfläche',
  'you.interfaceSize.hint':
    'Seitenleiste, Menüs und Einstellungen — alles außer dem Geschriebenen.',
  'you.editorSize': 'Schriftgröße im Editor',
  'you.editorSize.hint':
    '{address, select, formal {Ihr Geschriebenes} other {Dein Geschriebenes}}, und sonst nichts.',
  'you.thisBrowser': 'Dieser Browser',

  'about.server': 'Server',
  'about.documentFormat': 'Dokumentformat',
  'about.syncProtocol': 'Sync-Protokoll',
  'about.checking': 'wird geprüft…',

  // --- Einstellungen dieses Workspace ------------------------------------
  'workspace.nameAndMark': 'Name und Zeichen',
  'workspace.nameAndMark.hint': 'Wie dieser Workspace heißt und woran man ihn erkennt',
  'workspace.typography': 'Typografie',
  'workspace.typography.hint': 'Wie dieser Workspace liest',
  'workspace.people': 'Leute',
  'workspace.people.hint': 'Wer in diesem Workspace ist, mit welcher Rolle, und wie man einlädt',
  'workspace.groups': 'Gruppen',
  'workspace.groups.hint': 'Benannte Gruppen von Leuten, für Seitenrechte',
  'workspace.name': 'Name',
  'workspace.name.hint': 'Wie dieser Workspace heißt, überall wo er auftaucht.',
  'workspace.nameLabel': 'Name des Workspace',
  'workspace.role': '{address, select, formal {Ihre Rolle} other {Deine Rolle}}',
  'workspace.role.hint':
    'Was {address, select, formal {Sie hier dürfen} other {du hier darfst}}. Rollen werden ' +
    'im Abschnitt „Leute" gesetzt.',
  'workspace.mark': 'Zeichen',
  'workspace.saveFailed': 'Das konnte nicht gespeichert werden. Bitte noch einmal.',

  // --- der Papierkorb ----------------------------------------------------
  'trash.title': 'Papierkorb',
  'trash.note':
    'Gelöschte Einträge bleiben hier, bis sie vernichtet werden. Nichts wird nach einem ' +
    'Zeitplan entfernt — eine Instanz, die ihren Papierkorb still leert, ist eine, die ' +
    'jemandes Arbeit verliert, während er im Urlaub ist.',
  'trash.empty': 'Es wurde nichts gelöscht.',
  'trash.restore': 'Wiederherstellen',
  'trash.destroy': 'Vernichten',
  'trash.keep': 'Behalten',
  'trash.confirm': 'Endgültig vernichten? Das lässt sich nicht zurücknehmen.',
  'trash.loading': 'Wird geladen…',

  // --- Suche -------------------------------------------------------------
  'search.title': 'Suche',
  'search.field': 'Seiten suchen',
  'search.placeholder': 'Seiten suchen…',
  'search.folders': 'Ordner',
  'search.pages': 'Seiten',
  'search.nothing': 'Nichts gefunden.',
  'search.didYouMean': 'Vielleicht',
  'search.similar': 'Ähnliche Namen',
  'search.matchedTitle': 'Name',

  // --- das /-Menü ---------------------------------------------------------
  //
  // `keywords` sind zusätzliche Suchwörter auf Deutsch; die englischen aus dem
  // Editor-Paket gelten immer mit, weil „h1" und „ul" in jeder Sprache getippt
  // werden.
  'slash.paragraph': 'Text',
  'slash.paragraph.hint': 'Einfacher Absatz',
  'slash.paragraph.keywords': 'absatz, fließtext',
  'slash.heading-1': 'Überschrift 1',
  'slash.heading-1.hint': 'Abschnittstitel',
  'slash.heading-1.keywords': 'überschrift, titel',
  'slash.heading-2': 'Überschrift 2',
  'slash.heading-2.hint': 'Abschnittstitel',
  'slash.heading-2.keywords': 'überschrift, titel',
  'slash.heading-3': 'Überschrift 3',
  'slash.heading-3.hint': 'Abschnittstitel',
  'slash.heading-3.keywords': 'überschrift, titel',
  'slash.bulletList': 'Aufzählung',
  'slash.bulletList.hint': 'Eine ungeordnete Liste',
  'slash.bulletList.keywords': 'liste, punkte, stichpunkte',
  'slash.numberedList': 'Nummerierte Liste',
  'slash.numberedList.hint': 'Eine geordnete Liste',
  'slash.numberedList.keywords': 'liste, nummer, zahlen',
  'slash.todo': 'Aufgabe',
  'slash.todo.hint': 'Etwas zum Abhaken',
  'slash.todo.keywords': 'aufgabe, haken, erledigt, checkliste',
  'slash.toggle': 'Ausklappbar',
  'slash.toggle.hint': 'Zusammenklappbarer Abschnitt',
  'slash.toggle.keywords': 'ausklappen, einklappen, details',
  'slash.quote': 'Zitat',
  'slash.quote.hint': 'Zitierte Passage',
  'slash.quote.keywords': 'zitat, zitieren',
  'slash.callout': 'Hinweis',
  'slash.callout.hint': 'Hervorgehobene Notiz',
  'slash.callout.keywords': 'hinweis, kasten, merke',
  'slash.code': 'Code',
  'slash.code.hint': 'Vorformatierter Codeblock',
  'slash.code.keywords': 'quelltext, programm',
  'slash.image': 'Bild',
  'slash.image.hint': 'Ein Bild hochladen',
  'slash.image.keywords': 'bild, foto, grafik',
  'slash.table': 'Tabelle',
  'slash.table.hint': 'Zeilen und Spalten',
  'slash.table.keywords': 'tabelle, raster',
  'slash.file': 'Datei',
  'slash.file.hint': 'Ein PDF, ein Dokument, eine Tabelle — hier gezeigt oder zum Öffnen angeboten',
  'slash.file.keywords': 'datei, anhang, pdf, dokument',
  'slash.video': 'Video',
  'slash.video.hint': 'Hochladen, einen Link einfügen oder auf einen Live-Stream zeigen',
  'slash.video.keywords': 'video, film, stream',
  'slash.protected': 'Geschützter Abschnitt',
  // Neutral formuliert: „die du hinzufügst" gegen „die Sie hinzufügen" ist hier
  // vermeidbar, und ein Hinweis unter einem Menüeintrag soll kurz sein.
  'slash.protected.hint': 'Ein Teil dieser Seite, den nur die hinzugefügten Leute öffnen können',
  'slash.protected.keywords': 'geschützt, privat, vertraulich',
  'slash.collection': 'Tabelle mit Einträgen',
  'slash.collection.hint': 'Eine Sammlung: Zeilen mit Spalten, jede Zeile eine eigene Seite',
  'slash.collection.keywords': 'datenbank, sammlung, einträge',
  'slash.divider': 'Trennlinie',
  'slash.divider.hint': 'Waagerechte Linie',
  'slash.divider.keywords': 'linie, trenner',

  // --- die Leiste neben einer Seite --------------------------------------
  'panel.label': 'Seitenleiste rechts',
  'panel.close': 'Leiste schließen',
  'panel.outline': 'Gliederung',
  'panel.untitledHeading': 'Überschrift ohne Text',
  'panel.untitledTask': 'Aufgabe ohne Text',
  'panel.goToTask': 'Zu dieser Aufgabe',
  'panel.showInPage': 'Zeigen, wo es in der Seite steht',
  'panel.showLinkInPage': 'Diesen Link in der Seite zeigen',
  'panel.done': 'Erledigt',
  'panel.created': 'Erstellt',
  'panel.edited': 'Bearbeitet',
  'panel.sync': 'Abgleich',
  'panel.yourAccess': '{address, select, formal {Ihr Zugriff} other {Dein Zugriff}}',
  'panel.loading': 'Wird geladen…',
  'panel.uploading': 'wird hochgeladen…',
  'panel.noImages': 'Noch keine Bilder. Zieh eines in die Seite.',
  'panel.noLinks': 'Noch keine Links.',
  'panel.noFiles': 'Noch keine Dateien. Zieh eine in die Seite oder tippe {shortcut}.',
  'panel.noHeadings': 'Noch keine Überschriften. Tippe {shortcut} am Zeilenanfang.',
  'panel.noTasks': 'Noch keine Aufgaben. Tippe {shortcut} am Zeilenanfang.',
  'panel.kind': 'Art',
  'panel.tags': 'Schlagwörter',
  'panel.openForFiles': 'Eine Seite öffnen, um ihre Dateien zu sehen.',
  'panel.openForImages': 'Eine Seite öffnen, um ihre Bilder zu sehen.',
  'panel.openForLinks': 'Eine Seite öffnen, um ihre Links zu sehen.',
  'panel.openForOutline': 'Eine Seite öffnen, um ihre Gliederung zu sehen.',
  'panel.openForProperties': 'Eine Seite öffnen, um ihre Eigenschaften zu sehen.',
  'panel.openForTasks': 'Eine Seite öffnen, um ihre Aufgaben zu sehen.',

  // --- die Regeln einer Ansicht ------------------------------------------
  'view.rules': 'Regeln der Ansicht',
  'view.rowHeight': 'Zeilenhöhe',
  'view.rowHeight.compact': 'Kompakt',
  'view.rowHeight.normal': 'Normal',
  'view.rowHeight.tall': 'Hoch',
  'view.sort': 'Sortierung',
  'view.sort.none': 'Nicht sortiert',
  'view.sort.by': 'Sortieren nach',
  'view.sort.direction': 'Richtung',
  'view.sort.ascending': 'Aufsteigend',
  'view.sort.descending': 'Absteigend',
  'view.filters': 'Filter',
  'view.filters.none': 'Alle Einträge werden gezeigt.',
  'view.filter.column': 'Spalte',
  'view.filter.condition': 'Bedingung',
  'view.filter.value': 'Wert',
  'view.filter.remove': 'Diesen Filter entfernen',
  'view.filter.add': 'Filter hinzufügen',
  'view.noColumns': 'Erst eine Spalte anlegen — es gibt noch nichts zum Filtern oder Sortieren.',
  'action.close': 'Schließen',
  'action.apply': 'Übernehmen',

  // --- Symbol und Farbe wählen -------------------------------------------
  'icon.heading': 'Symbol',
  'icon.search': 'Symbole suchen',
  'icon.default': 'Standardsymbol',
  'icon.colour': 'Symbolfarbe',
  'icon.nameColour': 'Namensfarbe',
  'icon.ownColour': 'Eine eigene Farbe',

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
