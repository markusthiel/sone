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
  'sidebar.folders': 'Ordner',
  'sidebar.emptyFolders': 'Noch keine Ordner. Drücke +, um einen anzulegen.',
  'sidebar.newFolder': 'Neuer Ordner',
  'sidebar.empty': 'Noch keine Seiten.',
  'sidebar.rename': 'Umbenennen',
  'sidebar.newPageIn': 'Neue Seite in {title}',
  'sidebar.addIn': 'Etwas in {title} anlegen',
  'sidebar.removeFavourite': '{title} entfernen',

  // --- das Menü eines Eintrags -------------------------------------------
  'entry.menu': 'Mehr zu {title}',
  'entry.rename': 'Umbenennen',
  'entry.icon': 'Symbol und Farbe',
  'entry.favourite': 'Zu Favoriten hinzufügen',
  'entry.unfavourite': 'Aus Favoriten entfernen',
  'entry.share': 'Teilen…',
  'entry.move': 'Verschieben nach…',
  'entry.export': 'Exportieren\u2026',
  'share.heading': '„{title}“ teilen',
  'file.pdfAllPages': 'Original öffnen',
  'file.pdfPageOf': 'Seite {page} von {total}',
  'file.pdfLoading': 'Dokument wird geöffnet\u2026',
  'file.pdfFailed': 'Dieses Dokument kann hier nicht gezeigt werden.',
  'workspace.export': 'Diesen Workspace exportieren',
  'workspace.export.hint':
    'Jede lesbare Seite als Markdown-Dateien mit ihren Anhängen, in einem ' +
    'Archiv. Es wird im Hintergrund gepackt; diese Seite muss dabei nicht ' +
    'offen bleiben.',
  'workspace.export.start': 'Ein Archiv vorbereiten',
  'workspace.export.rights':
    'Ein Archiv enthält, was im Moment des Packens lesbar ist. Ändert sich der ' +
    'Zugang dazwischen, enthält es weniger \u2014 nie mehr.',
  'workspace.export.waiting': 'Wartet auf den Start\u2026',
  'workspace.export.ready': '{pages} Seiten, {size}',
  'workspace.export.until': 'verfügbar bis {when}',
  'workspace.export.failed': 'Es ist nicht fertig geworden.',
  'import.title': 'Importieren',
  'import.where': 'Nach {title}.',
  'import.reading': 'Archiv wird gelesen\u2026',
  'import.summary': 'Es würden {pages} Seiten und {folders} Ordner angelegt.',
  'import.exists': 'schon da',
  'import.duplicate': 'Die {count} schon vorhandenen ein zweites Mal anlegen',
  'import.noOverwrite':
    'Nichts Vorhandenes wird ersetzt. Ohne dies bleibt eine Seite, deren Name ' +
    'schon da ist, unberührt, und die Fassung aus dem Archiv kommt nicht mit.',
  'import.skipped': '{count} Dateien kommen nicht mit',
  'import.attachments':
    '{count} Dateien kommen mit. Eine Datei, deren Art nicht erkennbar ist, ' +
    'bleibt weg, und das Bild dazu wird als fehlend gezeigt.',
  'import.attachmentsNotYet':
    'Die {count} Dateien in diesem Archiv werden noch nicht importiert, und ' +
    'die Links darauf zeigen ins Leere.',
  'import.confirm': 'Importieren',
  'import.working': 'Wird importiert\u2026',
  'import.done': '{count} Seiten angelegt.',
  'import.wereSkipped': 'Unberührt gelassen, weil der Name schon da war: {paths}',
  'entry.import': 'Importieren\u2026',
  'export.title': 'Exportieren',
  'export.what': '{title} und alles darin, als Markdown-Dateien in einem Archiv.',
  'export.withAttachments': 'Dateien und Bilder mitnehmen',
  'export.attachmentsNote':
    'Ohne sie ist das Archiv klein genug für eine E-Mail, und die Links darin ' +
    'zeigen auf Dateien, die nicht dabei sind.',
  'export.download': 'Herunterladen',
  'entry.moveToWorkspace': 'In einen Workspace…',
  'template.heading': 'Aus einer Vorlage',
  'template.use': 'Als Vorlage anbieten',
  'template.stop': 'Nicht mehr als Vorlage anbieten',
  'entry.untitled': 'Ohne Titel',
  'entry.actions': 'Was mit diesem Eintrag geschehen soll',
  'entry.new': 'Neu',
  'entry.newPage': 'Neue Seite',
  'entry.newFolder': 'Neuer Ordner',
  'entry.moveUp': 'Nach oben',
  'entry.moveDown': 'Nach unten',
  'groups.confirmDelete':
    '{name} hat Zugriff auf Seiten erhalten. Trotzdem löschen?',
  'entry.confirmTrash': 'Das hier in den Papierkorb legen?',
  'entry.confirmTrashWithChildren':
    'Das hier in den Papierkorb legen, mit {count, plural, one {# Eintrag} other {# Einträgen}} darin?',
  'entry.delete': 'Papierkorb',
  // Der Zähler bleibt: er entscheidet, ob jemand die Bestätigung überhaupt
  // öffnet. Das Verb geht — das Symbol daneben sagt es schon.
  'entry.deleteWithChildren':
    'Papierkorb, {count, plural, one {# Eintrag} other {# Einträge}}',

  // --- der Verwaltungsbereich --------------------------------------------
  'admin.instance': 'Diese Instanz',
  'admin.instance.hint': 'Name, Registrierung und Vorgaben',
  'admin.accounts': 'Konten',
  'admin.accounts.hint': 'Alle, die hier ein Konto haben',
  'admin.accounts.note':
    'Deaktivieren behält das Konto und seine Arbeit und meldet es sofort ab. Konten ' +
    'werden hier nie gelöscht: eines zu entfernen nähme jede Seite mit, die es angelegt ' +
    'hat — und „diese Person ist gegangen" ist nicht „ihre Arbeit hat nie stattgefunden".',
  'admin.workspaces': 'Alle Workspaces',
  'admin.workspaces.hint': 'Jeder Workspace hier, und wer darin ist',
  'admin.invitations': 'Einladungen',
  'admin.invitations.hint': 'Ein Konto und ein eigener Workspace — kein Team',
  'admin.sso': 'Single Sign-on',
  'admin.sso.hint': 'Anmeldung über einen Identitätsanbieter',
  'admin.maintenance': 'Wartung',
  'admin.maintenance.hint': 'Speicher, Aufgaben und Gesundheit',

  'admin.settings': 'Einstellungen',
  'admin.settings.note':
    'Diese liegen in der Datenbank und wirken sofort. Alles, was vor dem Öffnen der ' +
    'Datenbank gebraucht wird — deren Adresse, der geheime Schlüssel, der Port — bleibt ' +
    'in der Umgebung: ein Server, der nicht starten kann, lässt sich nicht über einen ' +
    'Bildschirm konfigurieren, den er nie zeigt.',
  'admin.mayCreateWorkspaces.hint':
    'Aus heißt: nur Administratoren legen welche an. Seinen persönlichen behält so oder ' +
    'so jeder — der ist kein Team.',
  'admin.sizesOnly':
    'Nur Größen. Die Instanz zu verwalten heißt nicht, lesen zu dürfen, was in einem ' +
    'Workspace steht — dafür braucht es eine Mitgliedschaft, und die ist eine ' +
    'Entscheidung von jemandem, kein Knopf hier.',
  'admin.maintenance.run': 'Wartung jetzt ausführen',
  'admin.maintenance.running': 'Läuft…',
  'admin.maintenance.note':
    'Dieser Durchgang läuft von selbst alle paar Minuten. Der Knopf ist für den Fall, ' +
    'dass Warten nicht in Frage kommt — meist, nachdem behoben wurde, woran eine ' +
    'Projektion gescheitert ist.',
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
  'admin.anomaly.orphaned': 'Einträge ohne Eltern',
  'admin.anomaly.orphaned.explain':
    'Ein Elternteil, das noch nicht angekommen ist. Während des Abgleichs vorübergehend; ' +
    'ein bleibender Zähler heißt: eine Seite, deren Ordner nie angelegt wurde.',
  'admin.anomaly.nested': 'Einträge in Seiten',
  'admin.anomaly.nested.explain':
    'Nur Ordner dürfen Kinder halten. Die API weigert sich, solche anzulegen — ein ' +
    'Zähler hier heißt, ein Client hat direkt geschrieben.',
  'admin.anomaly.staleSearch': 'Veraltete Suchzeilen',
  'admin.anomaly.staleSearch.explain':
    'Mit einer älteren Textkonfiguration indexiert. Die betroffenen Workspaces neu ' +
    'materialisieren.',
  'admin.anomaly.failed': 'Gescheiterte Projektionen',
  'admin.anomaly.failed.explain':
    'Ein Dokument, das die Projektion nicht lesen konnte. Die Seite existiert weiter und ' +
    'gleicht ab; sie fehlt in der Suche und im Baum.',
  'admin.uploadsUnwritable': 'Uploads können nicht auf die Platte geschrieben werden',
  'admin.storage.fix':
    'Der Container läuft als uid 10001 und kann das nicht selbst ändern. Vom Host aus, ' +
    'als root im laufenden Container:',
  'admin.storage.volumeWarning':
    'Den Container ansprechen, nicht das Volume. Ein falsch geratener Volume-Name wird ' +
    'leer angelegt statt als fehlend gemeldet — der Befehl sieht also aus, als hätte er ' +
    'funktioniert, und nichts ändert sich.',
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
  'you.email.hint':
    'Identifiziert das Konto beim Anmelden. Sie zu ändern braucht einen Weg, die neue ' +
    'Adresse als eigene zu belegen — den hat diese Instanz noch nicht.',
  'you.workspace': 'Workspace',
  'you.workspace.hint':
    'Wo {address, select, formal {Sie gerade sind} other {du gerade bist}}.',
  'you.saved': 'Gespeichert.',
  'you.save': 'Speichern',
  'you.passwordChanged':
    'Geändert. {address, select, formal {Ihre anderen Sitzungen bleiben angemeldet.} ' +
    'other {Deine anderen Sitzungen bleiben angemeldet.}}',
  'action.reload': 'Neu laden',

  'you.currentPassword': 'Aktuelles Passwort',
  'you.currentPassword.hint':
    'Wird verlangt, weil eine offen gelassene Sitzung an einem gemeinsam benutzten ' +
    'Rechner der übliche Weg ist, auf dem ein Konto abhandenkommt.',
  'you.newPassword': 'Neues Passwort',

  'you.language': 'Sprache',
  'you.language.hint':
    'Anders als die Größen darunter folgt das {address, select, formal {Ihrem Konto} ' +
    'other {deinem Konto}} und nicht diesem Browser — es ist {address, select, ' +
    'formal {Ihre Sprache} other {deine Sprache}}, wo immer {address, select, ' +
    'formal {Sie sich anmelden} other {du dich anmeldest}}.',
  'you.language.system': 'Wie der Browser',
  'you.appearance.note':
    'In diesem Browser gespeichert. Eine Schriftgröße, die auf einem Telefon passt, ' +
    'ist auf einem großen Bildschirm falsch — deshalb folgen diese nicht dem Konto ' +
    'von Gerät zu Gerät.',
  'you.theme': 'Erscheinungsbild',
  'you.theme.hint':
    'Dem System zu folgen ist die Vorgabe. Eines wählen überschreibt das — wer draußen ' +
    'in der Sonne sitzt, will hell, was das Gerät auch denkt.',
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

  // --- der Rest der Oberfläche -------------------------------------------
  'invitation.title': 'Einladung',
  'action.continue': 'Weiter',
  'action.notNow': 'Jetzt nicht',
  'invitation.alreadyMember':
    '{address, select, formal {Sie haben} other {Du hast}} hier schon ein Konto — diese ' +
    'Einladung fügt nichts hinzu.',
  'page.title': 'Seitentitel',
  'page.untitled': 'Ohne Titel',
  'page.readOnly':
    '{address, select, formal {Sie können} other {Du kannst}} diese Seite nur lesen.',
  'page.noAccess':
    '{address, select, formal {Sie haben} other {Du hast}} keinen Zugriff mehr auf diese Seite.',
  'error.technicalDetail': 'Technische Details',
  'option.name': 'Name der Option',
  'option.options': 'Optionen',
  'option.none': 'Noch keine Optionen. Eine anlegen, dann in einer Zelle wählen.',
  'option.add': 'Option hinzufügen',
  'format.label': 'Formatierung',
  // Die Tastenkürzel-Schreibweise bleibt: „Mod" ist Strg oder Cmd, je nach
  // Gerät, und dafür gibt es kein deutsches Wort, das kürzer wäre.
  'format.link': 'Link (Mod-K)',
  'format.linkAddress': 'Adresse des Links',
  'format.linkPlaceholder': 'example.org',
  'format.copyCode': 'Code kopieren',
  'format.linkWord': 'Link',
  'format.bold': 'Fett (Mod-B)',
  'format.italic': 'Kursiv (Mod-I)',
  'format.strikethrough': 'Durchgestrichen',
  'format.code': 'Code (Mod-E)',
  'format.removeLink': 'Entfernen',
  'slash.insert': 'Block einfügen',
  'tableBlock.label': 'Tabelle',
  'tableBlock.addRow': '+ Zeile',
  'tableBlock.addRow.title': 'Zeile darunter einfügen',
  'tableBlock.addColumn': '+ Spalte',
  'tableBlock.addColumn.title': 'Spalte rechts einfügen',
  'tableBlock.header': 'Kopfzeile',
  'tableBlock.header.title': 'Kopfzeile umschalten',
  'tableBlock.removeRow': '− Zeile',
  'tableBlock.removeRow.title': 'Diese Zeile löschen',
  'tableBlock.removeColumn': '− Spalte',
  'tableBlock.removeColumn.title': 'Diese Spalte löschen',
  'video.add': 'Video hinzufügen',
  'video.address': 'Adresse des Videos',
  'video.addressPlaceholder': 'https://…',
  'video.orPaste': 'oder eine Adresse einfügen',
  'video.upload': 'Video hochladen',
  'gallery.empty': 'Noch nichts hier.',
  'workspaces.shared': 'Geteilte Workspaces',
  'workspaces.personal': 'Persönliche Workspaces',
  'workspaces.nonePersonal':
    'Noch keine — jeder Workspace hier gehört einer Person.',
  'workspaces.name': 'Name',
  'workspaces.people': 'Leute',
  'workspaces.pages': 'Seiten',
  'workspaces.lastEdited': 'Zuletzt bearbeitet',
  'workspaces.appearance': 'Aussehen',
  'workspaces.delete': 'Diesen Workspace löschen',
  'workspaces.confirmName': 'Zum Bestätigen den Namen eintippen',
  'workspaces.nameField': 'Name des Workspace',
  'workspaces.new': 'Neuer Workspace',
  'workspaces.settings': 'Workspace-Einstellungen',
  'workspaces.all': 'Alle Workspaces',

  // --- die längeren Erklärungen ------------------------------------------
  'landing.note':
    'Beim Anmelden, beim Wechsel in diesen Workspace, oder wenn SONE ohne eine bestimmte ' +
    'Seite im Sinn geöffnet wird.',
  'landing.gone':
    'Wird sie einmal gelöscht oder ist sie nicht mehr zugänglich, öffnet SONE die erste ' +
    'statt sich zu weigern.',
  'folder.empty':
    'Dieser Ordner ist leer. Eine Seite hinzufügen, um zu schreiben — oder einen Ordner, ' +
    'um weiter zu sortieren.',
  'invite.instance.note':
    'Jemanden auf diese Instanz einladen. Er bekommt ein Konto und einen eigenen ' +
    'Workspace — sonst nichts. Ihn in ein Team aufzunehmen ist ein eigener Schritt, den ' +
    'macht, wer dieses Team führt.',
  'invite.address.note':
    'Optional. Mit Adresse gilt die Einladung für diese Person und lässt sich einmal ' +
    'benutzen. Ohne Adresse ist sie ein Link, den jeder benutzen darf, der ihn hat — so ' +
    'lädt man eine Gruppe ein, ohne jede Adresse zu tippen.',
  'invite.workspace.note':
    'Funktioniert, ob die Person schon ein Konto hat oder nicht. Mit Konto fragt der Link ' +
    'nach dem Beitritt und ihr eigener Workspace bleibt unberührt. Ohne Konto registriert ' +
    'sie sich zuerst und landet in beiden.',
  'invite.workspace.address':
    'Mit einer Adresse gilt die Einladung für diese Person und lässt sich einmal ' +
    'benutzen — und nur sie kann sie annehmen, selbst wenn jemand anderes den Link öffnet.',
  'group.note':
    'Eine Gruppe ist eine Liste von Leuten. Gib einer Gruppe einmal Zugriff auf eine ' +
    'Seite, und jeder darin hat ihn — auch wer später dazukommt. Das ist es, was das ' +
    'Pflegen dieser Listen lohnend macht.',
  'group.name.note':
    'Ein Name für eine Gruppe von Leuten. Wer später beitritt, bekommt alles, was der ' +
    'Gruppe gegeben wurde, ohne dass jemand die Seiten noch einmal anfassen muss.',
  'oidc.note':
    'Anmeldung über einen Identitätsanbieter. Jeder Anbieter, der OpenID Connect ' +
    'spricht, funktioniert — Keycloak, Authentik, Zitadel, Entra, Google und andere. Das ' +
    'ist also eine Konfiguration und keine Wahl der Anbindung.',
  'oidc.buttonLabel.hint':
    'Was auf der Anmeldeseite steht. Leute erkennen ihren eigenen Login am Namen, nicht ' +
    'am Protokoll dahinter.',
  'oidc.allowSignup.hint':
    'Standardmäßig aus. Einem Anbieter zu glauben, wer jemand ist, verpflichtet nicht ' +
    'dazu, jeden von dort hereinzulassen.',
  'invitation.used':
    'Diese Einladung wurde schon benutzt. Wenn das gerade {address, select, formal ' +
    '{Sie waren, ist Ihr Konto} other {du warst, ist dein Konto}} fertig.',
  'invitation.keepsYours':
    'Der eigene Workspace bleibt, wo er ist. Ein Beitritt stellt diesen daneben.',
  'option.rename.note':
    'Eine Option lässt sich frei umbenennen — die Einträge behalten sie. Eine zu ' +
    'entfernen verbirgt sie in den Einträgen, die sie benutzen, und eine neue Option mit ' +
    'demselben Namen bringt sie nicht zurück.',
  'video.providers':
    'Diese Instanz bettet YouTube, Vimeo und PeerTube ein und spielt HLS- oder ' +
    'DASH-Streams. Andere Adressen können als gewöhnlicher Link in die Seite.',
  'workspaces.delete.note':
    'Er verschwindet für alle, die darin sind. Noch wird nichts entfernt, und wer ' +
    'Workspaces verwaltet, kann ihn zurückholen.',

  // --- Einladungen -------------------------------------------------------
  'invite.email': 'E-Mail-Adresse',
  'invite.emailPlaceholder': 'jemand@example.org',
  'invite.link': 'Einladungslink',
  'invite.here': 'Jemanden hierher einladen',
  'invite.joinAs': 'Tritt bei als',
  'invite.outstanding': 'Offene Einladungen',
  'invite.anybodyWithLink': 'Jeder mit dem Link',
  'invite.role': 'Rolle',
  'invite.expires': 'Läuft ab',
  'invite.used': 'Benutzt',
  'invite.withdraw': 'Zurückziehen',

  // --- Gruppen und Seitenrechte ------------------------------------------
  'group.new': 'Neue Gruppe',
  // Ein Beispielname, kein Wort zum Übersetzen — und im Deutschen heißt die
  // Rolle „Bearbeiter", also steht das hier auch.
  'group.namePlaceholder': 'Bearbeiter',
  'group.addSomebody': 'Jemanden hinzufügen',
  'group.choosePerson': 'Eine Person wählen…',
  'group.nobody': 'Noch niemand.',
  'group.create': 'Anlegen',
  'group.delete': 'Löschen',
  'group.remove': 'Entfernen',
  'perm.people': 'Leute',
  'perm.peopleHere': 'Leute in diesem Workspace',
  'perm.groups': 'Gruppen',
  'perm.addGroup': 'Gruppe hinzufügen',
  'perm.chooseGroup': 'Eine Gruppe wählen…',
  'perm.checking': 'Wird geprüft…',
  'perm.onlyAdded': 'Nur die unten hinzugefügten Leute',
  'perm.remove': 'Entfernen',

  // --- Single Sign-on ----------------------------------------------------
  // Die Feldnamen bleiben, wie der Anbieter sie nennt: „Issuer" und „Client ID"
  // stehen so in jeder Konfigurationsoberfläche, und übersetzt findet sie
  // niemand wieder.
  'oidc.issuer': 'Issuer',
  'oidc.issuerPlaceholder': 'https://login.example.org/realms/main',
  'oidc.clientId': 'Client ID',
  'oidc.buttonLabel': 'Text auf dem Knopf',
  'oidc.asRegistered': 'So, wie beim Anbieter eingetragen.',
  'oidc.showButton': 'Den Knopf auf der Anmeldeseite zeigen',
  'oidc.allowSignup':
    'Leute ohne Konto hier dürfen sich über den Anbieter registrieren',

  // --- wer in einem Workspace ist ----------------------------------------
  'member.name': 'Name',
  'member.role': 'Rolle',
  'member.since': 'Seit',
  'member.remove': 'Entfernen',

  // --- Schlagwörter ------------------------------------------------------
  'tag.add': 'Schlagwort hinzufügen',
  'tag.none': 'Keine',

  // --- eine Seite teilen -------------------------------------------------
  'share.label': 'Teilen',
  'share.anyoneWithLink': 'Jeder mit dem Link',
  'share.notShared': 'Diese Seite ist nicht geteilt.',
  'share.existing': 'Bestehende Links',
  'share.new': 'Neuer Link',
  'share.allows': 'Was er erlaubt',
  'share.expires': 'Läuft ab',
  'share.never': 'Nie',
  'share.inADay': 'In einem Tag',
  'share.inAWeek': 'In einer Woche',
  'share.inAMonth': 'In einem Monat',
  'share.inAYear': 'In einem Jahr',
  'share.created':
    'Der neue Link. {address, select, formal {Sie können ihn} other {Du kannst ihn}} ' +
    'unten jederzeit wieder kopieren.',
  'share.create': 'Link erstellen',
  'share.revoke': 'Widerrufen',
  'share.subpages.hint':
    'Standardmäßig an: ein Link, der aufhört zu funktionieren, sobald jemand eine ' +
    'Unterseite anlegt, ist schlechter als einer, der etwas mehr abdeckt als erwartet.',
  'share.tooOld':
    'Dieser Link entstand, bevor Links wieder angezeigt werden konnten — er lässt sich ' +
    'nicht kopieren. Widerrufen und einen neuen erstellen.',
  'share.revoke.hint':
    'Ein Widerruf wirkt sofort, auch für jemanden, der in diesem Moment über den Link ' +
    'liest. Kopieren kann einen Link jeder, der diese Seite verwaltet — dasselbe Recht, ' +
    'das es zum Erstellen braucht, es wird also nichts Neues offengelegt. Gespeichert ' +
    'wird er verschlüsselt, und der Schlüssel steht nicht in der Datenbank.',
  'action.done': 'Fertig',

  // --- die Typografie eines Workspace ------------------------------------
  'type.note':
    'Vorgaben für diesen Workspace. Ein Block, der eine eigene Größe oder Farbe trägt, ' +
    'behält sie — diese gelten, wo niemand gewählt hat.',
  'type.palette.note':
    'Wie jeder Farbname hier aussieht. Alles, was einen Namen benutzt — Schlagwörter, ' +
    'Spalten, Blöcke, Ordnersymbole — folgt dem.',
  'type.element': 'Element',
  'type.elements': 'Elemente',
  'type.palette': 'Palette',
  'type.size': 'Größe',
  'type.colour': 'Farbe',
  'type.spaceAbove': 'Abstand oben',
  'type.spaceBelow': 'Abstand unten',
  'type.asDesigned': 'Wie entworfen',

  // --- womit ein Workspace öffnet ----------------------------------------
  'landing.title': 'Wo {address, select, formal {Sie landen} other {du landest}}',
  'landing.lastPage':
    'Die Seite, auf der {address, select, formal {Sie zuletzt waren} other {du zuletzt warst}}',
  'landing.lastPage.hint':
    'Folgt {address, select, formal {Ihnen} other {dir}}: was in diesem Workspace zuletzt ' +
    'offen war.',
  'landing.fixedPage': 'Eine bestimmte Seite',
  'landing.fixedPage.hint':
    'Immer dieselbe, egal was {address, select, formal {Sie gerade taten} other {du gerade getan hast}}.',
  'landing.page': 'Seite',
  'landing.choose': 'Eine Seite wählen…',

  // --- das Zeichen eines Workspace ---------------------------------------
  'mark.icon': 'Symbol',
  'mark.none': 'Kein Symbol',
  'mark.iconColour': 'Symbolfarbe',
  'mark.nameColour': 'Namensfarbe',

  // --- ein Ordner --------------------------------------------------------
  'folder.name': 'Name des Ordners',
  'folder.untitled': 'Ordner ohne Namen',
  'folder.location': 'Ort',
  'folder.folders': 'Ordner',
  'folder.pages': 'Seiten',

  // --- innerhalb eines Workspace verschieben -----------------------------
  'move.title': 'Verschieben nach',
  'move.root': 'Wurzel des Workspace',
  'move.find': 'Ordner suchen',
  'move.noMatch': 'Kein Ordner passt.',

  'action.saved': 'Gespeichert.',

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

  // --- eine Tabelle mit Einträgen ----------------------------------------
  'table.views': 'Ansichten',
  'table.search': 'In dieser Sammlung suchen',
  'table.searchPlaceholder': 'Diese Einträge durchsuchen',
  'table.filterAndSort': 'Filtern und sortieren',
  'table.filterAndSort.title': 'Diese Ansicht filtern und sortieren',
  'table.rules': '{filters, plural, =0 {} one {# Filter} other {# Filter}}{sorted, select, yes {{filters, plural, =0 {sortiert} other {, sortiert}}} other {}}',
  'table.empty': 'Leeren',
  'table.addBoard': 'Board',
  'table.addGallery': 'Galerie',
  'table.addGallery.title': 'Diese Einträge als Karten zeigen',
  'table.newEntry': 'Neuer Eintrag',
  'table.noEntries': 'Noch keine Einträge.',
  'table.loading': 'Wird geladen…',
  'table.addColumn': 'Spalte hinzufügen',
  'field.text': 'Text',
  'field.select': 'Auswahl',
  'field.multiSelect': 'Mehrfachauswahl',
  'field.number': 'Zahl',
  'field.date': 'Datum',
  'field.checkbox': 'Kontrollkästchen',
  'field.url': 'Link',
  'field.email': 'E-Mail',
  'field.phone': 'Telefon',
  'field.files': 'Dateien',
  'table.titleColumn': 'Jeder Eintrag hat einen Titel',
  'table.name': 'Name',
  'table.untitled': 'Ohne Titel',
  'table.removedOption': 'Diese Option wurde entfernt',
  'table.selected': '{count, plural, one {# ausgewählt} other {# ausgewählt}}',
  'table.selectedLabel': 'Ausgewählte Einträge',
  'table.copy': 'Kopieren',
  'table.exportCsv': 'Als CSV exportieren',
  'table.toTrash': 'In den Papierkorb',
  'table.clearSelection': 'Aufheben',
  'table.undo': 'Rückgängig: {action}',
  'table.redo': 'Wiederholen: {action}',
  'table.nothingToUndo': 'Nichts zum Rückgängigmachen',
  'table.nothingToRedo': 'Nichts zum Wiederholen',
  'undo.rename': 'einen Eintrag umbenennen',
  'undo.paste':
    '{count, plural, one {einen Eintrag einfügen} other {# Einträge einfügen}}',
  'undo.empty':
    '{count, plural, one {Tabelle leeren (# Eintrag)} other {Tabelle leeren (# Einträge)}}',
  'undo.archive':
    '{count, plural, one {einen Eintrag in den Papierkorb} other {# Einträge in den Papierkorb}}',
  'table.boardNeedsSelect':
    'Ein Board braucht eine Auswahlspalte mit Optionen. Erst eine anlegen, dann noch einmal.',
  // Steht neben der Titelspalte: sie ist immer da und lässt sich nicht entfernen.
  'table.always': 'immer',
  'table.emptyConfirm': 'Tabelle leeren',
  'table.emptyKeep': 'Behalten',
  'table.noOptions': 'Keine Optionen — in der Spaltenüberschrift welche anlegen',

  // --- die Aktionen einer Tabelle im Gutter-Menü -------------------------
  'tableAction.row-before': 'Zeile darüber einfügen',
  'tableAction.row-after': 'Zeile darunter einfügen',
  'tableAction.column-before': 'Spalte links einfügen',
  'tableAction.column-after': 'Spalte rechts einfügen',
  'tableAction.toggle-header-row': 'Kopfzeile umschalten',
  'tableAction.toggle-header-column': 'Kopfspalte umschalten',
  'tableAction.merge': 'Zellen verbinden',
  'tableAction.split': 'Zelle teilen',
  'tableAction.delete-row': 'Zeile löschen',
  'tableAction.delete-column': 'Spalte löschen',
  'tableAction.delete-table': 'Tabelle löschen',

  // --- was eine Rolle darf ----------------------------------------------
  'role.member': 'Mitglied',
  'role.member.hint': 'Darf alles lesen und schreiben, was nicht beschränkt ist',
  'role.admin': 'Admin',
  'role.admin.hint': 'Darf außerdem Leute und Rechte verwalten',
  'role.guest': 'Gast',
  'role.guest.hint': 'Sieht nur, worauf ausdrücklich Zugriff gegeben wurde',
  'role.owner': 'Besitzer',
  'access.viewer': 'Darf lesen',
  'access.commenter': 'Darf lesen und kommentieren',
  'access.editor': 'Darf bearbeiten',
  'access.admin': 'Darf verwalten',
  'access.from': '{level} · über {source}',

  // --- das Block-Menü ----------------------------------------------------
  'block.insert': 'Block einfügen',
  'block.nesting': 'Verschachtelung',
  'block.appearance': 'Darstellung',
  'block.width': 'Breite',
  'block.alignment': 'Ausrichtung',
  'block.colour': 'Farbe',
  'block.defaultColour': 'Standardfarbe',
  'block.showAs': 'Zeigen als',
  'block.turnInto': 'Umwandeln in',
  'block.file': 'Datei',
  'block.table': 'Tabelle',
  'block.video': 'Video',
  'block.align.auto': 'Automatisch',
  'block.align.left': 'Links',
  'block.align.centre': 'Mittig',
  'block.align.right': 'Rechts',
  'block.width.column': 'Spalte',
  'block.width.wide': 'Weit',
  'block.width.full': 'Ganze Seite',
  'block.display.card': 'Karte',
  'block.display.line': 'Eine Zeile',
  'block.display.viewer': 'Betrachter',
  'block.display.player': 'Player',
  'block.display.image': 'Bild',
  'block.display.link': 'Link',
  'block.actions': 'Was mit diesem Block geschehen soll',
  'block.moveUp': 'Nach oben',
  'block.moveDown': 'Nach unten',
  'block.outdent': 'Ausrücken',
  'block.indent': 'Einrücken',
  'block.duplicate': 'Duplizieren',
  'block.delete': 'Löschen',
  'block.heading': 'Überschrift',
  'block.openInNewTab': 'In neuem Tab öffnen',
  'block.download': 'Herunterladen',
  // Bei einem Bild gibt es zwei Fassungen: die verkleinerte und die, die
  // hochgeladen wurde (ADR-0029).
  'block.downloadOriginal': 'Original herunterladen',
  'block.openWhereItLives': 'Am Ursprungsort öffnen',

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
  'panel.hide': 'Seitenleiste ausblenden',
  'panel.show': 'Seitenleiste einblenden',
  'panel.outline': 'Gliederung',
  'panel.tasks': 'Aufgaben',
  'panel.files': 'Dateien',
  'panel.images': 'Bilder',
  'panel.links': 'Links',
  'panel.people': 'Leute',
  'panel.properties': 'Eigenschaften',
  'panel.tasksOpen': '{open} von {total} offen',
  'panel.comments': 'Kommentare',
  'panel.history': 'Verlauf',
  'history.none': 'Von dieser Seite sind noch keine früheren Fassungen aufbewahrt.',
  'history.viewing': 'So stand die Seite am {when}.',
  'history.backToNow': 'Zurück zum Jetzt',
  'history.restore': 'Die Seite wieder so lesen lassen',
  'history.restoreMeans':
    'Das ist eine Änderung, kein Zurückspulen: die Seite liest sich wieder so, ' +
    'alles seitdem bleibt in der Liste, und diese Wiederherstellung wird selbst ' +
    'eine Fassung. Kommentare bleiben unberührt.',
  'history.wasRestore': 'eine Wiederherstellung',
  'history.wasEmpty': 'Die Seite war leer.',
  'history.retention':
    'Fassungen werden {days} Tage aufbewahrt: jede vom letzten Tag, eine pro ' +
    'Stunde für eine Woche, danach eine pro Tag.',
  'history.incomplete':
    'Diese Liste beginnt, als die Seite anfing, Fassungen aufzubewahren. Was ' +
    'älter ist, wurde nicht aufgezeichnet und ist nicht wiederherstellbar.',
  'comment.none': 'Noch nichts kommentiert. Markiere ein paar Worte und drücke Kommentieren.',
  'comment.open': 'Offen',
  'comment.detachedHeading': 'Text ist weg',
  'comment.resolvedHeading': 'Gelöst',
  'comment.detached': 'Der Text, um den es ging, wurde gelöscht.',
  'comment.reveal': 'Im Dokument zeigen',
  'comment.replyPlaceholder': 'Antworten\u2026',
  'comment.resolve': 'Lösen',
  'comment.reopen': 'Wieder öffnen',
  'comment.reply': 'Antworten',
  'comment.removeThread': 'Den ganzen Verlauf löschen',
  'comment.removeMessage': 'Diese Nachricht löschen',
  'comment.unknownAuthor': 'Jemand, der nicht mehr dabei ist',
  'comment.collapse': 'Diesen Verlauf zuklappen',
  'comment.expand': 'Diesen Verlauf öffnen',
  'comment.collapseAll': 'Alle zuklappen',
  'comment.expandAll': 'Alle öffnen',
  'comment.markStyle': 'Wie sie markiert werden',
  'comment.mark.highlight': 'Farbig hinterlegt',
  'comment.mark.underline': 'Unterstrichen',
  'comment.mark.off': 'Gar nicht',
  'comment.start': 'Kommentieren',
  'comment.startPlaceholder': 'Was ist damit?',
  'panel.guest': 'Gast',
  'panel.guestWriting':
    'Ein Teil davon entstand, bevor diese Seite mitgeschrieben hat — oder von ' +
    'jemandem, der gar keinen Namen angegeben hat.',
  'panel.noPeople':
    'Noch niemand verzeichnet. Geschriebenes wird von dem Moment an zugeordnet, in dem ' +
    'es geschrieben wird — was vor Beginn dieser Aufzeichnung getippt wurde, steht hier ' +
    'nicht.',
  // --- eine Fläche (ADR-0043) ---------------------------------------------
  'canvas.tools': 'Werkzeuge',
  'canvas.tool.select': 'Auswählen',
  'canvas.tool.hand': 'Blatt verschieben',
  'canvas.tool.pen': 'Stift',
  'canvas.tool.text': 'Text',
  'canvas.remove': 'Das hier entfernen',
  'canvas.handle': 'Was damit geschehen soll',
  'canvas.duplicate': 'Duplizieren',
  'canvas.lock': 'Festsetzen',
  'canvas.unlock': 'Lösen',
  'canvas.toFront': 'Nach vorn holen',
  'canvas.textItem': 'Text auf der Fläche',
  'canvas.resize': 'Größe ändern',
  'canvas.colour': 'Farbe des Stifts',
  'canvas.colour.default': 'Die des Themes',
  'canvas.colour.own': 'Eine eigene Farbe',
  'canvas.thickness': 'Stärke',
  'canvas.tool.erase': 'Radierer',
  'canvas.tool.rect': 'Rechteck',
  'canvas.tool.ellipse': 'Ellipse',
  'canvas.tool.line': 'Linie',
  'canvas.image': 'Bild',
  'canvas.background': 'Linierung',
  'canvas.background.dots': 'Gepunktet',
  'canvas.background.squares': 'Kariert',
  'canvas.background.lines': 'Liniert',
  'canvas.background.plain': 'Blank',
  'canvas.undo': 'Rückgängig',
  'canvas.redo': 'Wiederholen',
  'canvas.zoomIn': 'Näher heran',
  'canvas.zoomOut': 'Weiter weg',
  'canvas.zoomReset': 'Zurück auf Originalgröße',
  'canvas.new': 'Neue Fläche',
  'panel.kind.canvas': 'Fläche',

  'panel.width': 'Breite',
  'panel.width.column': 'Spalte',
  'panel.width.full': 'Ganze Seite',
  'panel.kind.page': 'Seite',
  'panel.kind.folder': 'Ordner',
  'panel.sync.upToDate': 'aktuell',
  'panel.sync.syncing': 'wird abgeglichen',
  'panel.sync.offline': 'offline — Änderungen bleiben lokal',
  'panel.sync.denied': 'kein Zugriff',
  'panel.sync.notOpen': 'nicht geöffnet',
  'panel.untitledHeading': 'Überschrift ohne Text',
  'panel.untitledTask': 'Aufgabe ohne Text',
  'panel.goToTask': 'Zu dieser Aufgabe',
  'panel.openImage': 'Dieses Bild öffnen',
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
  'op.is': 'ist',
  'op.isNot': 'ist nicht',
  'op.isEmpty': 'ist leer',
  'op.isNotEmpty': 'ist nicht leer',
  'op.gt': 'größer als',
  'op.gte': 'mindestens',
  'op.lt': 'kleiner als',
  'op.lte': 'höchstens',
  'op.before': 'vor',
  'op.after': 'nach',
  'op.contains': 'enthält',
  'op.notContains': 'enthält nicht',
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

  // --- Anmelden, Registrieren, Ersteinrichtung ---------------------------
  'auth.setup': 'SONE einrichten',
  'auth.setup.note':
    'Das legt den ersten Workspace und seinen Besitzer an. Es geht nur ein Mal.',
  'auth.workspaceName': 'Name des Workspace',
  'auth.yourName': '{address, select, formal {Ihr Name} other {Dein Name}}',
  'auth.email': 'E-Mail',
  'auth.password': 'Passwort',
  'auth.passwordHint': 'Mindestens 12 Zeichen. Länge schlägt Komplexität.',
  'auth.createWorkspace': 'Workspace anlegen',
  'auth.creatingWorkspace': 'Wird eingerichtet…',
  'auth.signIn': 'Anmelden',
  'auth.signingIn': 'Wird angemeldet…',
  'auth.createAccount': 'Konto anlegen',
  'auth.createAccountAction': 'Konto anlegen',
  'auth.creatingAccount': 'Wird angelegt…',
  'auth.or': 'oder',
  'auth.noAccount': 'Noch kein Konto?',
  'auth.createOne': 'Eines anlegen',
  'auth.haveAccount':
    '{address, select, formal {Sie haben schon ein Konto?} other {Du hast schon ein Konto?}}',
  'auth.cannotStart': 'Start nicht möglich',
  'auth.tryAgain': 'Noch einmal versuchen',
  'auth.loading': 'Wird geladen…',

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
