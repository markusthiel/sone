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
  'account.workspaces': 'Workspaces',
  'account.administration': 'Verwaltung',
  'account.inbox': 'Posteingang',
  'inbox.title': 'Posteingang',
  'settings.title': 'Einstellungen',
  // Zwei Bereiche, nicht drei: der Workspace hat einen eigenen (ADR-0070).
  'settings.scope': '{address, select, formal {Nur für Sie} other {Nur für dich}}',
  'admin.scope': 'Für alle auf diesem Server',
  'inbox.group.state': 'Posteingang',
  'inbox.group.kind': 'Nach Art',
  'inbox.group.workspace': 'Nach Workspace',
  'inbox.view.unread': 'Ungelesen',
  'inbox.view.all': 'Alles',
  'inbox.view.snoozed': 'Später',
  'inbox.emptyView': 'In dieser Ansicht ist nichts.',
  'inbox.empty':
    'Nichts wartet. Hier erscheint es, wenn jemand einen Namen in einem ' +
    'Kommentar nennt oder in einem Verlauf antwortet, an dem die eigene ' +
    'Person beteiligt ist.',
  'inbox.unreadOnly': 'Nur Ungelesenes',
  'inbox.markAll': 'Alles als gelesen markieren',
  'inbox.times': '{count, plural, one {# Mal} other {# Mal}}',
  'inbox.keys': 'j/k bewegen · Enter öffnet · e gelesen · u ungelesen · s später',
  'inbox.markRead': 'Gelesen',
  'inbox.markUnread': 'Ungelesen',
  'inbox.snooze': 'Später',
  'inbox.snooze.later': 'In drei Stunden',
  'inbox.snooze.tomorrow': 'Morgen früh',
  'inbox.snooze.nextWeek': 'Nächste Woche',
  'inbox.wake': 'Zurückholen',
  'inbox.remove': 'Entfernen',
  'inbox.answer': 'Antworten',
  'inbox.answer.placeholder': 'Antwort schreiben… Enter sendet, Umschalt+Enter macht eine Zeile.',
  'inbox.answer.send': 'Senden',
  'inbox.answer.sending': 'Wird gesendet…',
  'inbox.answer.failed': 'Konnte nicht gesendet werden.',
  'inbox.backOn': 'wieder am {when}',
  'inbox.mention': 'Namensnennung',
  'inbox.reply': 'Antwort im Verlauf',
  'inbox.assignment': 'Zuweisung',
  'inbox.noEmail': 'SONE verschickt keine E-Mails. Benachrichtigungen stehen hier.',
  'inbox.andEmail':
    '{address, select, ' +
    'formal {Benachrichtigungen stehen hier. Ob Sie zusätzlich eine E-Mail bekommen, ' +
    'entscheiden Sie unter Sie → Benachrichtigungen.} ' +
    'other {Benachrichtigungen stehen hier. Ob du zusätzlich eine E-Mail bekommst, ' +
    'entscheidest du unter Du → Benachrichtigungen.}}',
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
  'sidebar.resize': 'Ziehen macht die Leiste breiter, Doppelklick setzt zurück',
  'sidebar.close': 'Navigation schließen',
  'sidebar.hide': 'Seitenleiste ausblenden',
  'sidebar.show': 'Seitenleiste einblenden',
  'sidebar.search': 'Suchen',
  'sidebar.places': 'Bereiche',
  'mode.pages': 'Seiten',
  'mode.you': '{address, select, formal {Sie} other {Du}}',
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
  'entry.watch': 'Änderungen beobachten',
  'entry.unwatch': 'Nicht mehr beobachten',
  'entry.favourite': 'Zu Favoriten hinzufügen',
  'entry.unfavourite': 'Aus Favoriten entfernen',
  'entry.share': 'Teilen…',
  'entry.move': 'Verschieben nach…',
  'entry.lockedShort': 'Gesperrt',
  'entry.lock': 'Sperren',
  'entry.lock.hint':
    'Gegen versehentliche Änderungen sperren. Wer bearbeiten darf, kann sie ' +
    'wieder aufheben.',
  'entry.unlock': 'Entsperren',
  'entry.unlock.hint': 'Änderungen wieder erlauben.',
  'entry.export': 'Exportieren\u2026',
  'share.commentsVisible':
    'Wer diesen Link hat, kann die {count} Kommentarverläufe dieser Seite ' +
    'lesen. Eine in Kommentaren geführte Diskussion wird sichtbar, sobald der ' +
    'Link herausgegeben ist.',
  'share.heading': '„{title}“ teilen',
  'file.pdfAllPages': 'Original öffnen',
  'video.hlsFailed': 'Dieser Stream konnte hier nicht abgespielt werden. ',
  'video.dashOnly':
    'DASH-Streams laufen nur in Browsern mit eigener Unterstützung. ',
  'video.openStream': 'Stream öffnen',
  'field.relation': 'Relation',
  'relation.chooseTarget': 'Auf welche Kollektion soll das zeigen?',
  'relation.noCollections': 'Es gibt noch keine andere Kollektion, auf die man zeigen könnte.',
  'field.rollup': 'Rollup',
  'rollup.choose': 'Welche Relation soll gezählt werden?',
  'rollup.nothingPointsHere':
    'Noch zeigt keine Relationsspalte auf diese Kollektion. Zuerst eine in ' +
    'der anderen Kollektion anlegen.',
  'action.save': 'Speichern',
  'action.create': 'Anlegen',
  'error.invalid_value': 'Dieser Wert passt nicht in diese Spalte.',
  'error.empty_message': 'Ein Kommentar braucht einen Inhalt.',
  'error.message_too_long': 'Dieser Kommentar ist länger, als ein Kommentar sein kann.',
  'error.invalid_anchor': 'Die Stelle, um die es ging, ist verloren gegangen. Bitte den Text noch einmal auswählen.',
  'error.invalid_place': 'Diese Stelle im Dokument konnte nicht gelesen werden. Bitte den Abschnitt noch einmal auswählen.',
  'error.marks_need_an_account': 'Zum Markieren braucht es ein Konto. Über einen Link lässt sich die Stelle kommentieren — das sagt mehr.',
  'error.too_many_marks': 'Diese Seite trägt schon so viele Markierungen, wie sie kann. Bitte zuerst eine entfernen.',
  'error.too_many_threads': 'Diese Seite trägt schon so viele Diskussionen, wie sie kann. Erst ein paar auflösen.',
  'error.not_your_link': 'Diese Verknüpfung wurde für ein anderes Konto begonnen.',
  'error.no_other_way_in':
    '{address, select, formal {Das ist der einzige Weg in dieses Konto. Erst ein ' +
    'Passwort setzen — sonst sperren Sie sich aus.} other {Das ist der einzige Weg ' +
    'in dieses Konto. Erst ein Passwort setzen — sonst sperrst du dich aus.}}',
  'error.already_linked_elsewhere':
    'Dieses Anbieter-Konto ist hier schon mit jemand anderem verknüpft.',
  'error.already_have_one':
    'Dieses Konto hat schon einen Anbieter verknüpft. Erst den trennen.',
  'error.too_many_files': 'Mehr Dateien, als eine Zelle hält.',
  'error.unknown_option': 'Diese Option gehört nicht zu dieser Spalte.',
  'error.field_is_derived': 'Diese Spalte wird berechnet, sie ist nicht beschreibbar.',
  'error.unsupported_field_type': 'Dieser Spaltentyp kann nicht angelegt werden.',
  'error.unsupported_view_type': 'Diese Art Ansicht kann nicht angelegt werden.',
  'error.options_not_set': 'Diese Spalte hat noch keine Optionen.',
  'error.invalid_definition': 'Die Einstellungen dieser Ansicht waren nicht lesbar.',
  'error.pages_need_a_folder': 'Eine Seite muss in einem Ordner liegen.',
  'error.parent_is_not_a_folder': 'Das ist kein Ordner, darin kann nichts liegen.',
  'error.parent_not_found': 'Dieser Ordner existiert nicht mehr.',
  'error.a_row_cannot_hold_a_collection': 'Eine Zeile kann keine eigene Kollektion halten.',
  'error.invalid_tag': 'Dieses Schlagwort ist nicht verwendbar.',
  'error.invalid_width': 'Diese Seitenbreite ist keine der zwei.',
  'error.invalid_color_scheme': 'Hell oder dunkel — etwas anderes gibt es nicht.',
  'error.invalid_landing':
    'So kann eine Startseite nicht festgelegt werden (ADR-0119).',
  'error.invalid_cover':
    'Das ist kein Titelbild, das hier gespeichert werden kann. Bilder müssen '
    + 'hierher hochgeladen sein (ADR-0117).',
  'error.unsupported_color': 'Diese Farbe ist keine der acht.',
  'error.invalid_level': 'Diese Stufe für Seiten gibt es nicht.',
  'error.invalid_right': 'Dieses Recht gibt es nicht.',
  'error.system_role': 'Eingebaute Rollen lassen sich nicht ändern oder löschen.',
  'error.role_in_use': 'Diese Rolle ist noch vergeben. Erst die Leute und Gruppen umstellen, die sie haben.',
  'error.name_taken': 'Dieser Name ist schon vergeben.',
  'error.last_owner': 'Ein Workspace muss einen Eigentümer behalten.',
  'error.last_administrator': 'Die Instanz muss einen Verwalter behalten.',
  'error.cannot_deactivate_yourself': 'Das eigene Konto kann nicht deaktiviert werden.',
  'error.personal_workspace':
    'Ein persönlicher Workspace kann nicht geteilt oder entfernt werden.',
  'error.grants_exist':
    'Diese Gruppe hat noch Zugriff auf Seiten. Dort zuerst entfernen.',
  'error.not_a_member': 'Diese Person ist kein Mitglied dieses Workspace.',
  'error.export_too_large': 'Dieser Export ist zu groß zum Vorbereiten.',
  'error.too_large': 'Diese Datei ist zu groß.',
  'error.search_needs_a_name': 'Der Suche zuerst einen Namen geben.',
  'error.no_mail_server': 'Erst einen Mailserver eintragen.',
  'error.no_address_to_test_with':
    '{address, select, formal {Ihr Konto hat} other {Dein Konto hat}} keine ' +
    'E-Mail-Adresse zum Testen.',
  'error.unknown_link': 'Dieser Link ist nicht gültig. Einen neuen anfordern.',
  'error.expired_link': 'Dieser Link ist abgelaufen. Einen neuen anfordern.',
  'error.weak_password': 'Ein Passwort braucht mindestens 12 Zeichen.',
  'error.formula_missing': 'Erst eine Formel schreiben.',
  'error.formula_invalid':
    'Diese Formel ist nicht lesbar. Klammern und Operatoren prüfen.',
  'error.formula_unknown_field':
    'Die Formel nennt eine Spalte, die diese Kollektion nicht hat.',
  'error.formula_reads_formula':
    'Eine Formel kann keine andere Formel lesen. Stattdessen den Ausdruck ' +
    'wiederholen — diese Einschränkung verhindert, dass eine Spalte von sich ' +
    'selbst abhängt.',
  'error.relation_without_target':
    'Eine Relationsspalte muss sagen, auf welche Kollektion sie zeigt.',
  'error.relation_points_elsewhere': 'Diese Relation zeigt auf eine andere Kollektion.',
  'error.not_a_relation': 'Diese Spalte ist keine Relation.',
  'error.not_a_stored_field':
    'Ein Rollup kann nur eine gespeicherte Spalte aggregieren, keine berechnete.',
  'error.rollup_needs_a_field': 'Wählen, welche Spalte aggregiert wird.',
  'error.invalid_rollup': 'Dieses Rollup ist nicht vollständig.',
  'error.too_many_relations': 'Mehr verknüpfte Zeilen, als eine Zelle hält.',
  'error.row_not_found': 'Diese Zeile ist nicht in der Kollektion, auf die die Spalte zeigt.',
  'error.collection_not_found': 'Diese Kollektion existiert nicht mehr.',
  'field.formula': 'Formel',
  'formula.edit': 'Diese Formel bearbeiten',
  'formula.example': 'Menge * Preis',
  'formula.write': 'Eine Formel schreiben',
  'formula.columns': 'Verwendbare Spalten: {names}',
  'formula.error.unknown_field': 'Keine solche Spalte',
  'formula.error.type_mismatch': 'Diese Typen lassen sich nicht verbinden',
  'formula.error.unknown_function': 'Keine solche Funktion',
  'formula.error.wrong_arity': 'Falsche Anzahl an Argumenten',
  'formula.error.divide_by_zero': 'Durch null geteilt',
  'formula.error.not_a_date': 'Kein Datum',
  'rollup.aggregate': 'Was gezählt wird',
  'rollup.rows': 'Die verknüpften Zeilen',
  'rollup.count': 'Wie viele',
  'rollup.field': 'Welches Feld',
  'rollup.pickField': 'Feld wählen…',
  'rollup.lookup': 'Deren Werte',
  'rollup.sum': 'Deren Summe',
  'rollup.min': 'Der kleinste Wert',
  'rollup.max': 'Der größte Wert',
  'rollup.partial':
    'Einige verknüpfte Zeilen sind nicht sichtbar, weil sie nicht geöffnet ' +
    'werden dürfen — diese Zahl ist also niedriger als bei anderen.',
  'relation.aRow': 'Eine Zeile',
  'relation.add': 'Zeile verknüpfen',
  'relation.remove': 'Verknüpfung lösen',
  'relation.search': 'In der verknüpften Kollektion suchen',
  'relation.nothing': 'Hier nichts gefunden.',
  'file.pdfDocument': 'Dokument, scrollbar',
  'file.pdfPrevious': 'Vorherige Seite',
  'file.pdfNext': 'Nächste Seite',
  'file.pdfPageOf': 'Seite {page} von {total}',
  'file.pdfLoading': 'Dokument wird geöffnet\u2026',
  'file.pdfFailed': 'Dieses Dokument kann hier nicht gezeigt werden.',
  'file.pdfComment': 'Kommentieren',
  'file.pdfCommented': 'Dazu gibt es einen Kommentar',
  'file.pdfMark': 'Markieren',
  'file.pdfUnmark': 'Markierung entfernen',
  'file.pdfMarked': 'Hier hat jemand markiert',
  'file.pdfDownloadMarked': 'Mit Markierungen herunterladen',
  'file.pdfMarkedSuffix': 'mit Markierungen',
  'workspace.delete.hint': 'Diesen Workspace entfernen — eine Zeit lang umkehrbar.',
  'workspace.delete.notYours':
    'Löschen kann nur, wer diesen Workspace besitzt oder Workspaces verwaltet.',
  'workspace.area': 'Workspace',
  'workspace.untitled': 'Ohne Namen',
  'workspace.export': 'Diesen Workspace exportieren',
  'workspace.export.hint':
    'Jede lesbare Seite als Markdown-Dateien mit ihren Anhängen, in einem ' +
    'Archiv. Es wird im Hintergrund gepackt; diese Seite muss dabei nicht ' +
    'offen bleiben.',
  'workspace.export.start': 'Ein Archiv vorbereiten',
  'workspace.export.willMail':
    '{address, select, ' +
    'formal {Es läuft weiter, wenn Sie das hier schließen. Sie bekommen eine E-Mail, ' +
    'sobald das Archiv fertig ist.} ' +
    'other {Es läuft weiter, wenn du das hier schließt. Du bekommst eine E-Mail, ' +
    'sobald das Archiv fertig ist.}}',
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
  'swatch.asDesigned': '{label}: wie gestaltet',
  'swatch.own': '{label}: eine eigene Farbe',
  'sidebar.unfavourite': '{title} aus den Favoriten entfernen',
  'entry.untitled': 'Ohne Titel',
  // Im Akkusativ, weil beide Sätze, die ihn einsetzen, ihn dort brauchen.
  'entry.thisOne': 'diesen Eintrag',
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
  'admin.counts.admins': '{count, plural, one {# Administrator} other {# Administratoren}}',
  'admin.counts.deactivated': '{count} deaktiviert',
  'admin.counts.content':
    '{pages, plural, one {# Seite} other {# Seiten}} in ' +
    '{folders, plural, one {# Ordner} other {# Ordnern}}',
  'admin.counts.files': '{count, plural, one {# Anhang} other {# Anhänge}}',
  'admin.counts.onDisk': '{size} auf der Platte',
  'admin.workspaces': 'Workspaces',
  'admin.accounts': 'Konten',
  'admin.accounts.hint': 'Alle, die hier ein Konto haben',
  'admin.accounts.note':
    'Deaktivieren behält das Konto und seine Arbeit und meldet es sofort ab. Konten ' +
    'werden hier nie gelöscht: eines zu entfernen nähme jede Seite mit, die es angelegt ' +
    'hat — und „diese Person ist gegangen" ist nicht „ihre Arbeit hat nie stattgefunden".',
  'admin.account.you': '{address, select, formal {Sie} other {du}}',
  'admin.account.noAddress': 'keine Adresse',
  'admin.account.guest': 'Gast über Freigabe-Link',
  'admin.account.workspaces': '{count, plural, one {# Workspace} other {# Workspaces}}',
  'admin.account.deactivated': 'deaktiviert',
  'admin.account.administrator': 'Administrator',
  'admin.account.managesWorkspaces': 'Verwaltet Workspaces',
  'admin.account.deactivate': 'Deaktivieren',
  'admin.account.reactivate': 'Reaktivieren',
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
  'admin.maintenance.run': 'Wartung jetzt ausführen',
  'admin.maintenance.running': 'Läuft…',
  'admin.maintenance.note':
    'Dieser Durchgang läuft von selbst alle paar Minuten. Der Knopf ist für den Fall, ' +
    'dass Warten nicht in Frage kommt — meist, nachdem behoben wurde, woran eine ' +
    'Projektion gescheitert ist.',
  'admin.maintenance.ran':
    '{recovered, plural, one {# Projektion} other {# Projektionen}} wiederhergestellt, ' +
    '{compacted, plural, one {# Dokument} other {# Dokumente}} verdichtet.',
  'admin.maintenance.failed':
    '{count, plural, one {# Aufgabe} other {# Aufgaben}} in diesem Durchgang gescheitert:',
  'admin.welcomeMail': 'Willkommensmail',
  'admin.welcomeMail.hint':
    'Eine kurze Mail bei der ersten Anmeldung. Aus, solange sie niemand ' +
    'einschaltet — wer Konten für Kolleginnen anlegt und es ihnen persönlich ' +
    'sagt, braucht sie nicht. Der Hinweis auf eine Anmeldung von einem ' +
    'unbekannten Browser hat bewusst keinen Schalter.',
  'admin.replies': 'Antworten per E-Mail',
  'admin.replies.hint':
    'Mit einem Postfach hier lässt sich eine Benachrichtigung durch Antworten ' +
    'beantworten. Ohne eines wird keine Antwortadresse gesendet und nichts ' +
    'abgefragt.',
  'admin.imapHost': 'Postfach-Server (IMAP)',
  'admin.imapHost.hint': 'Leer heißt: Antworten werden gar nicht gelesen.',
  'admin.imapPort': 'Port',
  'admin.imapPort.hint': '993 für IMAP über TLS.',
  'admin.imapUser': 'Postfach-Benutzer',
  'admin.imapUser.hint':
    'Das Passwort bleibt in der Umgebung, als SONE_IMAP_PASSWORD.',
  'admin.replyMailbox': 'Antwortadresse',
  'admin.replyMailbox.hint':
    'Woran geantwortet wird. SONE hängt pro Benachrichtigung ein Token an ' +
    '(sone+token@…), damit ein Postfach für alle reicht — es muss diese ' +
    'Adressen in dasselbe Postfach zustellen.',
  'admin.mail.section.hint': 'Benachrichtigungen senden und Antworten darauf lesen.',
  'admin.mail': 'Mailserver',
  'admin.mail.hint':
    'Für Benachrichtigungs-E-Mails. Ohne Host wird nichts versendet und nichts ' +
    'angeboten — das ist eine normale Instanz.',
  'admin.mail.using': 'Was der Server benutzt hat',
  'admin.mail.usingPassword': 'Passwort',
  'admin.mail.passwordLength': '{count} Zeichen, aus SONE_SMTP_PASSWORD',
  'admin.mail.passwordMissing':
    'keines — SONE_SMTP_PASSWORD ist leer oder hat den Container nie erreicht. ' +
    'Compose muss es im environment des Dienstes nennen, nicht nur in .env.',
  'admin.mail.passwordQuoted':
    'es beginnt und endet mit einem Anführungszeichen, das gehört wohl zum Wert',
  'admin.mail.passwordSpace': 'es hat ein Leerzeichen oder einen Umbruch am Rand',
  'admin.mail.test': 'Test-E-Mail an mich senden',
  'admin.mail.testing': 'Wird gesendet…',
  'admin.mail.testSent': 'An {address} gesendet. Kommt sie an, funktioniert Mail.',
  'admin.mail.testFailed': 'Der Mailserver hat sie abgelehnt: ',
  'admin.smtpHost': 'Mailserver',
  'admin.smtpHost.hint':
    'Leer heißt keine E-Mail: Benachrichtigungen bleiben im Posteingang und es ' +
    'wird nichts versendet. Das ist eine normale Instanz.',
  'admin.smtpPort': 'Port',
  'admin.smtpPort.hint': '587 für STARTTLS, 465 für TLS.',
  'admin.smtpSecurity': 'Verschlüsselung',
  'admin.smtpSecurity.hint':
    'Über eine unverschlüsselte Verbindung wird ein Passwort abgelehnt — ein ' +
    'Zugangswort im Klartext ist schlimmer als keine Mail.',
  'admin.smtpSecurity.none': 'Keine (dann kein Passwort möglich)',
  'admin.smtpUser': 'Benutzer am Mailserver',
  'admin.smtpUser.hint':
    'Das Passwort bleibt in der Umgebung, als SONE_SMTP_PASSWORD: ein Geheimnis ' +
    'in einer Tabelle ist ein Geheimnis in jedem Backup.',
  'admin.smtpFrom': 'Absenderadresse',
  'admin.smtpFrom.hint':
    'Wovon Mail kommt. Die meisten Relays bestehen darauf, sie zu besitzen.',
  'admin.emailDetail': 'Was eine Mail nennen darf',
  'admin.emailDetail.hint':
    'Eine Benachrichtigungsmail enthält nie Kommentartext. Hier geht es darum, ' +
    'ob sie außer dem Workspace auch die Seite nennen darf.',
  'admin.emailDetail.title': 'Den Seitentitel',
  'admin.emailDetail.workspace': 'Nur den Workspace',
  'admin.instanceName': 'Name der Instanz',
  'admin.brand': 'Erscheinungsbild',
  'admin.brand.section.hint': 'Logo und Basis-Design dieser Instanz.',
  'admin.brand.hint':
    'Beides ist schon vor der Anmeldung zu sehen — das ist der Sinn davon.',
  'admin.brand.choose': 'Logo wählen',
  'admin.brand.remove': 'Logo entfernen',
  'admin.brand.logo.onLight': 'Für helle Flächen',
  'admin.brand.logo.onDark': 'Für dunkle Flächen',
  'admin.brand.logo.note':
    'Am besten quadratisch, PNG, JPEG oder WebP. Ein fast quadratisches Bild ' +
    'wird eingepasst, nicht verzerrt. Ohne Logo zeichnet die Oberfläche ihre ' +
    'eigene Marke. Welche der beiden Fassungen gezeigt wird, entscheidet die ' +
    'Fläche selbst — ein Workspace kann die schmale Leiste einfärben. Ist nur ' +
    'eine hochgeladen, gilt sie überall.',
  'admin.brand.design': 'Basis-Design',
  'admin.brand.design.hint':
    'Gilt überall dort, wo ein Workspace nichts eigenes eingestellt hat. Ein ' +
    'Workspace füllt darüber auf; er ersetzt es nicht.',
  'admin.signup': 'Wer ein Konto anlegen darf',
  'admin.signup.open': 'Jeder, der die Adresse hat',
  'admin.signup.invite': 'Nur mit Einladung',
  'admin.signup.closed': 'Niemand — keine neuen Konten',
  'admin.requireSecondFactor': 'Anmeldung in zwei Schritten verlangen',
  'admin.requireSecondFactor.hint':
    'Alle bekommen vierzehn Tage und zwei E-Mails, danach öffnet nur noch die ' +
    'Einrichtung. Single-Sign-on-Konten sind ausgenommen — dort gehört ein ' +
    'zweiter Faktor zum Anbieter. Vorher braucht man selbst einen.',
  'admin.mayCreateWorkspaces': 'Mitglieder dürfen Workspaces anlegen',
  'admin.addressForm': 'Wie die Oberfläche die Leute anspricht',
  'admin.addressForm.hint':
    'Im Deutschen und in anderen Sprachen, die das unterscheiden. Englisch hat nur ' +
    'eine Form und bleibt unberührt.',
  'admin.mail.noUser': '(kein Benutzer)',
  'admin.mail.usingLine': '{user} @ {host}:{port} · {security} · von {from}',
  'admin.pendingNote': 'normal, während Leute schreiben',
  'admin.noMessage': 'keine Meldung aufgezeichnet',
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
  'admin.anomaly.passwordCost': 'Passwort-Hashing ist niedrig eingestellt',
  'admin.anomaly.passwordCost.explain':
    'SONE_PASSWORD_COST steht auf 2^{cost}, unter den empfohlenen 2^16 — jetzt ' +
    'gehashte Passwörter sind leichter angreifbar. Variable entfernen, dann ' +
    'werden bestehende Passwörter bei der nächsten Anmeldung aufgewertet.',
  'admin.liftSecondFactor': 'Zwei-Schritt-Anmeldung entfernen',
  // Ohne Anrede formuliert, damit sie in beiden Formen stimmt: „wer das war"
  // statt „dass du das warst".
  'admin.liftSecondFactor.confirm':
    'Zwei-Schritt-Anmeldung für {name} entfernen? Die Anmeldung geht dann mit ' +
    'dem Passwort allein, und {name} bekommt eine E-Mail mit dem Namen der ' +
    'Person, die das getan hat.',
  'admin.anomaly.mail': 'E-Mails, die nicht versendet werden konnten',
  'admin.anomaly.mail.explain':
    'Das Relay hat sie abgelehnt, nach mehreren Versuchen. Meist ein falsches ' +
    'Passwort, ein falscher Port oder eine falsche Absenderadresse — die ' +
    'Mailserver-Einstellungen oben prüfen. Die Betroffenen haben ihre ' +
    'Benachrichtigungen weiterhin in der App.',
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
  'area.instance': 'Verwaltung',

  // --- die eigenen Einstellungen -----------------------------------------
  'you.profile': 'Profil',
  'you.profile.hint':
    '{address, select, formal {Ihr Name, Ihre Adresse und Ihr Bild} ' +
    'other {Dein Name, deine Adresse und dein Bild}}',
  'you.signIn': 'Anmelden',
  'mention.pick': 'Jemanden erwähnen',
  'mention.nobody': 'In diesem Workspace ist sonst noch niemand.',
  'mention.noMatch': 'Hier passt niemand zu „{query}“.',
  'you.sso': 'Single Sign-on',
  'you.sso.note':
    'Mit dem Anbieter anmelden, für den diese Instanz eingerichtet ist, statt mit ' +
    'dem Passwort. Das Passwort bleibt gültig: eine Verknüpfung fügt einen zweiten ' +
    'Weg hinein hinzu, sie ersetzt den ersten nicht.',
  'you.sso.connected': 'Verknüpft mit',
  'you.sso.connect': 'Verknüpfen',
  'you.sso.disconnect': 'Trennen',
  'you.sso.justLinked': 'Verknüpft. Ab jetzt geht die Anmeldung auch darüber.',
  'you.sso.onlyWayIn':
    '{address, select, formal {Das ist der einzige Weg in dieses Konto. Erst ein ' +
    'Passwort setzen — sonst würden Sie sich aussperren.} other {Das ist der ' +
    'einzige Weg in dieses Konto. Erst ein Passwort setzen — sonst würdest du ' +
    'dich aussperren.}}',
  'you.signIn.hint': '{address, select, formal {Ihr Passwort} other {Dein Passwort}}',
  'you.appearance': 'Aussehen',
  'you.appearance.hint':
    'Wie SONE {address, select, formal {für Sie} other {für dich}} aussieht',
  'you.notifications': 'Benachrichtigungen',
  // Beugt sich nach der Anredeform, wie jede Nachricht, die jemanden anspricht
  // (ADR-0041): eine Instanz, die „Sie" gewählt hat, darf hier nicht duzen.
  'you.notifications.hint':
    'Wann SONE {address, select, formal {Ihnen} other {dir}} eine E-Mail schickt.',
  'you.notifications.contents':
    'Eine Benachrichtigungsmail sagt, wer was auf welcher Seite getan hat, mit ' +
    'einem Link. Sie enthält nie den Kommentar selbst — ein Postfach ist kein ' +
    'Berechtigungssystem.',
  // Diese drei sprechen von „mich" und „mir" — die eigene Person, nicht die
  // angesprochene. Das ist in beiden Anredeformen gleich.
  'you.when.immediately': 'Sofort per E-Mail',
  'you.when.daily': 'In der Tagesmail',
  'you.when.off': 'Keine E-Mail',
  'required.title': 'Hier ist die Anmeldung in zwei Schritten jetzt Pflicht',
  'required.hint':
    'Die Betreiberin dieser Instanz hat die Anmeldung in zwei Schritten zur ' +
    'Pflicht gemacht, und die Zeit zum Einrichten ist vorbei. Einen ' +
    'Authenticator hinzufügen, um weiterzumachen — vorher ist nichts anderes ' +
    'erreichbar.',
  'required.soon':
    '{days, plural, one {Ab morgen ist die Anmeldung in zwei Schritten Pflicht.} ' +
    'other {In # Tagen ist die Anmeldung in zwei Schritten Pflicht.}} Einen ' +
    'Authenticator in den Einstellungen einrichten.',
  'required.setUp': 'Einrichten',
  'you.secondFactor': 'Anmeldung in zwei Schritten',
  'you.secondFactor.hint':
    'Eine App auf dem Telefon erzeugt einen sechsstelligen Code, der nach dem ' +
    'Passwort abgefragt wird. Das schützt den Fall, der zählt: ein Passwort, das ' +
    'anderswo wiederverwendet wurde und dort abhandenkam.',
  'you.secondFactor.isOn': 'Für dieses Konto ist die Anmeldung zweistufig.',
  'you.secondFactor.start': 'Authenticator einrichten',
  'you.secondFactor.qrLabel': 'QR-Code für die Authenticator-App',
  'you.secondFactor.scan': 'Dieses Konto in der Authenticator-App hinzufügen.',
  'you.secondFactor.open': 'In einer Authenticator-App öffnen',
  'you.secondFactor.byHand': 'Oder dieses Geheimnis von Hand eintippen:',
  'you.secondFactor.prove':
    'Einen Code aus der App eingeben. Nichts wird eingeschaltet, bevor einer ' +
    'stimmt — ein falsch eingetragenes Geheimnis kann also nicht aussperren.',
  'you.secondFactor.finish': 'Einschalten',
  'you.secondFactor.remove': 'Ausschalten',
  'you.secondFactor.removePassword': 'Das eigene Passwort',
  'you.secondFactor.removePassword.hint':
    'Zum Ausschalten nötig, damit ein offener Laptop nicht genügt.',
  'you.secondFactor.codes': 'Die Wiederherstellungscodes',
  'you.secondFactor.codes.hint':
    'Sicher aufbewahren. Jeder gilt einmal, und sie sind der Weg zurück, wenn ' +
    'die App verloren geht. Sie werden nicht noch einmal gezeigt.',
  'you.secondFactor.codes.kept': 'Aufbewahrt',
  'you.activity': 'Eine Mail darüber, was sich geändert hat',
  'you.activity.hint':
    'Eine Liste geänderter Seiten aus den eigenen Workspaces — Titel und Namen, ' +
    'nie der Inhalt, und nie eine Seite ohne Zugriff. Aus, bis sie gewählt wird.',
  'you.activity.scope': 'Was sie umfasst',
  'you.activity.scope.hint':
    'Einen Ordner zu beobachten umfasst alles darunter. Was ohne Zugriff ist, ' +
    'steht so oder so nie darin.',
  'you.activity.scope.all': 'Alles Sichtbare',
  'you.activity.scope.watched': 'Nur beobachtete Seiten',
  'you.activity.off': 'Keine solche Mail',
  'you.activity.daily': 'Jeden Werktagmorgen',
  'you.activity.weekly': 'Montagmorgens',
  'you.notifications.schedule': 'Wie oft',
  'you.notifications.schedule.hint':
    'Eine tägliche Mail kommt um acht Uhr morgens in der eigenen Zeitzone — und ' +
    'nur, wenn noch etwas ungelesen ist.',
  'you.notifications.schedule.batched': 'Sobald etwas passiert',
  'you.notifications.schedule.daily': 'Einmal am Tag',
  'you.notifications.schedule.off': 'Keine E-Mails',
  'you.notifications.mentions': 'Mail, wenn mich jemand erwähnt',
  'you.notifications.assignments': 'Mail, wenn mir jemand eine Aufgabe gibt',
  'you.notifications.replies': 'Mail zu Antworten in Kommentaren, in denen ich bin',
  'you.notifications.replies.hint':
    'Standardmäßig aus: das ist die Art, die am häufigsten kommt und am ' +
    'wenigsten verlangt.',
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
  'you.newPassword.hint':
    'Mindestens zwölf Zeichen. Länge ist es, was ein Passwort schwer zu erraten ' +
    'macht; ein kurzes mit Sonderzeichen ist es nicht.',
  'you.changePassword': 'Passwort ändern',
  'you.changingPassword': 'Wird geändert…',
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
    'Hell oder dunkel gehört zum Konto und gilt überall, wo {address, select, ' +
    'formal {Sie sich anmelden} other {du dich anmeldest}}. Die beiden ' +
    'Schriftgrößen bleiben in diesem Browser: eine Größe, die auf einem Telefon ' +
    'passt, ist auf einem großen Bildschirm falsch.',
  'you.theme': 'Erscheinungsbild',
  'you.theme.hint':
    'Ohne eigene Wahl gilt, was der Workspace sagt. „Wie das System" ist selbst ' +
    'eine Wahl und überschreibt ihn — wer draußen in der Sonne sitzt, will hell, ' +
    'was der Workspace auch meint.',
  'you.theme.workspace': 'Wie der Workspace',
  'you.theme.system': 'Wie das System',
  'you.theme.light': 'Hell',
  'you.theme.dark': 'Dunkel',
  'you.interfaceSize': 'Schriftgröße der Oberfläche',
  'you.interfaceSize.hint':
    'Seitenleiste, Menüs und Einstellungen — alles außer dem Geschriebenen.',
  'you.editorSize': 'Schriftgröße im Editor',
  'you.editorSize.hint':
    '{address, select, formal {Ihr Geschriebenes} other {Dein Geschriebenes}}, und sonst nichts.',
  'you.density': 'Dichte',
  'you.density.hint':
    'Wie eng die Oberfläche gepackt ist. Bleibt in diesem Browser, wie die Größen darüber — ein Telefon und ein Monitor wollen verschiedene Antworten.',
  'you.thisBrowser': 'Dieser Browser',

  'about.server': 'Server',
  'about.documentFormat': 'Dokumentformat',
  'about.stale':
    'Dieser Browser läuft mit einem älteren Stand als der Server. Neu laden holt die ' +
    'aktuelle Fassung — bis dahin kann das Gezeigte von dem abweichen, was der Server tut.',
  'about.licence':
    'SONE ist freie Software unter der AGPL-3.0. Keine Platzbeschränkung, keine ' +
    'abgesperrten Funktionen, keine Enterprise-Ausgabe.',
  'about.syncProtocol': 'Sync-Protokoll',
  'about.checking': 'wird geprüft…',

  // --- Einstellungen dieses Workspace ------------------------------------
  'workspace.nameAndMark': 'Name und Zeichen',
  'workspace.nameAndMark.hint': 'Wie dieser Workspace heißt und woran man ihn erkennt',
  'workspace.typography': 'Schrift',
  'workspace.typography.hint': 'Größen und Abstände von Überschriften, Text und Code.',
  'workspace.colours': 'Farben & Flächen',
  'workspace.colours.hint': 'Tönung, Akzentfarbe und die acht Farbnamen.',
  'workspace.landing': 'Standard-Seite',
  'workspace.landing.hint': 'Womit dieser Workspace für alle öffnet.',
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
  'page.opening': 'Wird geöffnet…',
  'page.otherPeopleHere':
    '{count, plural, one {# weitere Person hier} other {# weitere Leute hier}}',
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
  'format.copied': 'Kopiert',
  'format.copy': 'Kopieren',
  'format.copyCode': 'Code kopieren',
  'format.linkWord': 'Link',
  'format.bold': 'Fett (Mod-B)',
  'format.italic': 'Kursiv (Mod-I)',
  'format.strikethrough': 'Durchgestrichen',
  'format.code': 'Code (Mod-E)',
  'format.removeLink': 'Entfernen',
  'format.linkOpen': 'Öffnen',
  'format.linkCopy': 'Adresse kopieren',
  'format.linkCopied': 'Kopiert',
  'format.linkEdit': 'Ändern',
  'slash.noMatch': 'Kein Block passt zu „{query}"',
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
  'workspaces.loading': 'Wird geladen…',
  'workspaces.youAreHere': '{address, select, formal {Sie sind hier} other {du bist hier}}',
  'workspaces.deleted': 'gelöscht',
  'workspaces.personal.note':
    'Einer je Konto. {count, plural, one {# insgesamt} other {# insgesamt}}.',
  'workspaces.show': 'Zeigen',
  'workspaces.hide': 'Verbergen',
  'workspaces.creating': 'Wird angelegt…',
  'workspaces.memberCount': '{count, plural, one {# Person} other {# Leute}}',
  'workspaces.personal': 'Persönliche Workspaces',
  'workspaces.nonePersonal':
    'Noch keine — jeder Workspace hier gehört einer Person.',
  'workspaces.name': 'Name',
  'workspaces.people': 'Leute',
  'workspaces.pages': 'Seiten',
  'workspaces.lastEdited': 'Zuletzt bearbeitet',
  'workspaces.area': 'Workspaces',
  'workspaces.delete': 'Diesen Workspace löschen',
  'workspaces.confirmName': 'Zum Bestätigen den Namen eintippen',
  'workspaces.nameField': 'Name des Workspace',
  'workspaces.new': 'Neuer Workspace',
  'workspaces.all': 'Alle Workspaces',
  'workspaces.chosen': 'Dieser Workspace',

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
  'group.members': '{count, plural, one {# Person} other {# Leute}}',
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
  'oidc.noSecret':
    'Es ist kein Client-Secret gesetzt. SONE_OIDC_CLIENT_SECRET in die Umgebung des ' +
    'Servers eintragen und ihn neu starten; bis dahin bleibt Single Sign-on aus. Das ' +
    'Secret wird hier absichtlich nicht gespeichert — ein Secret in der Datenbank ist ' +
    'ein Secret in jedem Backup.',
  'oidc.issuer.hint':
    'Die Basis-URL des Providers. Alles Weitere wird aus seinem Discovery-Dokument ' +
    'gelesen, hier muss also nichts wissen, welcher Provider es ist.',
  'oidc.callback':
    '/api/auth/oidc/callback unter der öffentlichen URL dieser Instanz in die Liste ' +
    'der Redirect-URIs des Providers eintragen.',
  'oidc.buttonLabel.hint':
    'Was auf der Anmeldeseite steht. Leute erkennen ihren eigenen Login am Namen, nicht ' +
    'am Protokoll dahinter.',
  'oidc.allowSignup.hint':
    'Standardmäßig aus. Einem Anbieter zu glauben, wer jemand ist, verpflichtet nicht ' +
    'dazu, jeden von dort hereinzulassen.',
  'invitation.used':
    'Diese Einladung wurde schon benutzt. Wenn das gerade {address, select, formal ' +
    '{Sie waren, ist Ihr Konto} other {du warst, ist dein Konto}} fertig.',
  'invitation.invitedTo':
    '{address, select, formal {Sie sind eingeladen} other {Du bist eingeladen}}, ' +
    '{workspace} beizutreten.',
  'invitation.aWorkspace': 'einem Workspace',
  'invitation.join': 'Beitreten',
  'invitation.joining': 'Tritt bei…',
  'invitation.checking': 'Einladung wird geprüft…',
  'invitation.keepsYours':
    'Der eigene Workspace bleibt, wo er ist. Ein Beitritt stellt diesen daneben.',
  'option.rename.note':
    'Eine Option lässt sich frei umbenennen — die Einträge behalten sie. Eine zu ' +
    'entfernen verbirgt sie in den Einträgen, die sie benutzen, und eine neue Option mit ' +
    'demselben Namen bringt sie nicht zurück.',
  'video.embedVerdict':
    'Ein {provider}-Video. Von dort wird nichts geladen, bis jemand auf Abspielen drückt.',
  'video.streamVerdict': 'Ein Live-Stream über {kind}, in der Seite abgespielt.',
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
  'invite.outstanding': 'Offene Einladungen',
  'invite.anybodyWithLink': 'Jeder mit dem Link',
  'invite.role': 'Rolle',
  'invite.for': 'Für',
  'invite.expires': 'Läuft ab',
  'invite.used': 'Benutzt',
  'invite.withdraw': 'Zurückziehen',
  'invite.maxUses': 'Für wie viele Leute',
  'invite.maxUses.hint':
    // Ohne Anrede formuliert, damit der Satz in beiden Formen stimmt.
    'Ein Link, eine Person — sofern hier nichts anderes steht. Mehr ist der Weg, eine ' +
    'Gruppe einzuladen, ohne jede Adresse zu tippen; und es bleibt ein Link, den ' +
    'jeder weitergeben kann, der ihn hat.',
  'invite.usedOf': '{used} von {max}',
  'invite.create': 'Einladung erstellen',
  'invite.creating': 'Wird erstellt…',
  'invite.link.note':
    'Jetzt kopieren — er wird nirgends gespeichert, wo er noch einmal zu lesen wäre, ' +
    'und dieser Bildschirm zeigt ihn kein zweites Mal.',
  'invite.link.mailed':
    'An {address} geschickt. Der Link steht auch hier, falls die Mail nicht ankommt: ' +
    'er wird nirgends gespeichert, wo er noch einmal zu lesen wäre.',
  'invite.withdraw.of': 'Einladung für {who} zurückziehen',

  // --- Rollen (ADR-0087) ---------------------------------------------------
  //
  // Eine Rolle ist zweierlei: was sie auf einer Seite ohne eigene Regeln gibt,
  // und welche Rechte sie trägt. Die Texte hier trennen das, weil die
  // Oberfläche es trennt — eine Leiter und eine Menge.
  'role.note':
    'Eine Rolle sagt zweierlei: was jemand auf Seiten darf, für die nichts Eigenes festgelegt ist, und was er im Workspace verwalten darf. Rollen lassen sich Personen und Gruppen geben.',
  'role.new': 'Neue Rolle',
  'workspace.roleUnknown': 'Rolle unbekannt',
  'role.name': 'Name',
  'role.name.note': 'Wie die Rolle in Listen heißt.',
  'role.namePlaceholder': 'Redaktion',
  'role.level': 'Auf Seiten',
  'role.level.note':
    'Gilt für Seiten, für die nichts Eigenes freigegeben wurde. Einzelne Freigaben können mehr geben, nie weniger.',
  'role.level.none': 'Nichts ohne ausdrückliche Freigabe',
  'role.rights': 'Im Workspace',
  'role.rights.note': 'Voneinander unabhängig. Nichts davon ist für die eigene Arbeit nötig.',
  'role.edit': 'Ändern',
  'role.delete': 'Löschen',
  'role.builtIn': 'Fest eingebaut',
  'role.heldBy':
    '{members, plural, =0 {Keine Person} one {Eine Person} other {# Personen}}' +
    '{groups, plural, =0 {} one {, eine Gruppe} other {, # Gruppen}}',
  'role.heldByNamed':
    '{rest, plural, =0 {{names}} one {{names} und eine weitere} other {{names} und # weitere}}',
  'role.heldByNobody': 'Hat noch niemand',
  'role.card.onPages': 'Auf Seiten',
  'role.card.inWorkspace': 'Im Workspace',
  'role.card.noRights': 'Verwaltet nichts',
  'role.confirmDelete': '„{name}" löschen?',
  'role.forGroup': 'Rolle dieser Gruppe',
  'role.groupNone': 'Keine Rolle',
  // Was jedes Recht erlaubt, in der Sprache der Sache und nicht der Route.
  'right.people.manage': 'Leute verwalten',
  'right.groups.manage': 'Gruppen verwalten',
  'right.workspace.settings': 'Workspace-Einstellungen',
  'right.roles.manage': 'Rollen festlegen',
  'workspace.roles': 'Rollen',
  'workspace.roles.hint': 'Was jemand darf, und wer welche Rolle hat',

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
  // --- Deckelung (ADR-0087) ------------------------------------------------
  //
  // Die einzige Schicht, die etwas wegnimmt. Der Text muss das sagen, sonst
  // liest sie sich wie noch ein Knopf, der etwas gibt.
  'cap.label': 'Höchstens',
  'cap.none': 'Keine Obergrenze',
  'cap.note':
    'Begrenzt, was hier höchstens geht — auch für die, die unten mehr bekommen. Wer den Workspace verwaltet, ist ausgenommen; sonst könnte eine Obergrenze niemand mehr aufheben.',
  'cap.inherited': 'Von „{from}" gilt hier bereits: {level}.',

  // --- Freigaben-Überblick ---------------------------------------------------
  //
  // Bisher war eine Freigabe nur **von der Seite aus** zu sehen. Das reicht,
  // um eine Seite zu prüfen, und hilft nicht bei der Frage, die man
  // tatsächlich hat: was habe ich hinausgelassen, und wofür bin ich zuständig.
  'shares.title': 'Freigaben',
  // In der ersten Person, nicht in der Anrede: „von mir / für mich" umgeht die
  // Du-Sie-Frage ganz und ist genau die Formulierung, in der die Frage gestellt
  // wurde — „welche Seiten man selbst freigegeben hat und welche für mich
  // freigegeben wurden".
  'shares.note':
    'Was aus diesem Workspace heraus geteilt ist — und was für mich freigegeben wurde. Von hier aus lässt sich beides zurücknehmen.',
  'shares.links': 'Links',
  'shares.links.note':
    'Wer den Link hat, kommt hinein. Als Erstes durchsehen: Links verlassen das Haus.',
  'shares.granted': 'Von mir freigegeben',
  'shares.received': 'Für mich freigegeben',
  'shares.nothing': 'Nichts.',
  'shares.subtree': 'mit Unterseiten',
  'shares.onlyPage': 'nur diese Seite',
  'shares.viaGroup': 'über die Gruppe „{name}"',
  'shares.by': 'von {name}',
  'shares.protected': 'mit Passwort',
  'shares.expires': 'läuft ab {date}',
  'shares.mine': 'von mir',
  'shares.revoke': 'Zurückziehen',
  'shares.open': 'Seite öffnen',

  // Eine Seite, die jemand nur als *Weg* zu einer freigegebenen Unterseite
  // sieht (ADR-0026). Der Name wurde absichtlich zurückgehalten; hier steht,
  // warum die Zeile keinen hat, und sonst nichts über die Seite.
  'tree.pathOnly': 'Nicht freigegeben',
  'perm.people': 'Leute',
  'perm.peopleHere': 'Leute in diesem Workspace',
  'perm.groups': 'Gruppen',
  'perm.addGroup': 'Gruppe hinzufügen',
  'perm.chooseGroup': 'Eine Gruppe wählen…',
  'perm.checking': 'Wird geprüft…',
  'perm.restricted.note':
    'Der Workspace erreicht diese Seite und alles darunter nicht. Besitzer und ' +
    'Administratoren schon — jemand muss das rückgängig machen können.',
  'perm.open.note':
    'Alle im Workspace erreichen diese Seite. Wer unten hinzukommt, bekommt mehr, ' +
    'als seine Rolle gibt, nie weniger.',
  'perm.inheritedFrom': '{level} · von {source}',
  'perm.accessFor': 'Zugriff für {who}',
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
  'tag.remove': '{tag} entfernen',
  'tag.add': 'Schlagwort hinzufügen',
  'tag.none': 'Keine',

  // --- eine Seite teilen -------------------------------------------------
  'share.signInRequired':
    'Dieser Link braucht ein Konto',
  'share.signInRequired.hint':
    'Wer den Link erstellt hat, wollte angemeldete Leute — damit bei allem, was ' +
    'geschrieben wird, ein Name steht. {address, select, ' +
    'formal {Melden Sie sich an und öffnen Sie den Link noch einmal.} ' +
    'other {Melde dich an und öffne den Link noch einmal.}}',
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
  'share.byMail': 'Per Mail senden',
  'share.byMail.note':
    'Die Mail enthält den Link, wer ihn schickt, wann er abläuft — und den ' +
    'Satz unten, falls einer da steht. Kein Seiteninhalt.',
  'share.byMail.to': 'An',
  'share.byMail.message': 'Ein Satz dazu (optional)',
  'share.byMail.send': 'Senden',
  'share.byMail.sent': 'An {to} gesendet.',
  'error.invalid_address': 'Das sieht nicht nach einer E-Mail-Adresse aus.',
  'error.no_relay': 'Diese Instanz kann keine Mails senden.',
  'share.revoke': 'Widerrufen',
  'share.copy': 'Kopieren',
  'share.copied': 'Kopiert',
  'share.includeSubpages': 'Unterseiten einschließen',
  'share.password': 'Passwort (optional)',
  'share.password.tooShort':
    'Mindestens {count} Zeichen — ein Link-Passwort schützt denselben Inhalt wie ein ' +
    'Konto-Passwort.',
  'share.withSubpages': 'mit Unterseiten',
  'share.thisPageOnly': 'nur diese Seite',
  'share.hasPassword': 'Passwort',
  'share.until': 'bis {date}',
  'share.noExpiry': 'ohne Ablauf',
  'share.inUseBy': 'in Benutzung von {count}',
  'share.onASubpage': 'auf einer Unterseite',
  'share.show': 'Link zeigen',
  'share.shown': 'Gezeigt',
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
  'type.note.type':
    'Schriftgrößen und Abstände für diesen Workspace. Ein Block, der eine eigene Größe ' +
    'oder Farbe trägt, behält sie — diese gelten, wo niemand gewählt hat.',
  'type.note.colour':
    'Wie dieser Workspace aussieht: die Tönung der Flächen, die Akzentfarbe und was die ' +
    'acht Farbnamen bedeuten. Gilt überall, wo niemand etwas Eigenes gewählt hat.',
  'type.palette.note':
    'Wie jeder Farbname hier aussieht. Alles, was einen Namen benutzt — Schlagwörter, ' +
    'Spalten, Blöcke, Ordnersymbole — folgt dem.',
  'type.element': 'Element',
  'type.elements': 'Elemente',
  'type.base': 'Die Oberfläche',
  'type.base.note':
    'Die Tönung wird in Seitenleiste, Bereiche und Menüs gemischt. Eine Farbe ' +
    'statt einer pro Fläche, damit sie weiter zusammengehören.',
  'type.tint': 'Tönung',
  'type.accent': 'Akzent',
  'type.accent.note':
    'Der Akzent gilt für Links, hervorgehobenen Text und gefüllte Knöpfe. Die ' +
    'Textfarbe auf einem gefüllten Knopf wird daraus berechnet, eine blasse ' +
    'Akzentfarbe bekommt also dunklen Text.',
  'type.clear': 'Zurücksetzen',
  'type.palette': 'Palette',
  'type.size': 'Größe',
  'type.colour': 'Farbe',
  'type.spaceAbove': 'Abstand oben',
  'type.spaceBelow': 'Abstand unten',
  'type.asDesigned': 'Wie entworfen',

  // --- einzelne Flächen (ADR-0122) ---------------------------------------
  'type.surfaces': 'Flächen',
  'type.surfaces.note':
    'Einzelne Teile der Oberfläche können anders behandelt werden als der ' +
    'Rest — die schmale Leiste dunkel, der Rest hell. Gewählt wird eine ' +
    'Beziehung und keine Farbe: „umgekehrt" ist im hellen Design dunkel und ' +
    'im dunklen hell, aus einem gespeicherten Wert.',
  'type.surface.rail': 'Schmale Leiste',
  'type.surface.sidebar': 'Seitenleiste',
  'type.surface.panel': 'Rechtes Panel',
  'type.treatment.follow': 'Wie entworfen',
  'type.treatment.raised': 'Erhoben',
  'type.treatment.sunken': 'Vertieft',
  'type.treatment.inverted': 'Umgekehrt',
  'type.treatment.accent': 'Akzentfarbe',
  'type.fonts': 'Schrift',
  'type.fonts.note':
    'Gewählt wird ein Paar — die Schrift für Text und die für Code —, kein ' +
    'Schriftname. Alle Schriften liefert diese Instanz selbst aus; „Wie das ' +
    'Gerät" lädt gar keine.',
  'type.fonts.designed': 'Wie entworfen (Archivo)',
  'type.fonts.reading': 'Zum Lesen (Literata)',
  'type.fonts.plain': 'Schlicht (Inter)',
  'type.fonts.system': 'Wie das Gerät',
  'type.file': 'Theme als Datei',
  'type.file.note':
    'Eine Datei enthält das ganze Theme — Farben, Flächen, Ecken, Schrift und ' +
    'hell/dunkel. Beim Laden landet sie zuerst im Formular; gespeichert wird ' +
    'sie erst mit „Speichern".',
  'type.file.export': 'Exportieren',
  'type.file.import': 'Importieren',
  'type.file.loaded': '„{name}" geladen — noch nicht gespeichert.',
  'type.file.unnamed': 'Ohne Namen',
  'error.not_a_theme': 'Das ist keine SONE-Theme-Datei.',
  'type.scheme': 'Hell oder dunkel',
  'type.scheme.inherit': 'Wie die Instanz',
  'type.scheme.light': 'Hell',
  'type.scheme.dark': 'Dunkel',
  'type.scheme.system': 'Wie das Gerät',
  'type.corners': 'Ecken',
  'type.corners.note':
    'Drei Stufen statt einer Zahl: alle drei Radien bewegen sich zusammen, ' +
    'damit ein kleines Bedienelement nicht versehentlich zur Pille wird.',
  'type.corners.sharp': 'Scharf',
  'type.corners.soft': 'Wie entworfen',
  'type.corners.round': 'Rund',

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
  'landing.top': 'Die oberste Seite',
  'landing.top.hint': 'Die erste im Baum. Ändert sich, wenn jemand umsortiert.',
  'landing.newest': 'Die zuletzt bearbeitete Seite',
  'landing.newest.hint': 'Dort, wo gerade gearbeitet wird — nicht die zuletzt angelegte.',
  'landing.page': 'Seite',
  'landing.choose': 'Eine Seite wählen…',
  // --- und die eigene Abweichung (ADR-0119) ------------------------------
  'landing.mine':
    '{address, select, formal {Für Sie} other {Für dich}}',
  'landing.mine.note':
    'Gilt nur {address, select, formal {für Sie} other {für dich}} und nur in diesem ' +
    'Workspace. Alle anderen folgen weiter dem, was oben steht.',
  'landing.follow': 'Wie der Workspace',
  'landing.follow.hint': 'Zurzeit: {what}',

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
  'move.heading': '„{title}" verschieben',
  'move.title': 'Verschieben nach',
  'move.root': 'Wurzel des Workspace',
  'move.find': 'Ordner suchen',
  'move.noMatch': 'Kein Ordner passt.',

  'action.saving': 'Wird gespeichert…',
  'theme.reset': '{name} zurücksetzen',
  'theme.elementSize': '{element}: Größe',
  'theme.elementColour': '{element}: Farbe',
  'theme.elementSpaceAbove': '{element}: Abstand darüber',
  'theme.elementSpaceBelow': '{element}: Abstand darunter',
  'action.saved': 'Gespeichert.',

  // --- der Papierkorb ----------------------------------------------------
  'trash.title': 'Papierkorb',
  'trash.group.when': 'Ansicht',
  'trash.group.kind': 'Nach Art',
  'trash.view.recent': 'Zuletzt gelöscht',
  'trash.view.expiring': 'Bald endgültig weg',
  'trash.view.pages': 'Seiten',
  'trash.view.folders': 'Ordner',
  // Nur die Aufbewahrung: welcher Workspace steht seit ADR-0114 im Wähler
  // darüber, und zweimal derselbe Name in zwei Zeilen liest sich wie zwei
  // verschiedene Angaben.
  'trash.scope': '30 Tage aufbewahrt',
  'trash.daysLeft': '{count, plural, one {noch # Tag} other {noch # Tage}}',
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
  'trash.search': 'Im Papierkorb suchen',
  'trash.emptyView': 'In dieser Ansicht ist nichts.',
  'trash.noMatch': 'Nichts heißt „{query}".',
  'trash.deletedAt': 'gelöscht am {at}',
  'trash.withInside':
    '{count, plural, one {mit # Eintrag darin} other {mit # Einträgen darin}}',
  'trash.folderGone': 'der Ordner darüber ist weg',
  'trash.read': 'Hineinschauen',
  'trash.hide': 'Zuklappen',
  'trash.unreadable': 'Der Inhalt lässt sich gerade nicht lesen.',
  'trash.nothingInIt': 'Kein Text darin.',
  'trash.andMore': '… und weiter.',
  'trash.restoreTo': 'Wiederherstellen nach…',
  'trash.restoreTitle': '„{title}" wiederherstellen nach',
  'trash.parentGone':
    'Der Ordner, in dem das lag, wurde ebenfalls gelöscht. Wähle, wo es wieder ' +
    'auftauchen soll.',

  // --- Suche -------------------------------------------------------------
  'search.title': 'Suche',
  // --- Filter im Suchmodus (ADR-0118) ---------------------------------------
  'search.saved': 'Gemerkt',
  'search.facet.tags': 'Schlagwörter',
  'search.facet.findTag': 'Schlagwort suchen',
  'search.facet.findTagPlaceholder': 'Schlagwort eingeben…',
  'search.facet.people': 'Leute',
  'search.facet.who': 'Person suchen',
  'search.facet.whoPlaceholder': 'Name eingeben…',
  'search.facet.assignedMe': '{address, select, formal {Ihnen zugewiesen} other {Dir zugewiesen}}',
  'search.facet.writtenBy': 'Von {name}',
  'search.facet.in': 'Im Ordner',
  'search.facet.anywhere': 'Überall',
  'search.facet.when': 'Zuletzt bearbeitet',
  'search.facet.after': 'Ab',
  'search.facet.before': 'Bis',
  'search.facet.clear': 'Filter zurücksetzen',
  'search.field': 'Seiten suchen',
  'search.placeholder': 'Seiten suchen…',
  'search.folders': 'Ordner',
  'search.pages': 'Seiten',
  'search.chip.tag': 'Schlagwort {value}',
  'search.chip.in': 'In {value}',
  'search.chip.inMany': 'In {value} · {count} Ordner',
  'search.chip.inNone': 'In {value} · kein solcher Ordner',
  'search.chip.author': 'Von {value} geschrieben',
  'search.chip.assignedMe': 'Mir zugewiesen',
  'search.chip.assigned': 'Zugewiesen an {value}',
  'search.chip.after': 'Bearbeitet am oder nach {value}',
  'search.chip.before': 'Bearbeitet am oder vor {value}',
  'search.chip.notADate': 'Kein Datum. Format JJJJ-MM-TT.',
  'search.keep': 'Diese Suche behalten',
  'search.nameIt': 'Wie soll sie heißen',
  'search.forget': '{name} verwerfen',
  'search.syntax':
    'Eingrenzen mit tag:name, in:ordner, author:name, assigned:me, ' +
    'after:2026-08-01 oder before:2026-09-01. Ein Filter allein genügt auch.',
  'search.nothing': 'Nichts gefunden.',
  'search.didYouMean': 'Vielleicht',
  'search.similar': 'Ähnliche Namen',
  'search.matchedTitle': 'Name',

  // --- eine Tabelle mit Einträgen ----------------------------------------
  'table.emptyTitle': 'Jeden Eintrag dieser Kollektion in den Papierkorb legen',
  'table.confirmEmpty':
    'Jeden Eintrag dieser Kollektion in den Papierkorb legen? Jeder ist eine ' +
    'Seite, es wird also nichts vernichtet — sie lassen sich aus dem ' +
    'Papierkorb oder mit Rückgängig zurückholen.',
  'board.allSorted': 'Alles ist einsortiert.',
  'board.emptyColumn': 'Hier noch nichts.',
  'board.noneLoaded': 'Keine der geladenen Zeilen. Es kann mehr geben.',
  'table.countOf': '{shown} von {total} Zeilen',
  'table.countMany': '{shown} Zeilen, von mehr als 10 000',
  'table.more': 'Mehr Zeilen zeigen',
  'table.sortedWhole':
    'Nach einer berechneten Spalte sortiert, dafür wurden alle Zeilen gelesen. ' +
    'Andere Sortierungen laden seitenweise.',
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
  'table.groupBy': 'Nach {field} gruppieren',
  'table.selectNone': 'Auswahl aufheben',
  'table.selectAll': 'Alle gezeigten Einträge auswählen',
  'table.nameColumn': 'Name',
  'table.selectEntry': '{title} auswählen',
  'table.openEntry': '{title} öffnen',
  'table.thisEntry': 'diesen Eintrag',
  'table.renameColumn': 'Spalte {field} umbenennen',
  'table.editOptions': 'Optionen von {field} bearbeiten',
  'table.removeColumn': 'Spalte {field} entfernen',
  'table.titleColumn': 'Jeder Eintrag hat einen Titel',
  'table.name': 'Name',
  'table.untitled': 'Ohne Titel',
  'option.colourFor': 'Farbe für {option}',
  'option.remove': '{option} entfernen',
  'option.thisOne': 'diese Option',
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
  'role.owner': 'Eigentümer',
  'role.owner.hint': 'Darf den Workspace übertragen und löschen',
  'access.add': 'Zugriff geben',
  'access.note':
    'Für Leute, die auf diesem Server schon ein Konto haben. Wer noch keines ' +
    'hat, wird in der Verwaltung eingeladen — das legt ein Konto an und ist ' +
    'eine andere Sache.',
  'access.example': 'jemand@example.org',
  'access.address': 'E-Mail-Adresse',
  'access.address.hint': 'Die Adresse, mit der sich die Person hier anmeldet.',
  // --- jemanden finden statt eine Adresse tippen (ADR-0119) -----------------
  'access.person': 'Person',
  'access.person.hint': 'Name oder E-Mail-Adresse. Ab zwei Zeichen kommen Vorschläge.',
  'access.alreadyHere': 'ist schon dabei',
  'access.willAdd': '{name} ({email}) bekommt Zugriff.',
  'access.as': 'Kommt herein als',
  'access.give': 'Zugriff geben',
  'access.given': '{email} hat jetzt Zugriff.',
  'error.no_such_account':
    'Mit dieser Adresse gibt es hier kein Konto. Neue Leute lädt die Verwaltung ein.',
  'error.already_member': 'Diese Person ist bereits in diesem Workspace.',
  'error.invalid_email': 'Bitte eine E-Mail-Adresse eintragen.',
  'member.roleFor': 'Rolle von {name}',
  'role.member': 'Mitglied',
  'role.member.hint': 'Darf alles lesen und schreiben, was nicht beschränkt ist',
  'role.admin': 'Admin',
  'role.admin.hint': 'Darf außerdem Leute und Rechte verwalten',
  'role.guest': 'Gast',
  'role.guest.hint': 'Sieht nur, worauf ausdrücklich Zugriff gegeben wurde',
  'access.viewer': 'Darf lesen',
  'access.commenter': 'Darf lesen und kommentieren',
  'access.editor': 'Darf bearbeiten',
  'access.admin': 'Darf verwalten',

  // --- das Block-Menü ----------------------------------------------------
  'block.insert': 'Block einfügen',
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
  'block.actions.counted':
    'Was mit diesem Block geschehen soll ({count, plural, one {# Block} ' +
    'other {# Blöcke}} samt Kindern)',
  'block.appliesToNested':
    'Gilt für diesen Block und {count, plural, one {# verschachtelten Block} ' +
    'other {# verschachtelte Blöcke}}',
  'block.actions': 'Was mit diesem Block geschehen soll',
  'block.moveUp': 'Nach oben',
  'block.moveDown': 'Nach unten',
  'block.outdent': 'Ausrücken',
  'block.indent': 'Einrücken',
  'block.duplicate': 'Duplizieren',
  'block.assignee': 'Zugewiesen an',
  'block.assignee.nobody': 'Niemanden',
  'block.lock': 'Diesen Baustein sperren',
  'block.unlock': 'Diesen Baustein entsperren',
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
  'diff.whatThisDid': 'Was diese Fassung geändert hat',
  'diff.sinceThen': 'Seitdem geändert',
  'diff.added': 'Hinzugefügt',
  'diff.removed': 'Entfernt',
  'diff.changed': 'Neu geschrieben',
  'diff.moved': 'Verschoben',
  'diff.movedFrom': 'von Position {from} nach {to}',
  'diff.empty': '(leer)',
  'diff.nothing': 'Nichts hat sich geändert.',
  'diff.compare': 'Vergleichen',
  'diff.noFormatting':
    'Fett, kursiv und Links werden nicht verglichen \u2014 nur die Worte.',
  'diff.approximate':
    '{count} Bausteine konnten zwischen den Fassungen nicht zugeordnet werden; ' +
    'für diese ist der Vergleich ungefähr.',
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
  'comment.unknownAuthor': 'Jemand, der nicht mehr dabei ist',
  'comment.startInternal': 'Nur für Mitglieder — ein Freigabe-Link liest das nicht',
  'comment.viaEmail': 'per E-Mail',
  'comment.viaEmail.hint':
    'Das kam als Antwort auf eine Benachrichtigung. SONE hat den zitierten Teil ' +
    'entfernt.',
  'comment.trimmed': 'gekürzt',
  'comment.attachmentsDropped': 'Anhänge nicht übernommen',
  'comment.internal': ' · intern',
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
  'comment.collapse': 'Diesen Verlauf zuklappen',
  'comment.expand': 'Diesen Verlauf öffnen',
  'comment.collapseAll': 'Alle zuklappen',
  'comment.expandAll': 'Alle öffnen',
  'comment.markStyle': 'Wie sie markiert werden',
  'comment.mark.highlight': 'Farbig hinterlegt',
  'comment.mark.underline': 'Unterstrichen',
  'comment.mark.off': 'Gar nicht',
  'comment.start': 'Kommentieren',
  'comment.aboutItem': 'Zu einem Element auf der Fläche',
  'comment.aboutPlace': 'Auf Seite {page} des Dokuments',
  'comment.placeGone': 'Das Dokument, um das es ging, wird auf dieser Seite nicht mehr gezeigt.',
  'comment.startPlaceholder': 'Was ist damit?',
  'panel.guest': 'Gast',
  'panel.guestWriting':
    'Ein Teil davon entstand, bevor diese Seite mitgeschrieben hat — oder von ' +
    'jemandem, der gar keinen Namen angegeben hat.',
  'panel.noPeople':
    'Noch niemand verzeichnet. Geschriebenes wird von dem Moment an zugeordnet, in dem ' +
    'es geschrieben wird — was vor Beginn dieser Aufzeichnung getippt wurde, steht hier ' +
    'nicht.',
  'panel.people.marked':
    'Was diese Person geschrieben hat, ist in der Seite markiert. Noch einmal ' +
    'anklicken hebt die Markierung auf.',
  'panel.people.choose':
    'Jemanden anklicken, um zu sehen, was von ihm oder ihr in der Seite steht. Hier ' +
    'steht, wer geschrieben hat — nicht, wer gerade da ist; das zeigen die Kreise oben.',
  'panel.people.departed': 'Jemand, der nicht mehr dabei ist',

  // --- ein Titelbild (ADR-0117) --------------------------------------------
  'cover.add': 'Titelbild',
  'cover.change': 'Titelbild ändern',
  'cover.remove': 'Entfernen',
  'cover.upload': 'Bild hochladen',
  'cover.uploading': 'Wird hochgeladen…',
  'cover.colors': 'Farbe',
  'cover.gradients': 'Farbverlauf',
  'cover.own': 'Eigene Farbe',
  'cover.width': 'Breite',
  'cover.height': 'Höhe',
  'cover.height.slim': 'Schmal',
  'cover.height.medium': 'Mittel',
  'cover.height.tall': 'Hoch',
  // --- eine Fläche (ADR-0043) ---------------------------------------------
  'canvas.commented': '{count, plural, one {Ein Kommentar} other {# Kommentare}}',
  'canvas.commentedInternal':
    '{count, plural, one {Ein Kommentar} other {# Kommentare}}, {internal} davon ' +
    'nur für Mitglieder',
  'canvas.tools': 'Werkzeuge',
  'canvas.tool.select': 'Auswählen',
  'canvas.tool.hand': 'Blatt verschieben',
  'canvas.tool.pen': 'Stift',
  'canvas.tool.text': 'Text',
  'canvas.remove': 'Das hier entfernen',
  'canvas.handle': 'Was damit geschehen soll',
  'canvas.comment': 'Dazu kommentieren',
  'canvas.duplicate': 'Duplizieren',
  'canvas.lock': 'Festsetzen',
  'canvas.unlock': 'Lösen',
  'canvas.toFront': 'Nach vorn holen',
  'canvas.textItem': 'Text auf der Fläche',
  'canvas.resize': 'Größe ändern',
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
  'panel.untitledFile': 'Datei ohne Namen',
  'panel.thisFile': 'diese Datei',
  'panel.showThisInPage': '{filename} in der Seite zeigen',
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
  'panel.linkRefused': 'Diese Adresse lässt sich nicht öffnen',
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
  // Ein Befehl, kein Satz -- gleich in beiden Sprachen, aber im Katalog,
  // weil sonst Englisch im Markup steht.
  'auth.setup.keyCommand': 'docker compose logs sone',
  'auth.setup.key': 'Einrichtungsschlüssel',
  'auth.setup.keyWhere': 'Der Server hat ihn beim Start ausgegeben: ',
  'auth.setup.keyLife': 'Er gilt für dieses eine Konto und wechselt bei jedem Neustart.',
  'error.invalid_setup_key': 'Der Einrichtungsschlüssel stimmt nicht. Er steht im Protokoll des Servers.',
  'auth.setup': 'SONE einrichten',
  'auth.setup.note':
    'Das legt den ersten Workspace und seinen Besitzer an. Es geht nur ein Mal.',
  'auth.workspaceName': 'Name des Workspace',
  'auth.yourName': '{address, select, formal {Ihr Name} other {Dein Name}}',
  'reset.forgot': 'Passwort vergessen?',
  'reset.askTitle': 'Neues Passwort setzen',
  // Beugt sich nach der Anredeform (ADR-0041): die Anmeldeseite spricht jemanden
  // an, und eine Instanz, die „Sie" gewählt hat, darf hier nicht duzen.
  'reset.askHint':
    'Die Adresse eingeben, mit der {address, select, formal {Sie sich anmelden} ' +
    'other {du dich anmeldest}}. Hat sie ein Konto, ist ein Link unterwegs — er ' +
    'gilt eine Stunde und einmal.',
  'reset.ask': 'Link senden',
  'reset.asking': 'Wird gesendet…',
  'reset.askedTitle': 'Ins Postfach sehen',
  'reset.askedHint':
    'Hat diese Adresse hier ein Konto, ist ein Link unterwegs. Er gilt eine ' +
    'Stunde. Bis er benutzt wird, hat sich nichts geändert.',
  'reset.setTitle': 'Neues Passwort wählen',
  'reset.setHint':
    'Mindestens 12 Zeichen. Alle Anmeldungen werden beendet, auch diese hier.',
  'reset.newPassword': 'Neues Passwort',
  'reset.set': 'Passwort setzen',
  'reset.setting': 'Wird gespeichert…',
  'reset.done': 'Das Passwort ist gesetzt',
  // Ohne Anrede formuliert, damit sie in beiden Formen stimmt.
  'reset.done.hint':
    'Alle Sitzungen wurden beendet — mit dem neuen Passwort neu anmelden.',
  'reset.toSignIn': 'Zur Anmeldung',
  'reset.backToSignIn': 'Zurück zur Anmeldung',
  'auth.secondFactor': 'Noch ein Schritt',
  'auth.secondFactor.hint':
    'Den sechsstelligen Code aus der Authenticator-App eingeben.',
  'auth.code': 'Code',
  'auth.checking': 'Wird geprüft…',
  'auth.secondFactor.lost':
    'App verloren? Dann einen der Wiederherstellungscodes benutzen. Sind auch ' +
    'die weg, kann die Betreiberin dieser Instanz den zweiten Faktor entfernen.',
  'error.unknown_account': 'Dieses Konto gibt es nicht.',
  'error.page_not_found': 'Diese Seite gibt es nicht.',
  'error.second_factor_required':
    'Diese Instanz verlangt jetzt die Anmeldung in zwei Schritten. Zum ' +
    'Weitermachen einen Authenticator einrichten.',
  'error.enrol_yourself_first':
    'Erst auf dem eigenen Konto einen Authenticator einrichten, bevor er von ' +
    'allen verlangt wird.',
  'error.one_archive_at_a_time':
    'Entweder ein Archiv oder mehrere Markdown-Dateien wählen, nicht beides.',
  'error.too_many_to_pack': 'Das sind mehr Dateien, als der Import auf einmal packt.',
  'error.too_many_entries':
    'Dieses Archiv enthält mehr Dateien, als der Import auf einmal liest. ' +
    'Aufteilen, oder einen Ordner nach dem anderen importieren.',
  'error.zip64_unsupported':
    'Dieses Archiv liegt im Zip64-Format, das der Import nicht lesen kann. ' +
    'Neu erstellen mit gewöhnlichem zip hilft meist.',
  'error.wrong_code': 'Dieser Code stimmt nicht.',
  'error.code_already_used':
    'Dieser Code wurde bereits benutzt. Auf den nächsten warten.',
  'error.ticket_expired': 'Das hat zu lange gedauert. Bitte neu anmelden.',
  'error.already_enrolled': 'Auf diesem Konto liegt schon ein Authenticator.',
  'error.no_enrolment': 'Nichts zu bestätigen. Bitte neu beginnen.',
  'error.wrong_password': 'Dieses Passwort stimmt nicht.',
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
  'auth.sso': 'Single Sign-on',
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
  'error.missing_fields': 'Bitte alle Felder ausfüllen.',
  'error.invitation_invalid': 'Diese Einladung ist abgelaufen oder schon benutzt.',
  'error.no_workspace':
    '{address, select, formal {Ihr Konto ist} other {Dein Konto ist}} noch in keinem ' +
    'Workspace Mitglied.',
  'error.network_error': 'Der Server ist nicht erreichbar.',
  'error.invalid_role': 'Ein Freigabe-Link kann diese Rolle nicht vergeben.',
  'error.too_many_rows': 'Das sind mehr als fünfzig Einträge. Bitte in kleineren Stücken einfügen.',
  'error.not_archived': 'Dieser Eintrag ist nicht im Papierkorb.',
  'error.no_text': 'Da steht nichts zum Senden.',
  'error.thread_gone':
    'Dieses Gespräch gibt es nicht mehr — es wurde gelöscht, während die Zeile hier stand.',
  'error.invalid_time':
    'Dieser Zeitpunkt geht nicht: er muss in der Zukunft liegen und höchstens ein ' +
    'Jahr entfernt sein.',
  'error.invalid_parent':
    'Dorthin kann dieser Eintrag nicht: ein Ordner kann nicht in sich selbst liegen.',
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
