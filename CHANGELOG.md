# Changelog

Entries describe what an operator or user experiences, not what changed in the
code — `git log` already records that. Any required operator action is named
first; if there is none, the entry says so.

Versioning follows [ADR-0013](docs/adr/0013-versioning-and-releases.md): the
version answers "what must I do to upgrade?", not "how much changed?".

- **PATCH** — pull and restart, nothing else.
- **MINOR** — pull and restart; migrations run automatically.
- **MAJOR** — read this file first, there is something to do.

## Unreleased

**Behoben: die beiden Knöpfe auf einem randlosen Titelbild ließen sich nicht
anklicken** — sie lagen im Streifen der oberen Leiste, und die nimmt dort jeden
Klick entgegen. Sie stehen jetzt darunter und außerdem an der Ecke des *Bildes*
statt an der Kante der Textspalte, wo sie mitten im Bild schwebten.

**Behoben: mit ausgeblendeter Seitenleiste begann ein randloses Titelbild nicht
mehr ganz oben.** Ohne Seitenleiste zeigt eine Seite ihren Pfad („Ordner 1 /
…"), und der stand über dem Bild und hat es um seine eigene Höhe nach unten
geschoben. Der Pfad steht jetzt unter dem Bild und über dem Titel — wo er sich
auch besser liest: erst die Ordner, dann der Name.

**Und eine dritte Stufe: randlos bis an den oberen Rand.** In derselben Zeile
steht jetzt *Spalte*, *Ganze Seite* und *Randlos* — bei der letzten beginnt das
Bild dort, wo das Fenster beginnt, und die obere Leiste liegt darauf. Damit
Knöpfe, *Synced* und die Kürzel der Mitlesenden auf einem Foto lesbar bleiben,
bekommt jedes dieser Bedienelemente dieselbe Fläche unter sich, die es auf der
schmalen Leiste beim Drüberfahren hat: über einem Bild lässt sich keine lesbare
Farbe berechnen, also bringt jedes Element seinen eigenen Untergrund mit. Beim
ersten Scrollen füllt sich die Leiste wieder, wie sie es immer tut.

Das Bild wächst dabei genau um das, was es sich nimmt — die Überschrift und der
Text darunter bleiben, wo sie waren. Und wenn oben ein Hinweis steht (etwa dass
der Browser eine ältere Version geladen hat), bleibt *Randlos* aus: der Hinweis
ist wichtiger als das Foto.

**Das Titelbild hat jetzt eine Breite und eine Höhe.** Im selben Menü, in dem es
gewählt wird, stehen zwei Zeilen: *Spalte* oder *Ganze Seite*, und *Schmal*,
*Mittel* oder *Hoch*. Über die ganze Seite läuft das Bild von Kante zu Kante und
lässt dabei die abgerundeten Ecken und den feinen Rahmen weg — was bis an beide
Ränder geht, hat kein Ende, das man markieren müsste. Auf einem schmalen Bildschirm
bleibt alles wie es ist, dort gibt es keinen Rand, in den etwas ausbrechen könnte.

Wer nichts einstellt, sieht genau das, was er bisher gesehen hat: *Spalte* und
*Mittel* sind nicht gespeicherte Werte, sondern das, was ein Titelbild tut, wenn
es nichts dazu sagt. Gilt für Seiten und für Ordner.

## 0.12.3

Pull and restart, sonst ist nichts zu tun. Keine Migration.

**Links im Text lassen sich jetzt öffnen.** Wer eine Seite nur liest, klickt
einen Link an und er geht in einem neuen Tab auf. Beim Schreiben bleibt der
einfache Klick, was er war — er setzt den Cursor ins Wort, sonst wäre ein Link
eine Stelle, die niemand mehr korrigieren kann. Stattdessen erscheint über dem
Link eine kleine Karte: die Adresse, und *Öffnen*, *Adresse kopieren*, *Ändern*,
*Entfernen*. Mit `Cmd`- beziehungsweise `Strg`-Klick geht er auch beim Schreiben
direkt auf.

**Und dabei ist ein Loch aufgefallen: eingefügte Links wurden nicht geprüft.**
Eine getippte Adresse mit `javascript:` wurde seit jeher abgelehnt — eine
*eingefügte* nicht. Wer HTML mit so einem Link in eine Seite kopiert hat, hatte
ihn danach in der Seite stehen, für alle, die sie öffnen. Jetzt wird beim
Einfügen dasselbe geprüft: der Text bleibt, der Link fällt weg.

**Die Linkliste rechts kann jetzt, was die Karte im Text kann.** Neben jedem
Link steht ein Knopf, der die Adresse kopiert — auch bei einer Adresse, die sich
nicht öffnen lässt: die ansehen zu wollen ist ein guter Grund. Und die Liste
prüft die Adresse jetzt selbst: ein Link mit `javascript:` steht weiter in der
Liste, mit Text und Adresse, aber er ist nichts, worauf man klicken kann. Eine
Liste, die einen Link der Seite stillschweigend weglässt, wäre eine falsche
Liste.

**Ein Klick auf das Zitat bringt dich zur Stelle im PDF.** Bisher tat der Knopf
in der Kommentarleiste bei einem PDF-Kommentar schlicht nichts. Jetzt scrollt das
Dokument zur richtigen Seite, der Block rückt ins Bild, und die gemeinte
Markierung leuchtet kurz auf — kräftiger gefüllt und mit einem Ring, damit auf
einer Seite mit mehreren Markierungen klar ist, welche gemeint war. Wer weniger
Bewegung eingestellt hat, bekommt den Ring ohne das Pulsieren: welche Stelle
gemeint ist, ist eine Information und keine Verzierung.

**Ein Kommentar zu einer Stelle im PDF sagt jetzt, wenn das Dokument nicht mehr
da ist.** Bisher stand der Faden in der Leiste, zitierte eine Stelle, bot einen
Knopf an, der nichts tat, und schwieg dazu. Jetzt steht darunter: *„Das
Dokument, um das es ging, wird auf dieser Seite nicht mehr gezeigt."* — egal ob
der Datei-Block gelöscht, auf eine andere Seite verschoben oder wieder auf
*Karte* gestellt wurde. Alle drei lassen den Lesenden an derselben Stelle
stehen. Das Zitat bleibt, denn es ist das Einzige, woran der Faden noch zu
erkennen ist.

## 0.12.2

Pull and restart, sonst ist nichts zu tun. Keine Migration.

**Eine Stelle im PDF kann jetzt ein Kommentar sein.** In einem PDF im Dokument
lässt sich Text auswählen; über der Auswahl erscheint *Kommentieren*, und der
Faden hängt anschließend an genau dieser Stelle — Seite und Rechtecke in den
Maßen des Dokuments, nicht in Bildschirmpunkten. Wo schon jemand kommentiert
hat, liegt eine Markierung auf der Seite, in derselben Farbe wie eine
kommentierte Stelle im Fließtext. Die Markierung sitzt richtig, egal wie breit
die Spalte gerade ist.

Zwei Fehler sind dabei aufgefallen, beide ohne PDF-Bezug: auf einer Seite mit
geschütztem Abschnitt haben sich die Markierungen im Fließtext gegenseitig
überschrieben, weil zwei Kommentardokumente dieselbe Meldung benutzt haben; und
ein Kommentarfaden ohne Textstelle wäre in keiner der drei Gruppen der
Kommentarleiste aufgetaucht.

**Und markieren, ohne etwas dazu zu sagen.** Neben *Kommentieren* steht jetzt
*Markieren*: der Textmarker, ohne Faden. Wo schon markiert ist, heißt derselbe
Knopf *Markierung entfernen* — die Stelle noch einmal auswählen genügt, ungefähr
reicht. Eine markierte Stelle liegt in derselben Farbe auf der Seite wie eine
kommentierte, nur heller: das eine wird besprochen, das andere ist einen zweiten
Blick wert. Markieren braucht ein Konto; über einen Freigabe-Link lässt sich eine
Stelle kommentieren, was ohnehin mehr sagt.

**Und das Ganze als Datei mitnehmen.** In der Leiste über dem Dokument steht ein
Pfeil: er erzeugt eine Kopie, in der die Markierungen und Kommentare als echte
PDF-Anmerkungen stehen — lesbar in Acrobat, in der Vorschau, überall.
Kommentierte Stellen bringen das Gespräch als Notiz mit (zugeklappt, damit sie
den Text nicht verdecken), bloß markierte Stellen bringen nichts mit. Die Farbe
ist die, die gerade auf dem Bildschirm zu sehen ist. Die Kopie heißt wie das
Original mit „mit Markierungen" dahinter, und das Original bleibt Byte für Byte
darin stehen — angehängt, nicht neu geschrieben. Der Knopf erscheint nur, wenn es
etwas einzutragen gibt.

Für diesen einen Knopf gilt eine höhere Browser-Untergrenze als für alles andere:
das Schreiben läuft im Worker der PDF-Bibliothek, und die verlangt dort
Chrome/Edge ab 138, Firefox ab 141 oder Safari 26. Ältere Browser zeigen und
kommentieren das Dokument weiterhin; nur die Kopie entsteht dann nicht, und die
Konsole sagt warum.

**Behoben: das Logo wechselte, sobald der Zeiger darauf lag.** Gemeldet bei
grüner Leiste mit beiden Marken: *„Wenn ich auf das Logo drauf klicke wird es
dunkel."* Die Schaltfläche färbt sich unter dem Zeiger etwas heller, und bei
einer akzentfarbenen Leiste reicht dieser Schritt gerade über die Grenze
zwischen hell und dunkel — die Marke für weißes Papier landete auf Grün.
Gemessen: die Leiste bei Helligkeit 0,164, ihre Hover-Fläche bei 0,229, die
Grenze bei 0,216. Der Zustand einer Schaltfläche ist jetzt kein Untergrund mehr.

## 0.12.1

Pull and restart, sonst ist nichts zu tun. Keine Migration.

**Ein Logo für helle Flächen, eines für dunkle — und die Fläche entscheidet
selbst.** Wer die schmale Leiste in einem Workspace einfärbt, hatte bisher die
Wahl zwischen einer Marke, die dort lesbar ist, und einer, die überall sonst
lesbar ist. Unter Verwaltung → Erscheinung lassen sich jetzt zwei hochladen, je
mit einer Vorschau auf dem Grund, für den sie gedacht ist; welche gezeichnet
wird, misst die Marke an der Farbe, die tatsächlich hinter ihr liegt — nicht am
Hell-oder-Dunkel der Instanz, denn die Leiste, um die es geht, hat ein Workspace
eingefärbt. Ist nur eine hochgeladen, gilt sie überall wie bisher.

## 0.12.0

Pull and restart. 21 Migrationen laufen von selbst; sonst ist nichts zu tun.

Rechte und Rollen, Freigaben, Benachrichtigungen, das Gestaltungssystem, die
Mails und die deutsche Oberfläche — der größte Sprung seit 0.9. Was unten steht,
ist absichtlich nach dem geordnet, was man merkt, nicht danach, wann es gebaut
wurde.

**Die Kontenliste in der Verwaltung hat jetzt Spalten.** Zwei Schalter und zwei
Knöpfe lagen in einem einzigen umbrechenden Streifen, also ordnete sich jede
Zeile anders als die darüber und nichts stand untereinander. Jetzt: wer sie sind,
was sie sind, was man mit ihnen tun kann — drei Spalten, die über die ganze Liste
hinweg an derselben Stelle stehen, und auf einem schmalen Bildschirm ein Stapel.

**Bei den Einladungen stehen keine verbrauchten mehr, und die Anzahl ist jetzt
eine Entscheidung.** Ein Link galt bisher unsichtbar für fünfundzwanzig Leute —
eine Zahl, die niemand gewählt hatte und die trotzdem in der Zeile stand. Beim
Anlegen wird jetzt gefragt, für wie viele der Link gelten soll (Standard: einer);
bei einer Einladung an eine Adresse wird nicht gefragt, weil sie für diese Person
gilt und einmal. Der Zähler steht nur noch dort, wo er etwas aussagt.

**Wer seinen eigenen Einladungslink ein zweites Mal anklickt, kommt an, statt
abgewiesen zu werden.** Das war als Verhalten vorgesehen und funktionierte nur,
solange jeder Link mehrfach nutzbar war. Ein verbrauchter Link lässt weiterhin
niemanden Neues herein.

**Der Einladungs-Bildschirm behauptet nicht mehr, diese Instanz verschicke keine
Mail.** Der Satz stand dort unabhängig davon, ob ein Mailserver eingerichtet ist
— und die Einladung wird längst verschickt. Jetzt steht dort, was tatsächlich
passiert ist: an welche Adresse sie ging, oder dass der Link selbst
weitergegeben werden muss.

**Die Oberfläche ist vollständig auf Deutsch, bis in die Ecken.** Hundertdreißig
Zeichenketten standen noch auf Englisch da, die meisten davon an Stellen, die man
nicht sieht: Beschriftungen für Screenreader, Titel beim Darüberfahren, Sätze,
die ein eingebettetes Codewort zerteilt hatte. Auch Zählungen sind jetzt richtige
Sprache statt „1 Ordner / 2 Ordner" mit angehängtem s.

**Rollennamen werden übersetzt — auf dem Bildschirm und im Brief.** „Owner",
„Guest" und die beiden anderen sind Wörter, die eine Migration eingetragen hat,
keine gewählten Namen; ein deutscher Brief las trotzdem „Sie sind jetzt Guest".
Selbst vergebene Rollennamen bleiben unangetastet.

**Alle E-Mails sprechen die Sprache ihres Empfängers und die Anrede der
Instanz.** Zwölf Briefe waren fest auf Englisch, obwohl die Sprache jedes
Empfängers gespeichert ist. Ob die Oberfläche „du" oder „Sie" sagt, ist eine
Einstellung der Instanz und gilt jetzt auch für die Post.

**Das Fenster scrollt nicht mehr als Ganzes.** Bei einem langen Seitenbaum und
viel Inhalt gab es zwei Scrollbalken übereinander, und das Profilbild in der
schmalen Leiste rutschte aus dem Bild. Jede Spalte scrollt jetzt für sich. Die
Scrollbalken sind außerdem schmal, und in einer dunklen Oberfläche sind sie
dunkel — auch auf einem hell eingestellten Rechner.

**Eine Rollenkarte sagt, wer die Rolle hält, mit Namen.** Bisher stand dort eine
Anzahl, also musste man auf einen anderen Bildschirm, um zu sehen, wen eine
Änderung trifft. Die Namen bekommt nur zu sehen, wer Leute verwalten darf; für
alle anderen bleibt es bei der Zahl.

**Jede Liste, die unter einem Eingabefeld aufgeht, lässt sich mit der Tastatur
bedienen.** Personensuche, Schlagwortfeld, die beiden `@`-Menüs und die zwei
Felder im Suchpanel: Pfeile, Enter, Escape — überall dasselbe, und die Maus hebt
nicht mehr eine zweite Zeile hervor, während die Tastatur eine andere meint.

**Die Suche zeigt bei vielen Schlagwörtern nicht mehr nur die ersten paar.** Zwölf
stehen als Knöpfe da, ausgewählt nach Gebrauch und alphabetisch sortiert; der
Rest ist über ein Suchfeld erreichbar. Ein gesetzter Filter wird immer angezeigt,
auch wenn er nicht unter den zwölf ist — vorher fiel er stillschweigend heraus
und der Ordner-Wähler zeigte „Überall", während die Treffer aus einem Ordner
kamen.

**Die Oberfläche hat eine Dichte-Einstellung.** Kompakt, normal, luftig — pro
Browser, weil sie vom Bildschirm und vom Zeiger handelt und nicht vom Konto. Auf
einem Touchgerät bleiben Tippziele groß, auch in kompakt.

**Farben sind jetzt nachgerechnet statt geschätzt.** Jede Kombination aus Theme,
Palette und Akzent wurde durchgerechnet; die schlechteste Paarung im gesamten
Farbraum liegt jetzt bei 4.52:1. Betroffen war unter anderem die stille Schrift
im dunklen Theme, und jede als Name gespeicherte Akzentfarbe bekam weiße Schrift
darauf, egal wie hell sie war. Fokusringe und Rahmen werden getrennt geprüft: für
eine Linie gilt eine andere Schwelle als für ein Wort.

**Eine Instanz kann ein eigenes Logo und ein Basis-Design bekommen**, und ein
Workspace baut darauf auf. Hell oder dunkel entscheidet jetzt das Konto, nicht
mehr der Workspace — wer an zwei Geräten arbeitet, wollte selten dieselbe
Antwort für beide.

**Ein Theme lässt sich als Datei sichern und einspielen**, und Schriften werden
als benanntes Paar gewählt statt als einzelne Familie.

**Alle Briefe tragen das Logo**, als eingebettetes Bild statt als Nachladung von
außen: kein Mailprogramm holt für eine SONE-Mail etwas aus dem Netz.

**Neue Briefe:** Zugriff entzogen, Rolle geändert, Einladung nie eingelöst,
Gast-Link läuft ab, Mailversand ausgefallen, Anmeldung von einem unbekannten
Browser, Willkommen, Export fertig — und Export nicht fertig geworden. Ein
fertiger Workspace-Export sagt jetzt Bescheid, statt in aller Stille abzulaufen,
während der Tab zu ist.

**Ein Freigabe-Link lässt sich per Mail verschicken**, ohne dass die Adresse des
Links durch die Anfrage reist. Ein gesetztes Passwort wird angekündigt und nie
mitgeschickt.

**Die Suche ist ein eigener Ort geworden:** Symbol in der schmalen Leiste, Filter
im linken Panel, Treffer in der Mitte. Das Feld im Seitenbaum ist ein Eingabefeld
statt eines Links.

**Seiten und Ordner können ein Titelbild bekommen** — eigener Upload, verkleinert
ausgeliefert, wahlweise auch eine Farbe oder ein Verlauf. Ohne gesetztes Bild
sieht alles aus wie vorher.

**Die Leute-Spalte einer Seite zeigt, wer geschrieben hat, nicht wer geschaut
hat.** Sie wirkte willkürlich — mal leer, mal ein Name, mal zwei — und war
vollkommen konsistent: sie beantwortete eine andere Frage als ihre Überschrift.

**Eine Benachrichtigung führt jetzt auch dann zur Seite, wenn man in einem
anderen Workspace steht.** Bisher kam an dieser Stelle die Meldung, man habe
keinen Zugriff.

**Der Freigaben-Bildschirm sagt, über welchen Workspace er redet**, und die drei
Listen vermischen sich nicht mehr. Ein Link, der in einem anderen Workspace
angelegt wurde, fehlte vorher scheinbar grundlos.

**Ein Freigabe-Link bleibt ein Freigabe-Link.** Eine Unterseite aus der
Ordnerliste heraus anzuklicken führte auf den Login, während dieselbe Seite über
die Seitenleiste normal aufging.

**Jemandem Zugriff geben ist ein Suchfeld mit Vorschlägen** statt eines
Adressfeldes, und die Rolle wird dabei mitgegeben. Wer schon ein Konto hat, wird
nicht mehr eingeladen, sondern hinzugefügt.

**Ein Gast bekommt keine Benachrichtigungen mehr über Seiten, die er nicht öffnen
darf.** Das betraf auch Suche, Kommentarliste, Vorlagen, Export und Digest — an
allen fünf Stellen sah ein Gast jede unbeschränkte Seite des Workspace.

**Ein Workspace-Export ist jetzt eine Sache der Verwaltung**, nicht jedes
Mitglieds. Und ein anonymer Aufruf auf einer Instanz ohne öffentliche Freigabe
bekommt „bitte anmelden" statt eines Serverfehlers.

**Ein Backup lässt sich nur mit dem Schlüssel zurückspielen, unter dem es
versiegelt wurde.** Freigabe-Tokens, Zweitfaktor-Geheimnisse und Mail-Antwort-
Tokens hängen an `SONE_SECRET_KEY`; ein Restore mit einem anderen Schlüssel
schlägt jetzt hörbar fehl, statt still eine Instanz herzustellen, in der diese
drei Dinge nicht mehr funktionieren.

**Die Markendateien liegen jetzt vollständig im Repo, unter `brand/`.** Logo in
vier Farbfassungen (hell, dunkel, einfarbig schwarz, einfarbig weiß), als Signet
und als Lockup mit und ohne Claim, dazu Favicon- und App-Icons, OG-Karten,
Druck-PDF, Briefbogen, Foliensatz und E-Mail-Signatur. Erzeugt werden sie von
`tools/brand/` aus derselben Geometrie, die `Logo.tsx` zeichnet, und denselben
Tokens, die `styles.css` deklariert — nachgezeichnet ist nichts. Die Wortmarke
ist in Pfade umgewandelt, keine gelieferte Datei braucht eine installierte
Schrift.

**Ein installiertes SONE verliert auf Android nicht mehr den obersten Balken.**
Das Icon hatte keine maskierbare Fassung, also hat Android das normale
zugeschnitten — und sein Kreis schneidet genau den breitesten Balken ab, den,
der die Marke als Baum lesbar macht. Neu: `icon-maskable-192.png` und
`icon-maskable-512.png` mit 26 % Rand, im Manifest als `maskable` eingetragen.

**Ein gesetztes Lesezeichen zeigt wieder ein Icon.** `/favicon.ico` fehlte;
Lesezeichenleisten, Windows-Verknüpfungen und ältere Feedreader fragen diesen
Pfad direkt ab, ganz ohne `<link>`, und bekamen eine 404 und ein leeres Blatt.

**Ein geteilter Link auf eine SONE-Instanz zeigt jetzt eine Karte.** Bisher
erschien in Chats und Messengern nur die nackte Adresse. Die Karte beschreibt
absichtlich die Software und nie die Seite: alles in einer Instanz liegt hinter
der Anmeldung, und eine Vorschau, die den Titel von jemandes Notizen mitschickt,
wäre ein Leck und kein Feature.

**Ein geteilter Ordner ist beim Gast wieder ein Ordner.** Er wurde als Seite mit
Schreibcursor gezeichnet — eine Einladung, in etwas zu schreiben, das keinen Text
aufnehmen kann, auf einem Link, der vielleicht nur lesen darf. Jetzt: die Liste
dessen, was drin liegt, ohne Umbenennen-Feld und ohne „Neue Seite".

**Gast-Kommentare tragen jetzt den Namen, den der Gast eingegeben hat.** Und der
Gast sieht den Namen des Mitglieds, das geantwortet hat, statt „Jemand, der nicht
mehr dabei ist". Beides war falsch, und beim Namen des Gastes doppelt: jede
Anfrage über den Freigabe-Cookie hat den gespeicherten Namen mit „Guest"
**überschrieben**.

**Eine Antwort eines Gastes hat die Projektion der ganzen Seite abgebrochen.**
Gemeldet als „eine Antwort auf einen Kommentar wird nicht eingetragen" — es war
schlimmer: ein Gast-Schlüssel in einer uuid-Spalte, mitten in der Transaktion,
die auch Kommentarzahlen, Blöcke und die Suchzeile schreibt. Und weil die
Nachricht im Dokument bleibt, scheiterte jede weitere Projektion derselben Seite
wieder — still und dauerhaft.

**Die Zahl sitzt jetzt an der Glocke, nicht am Profilbild**, und sie kommt aus
derselben Liste, die der Posteingang zeigt. Zahl und Inhalt frischen auf, sobald
man ins Fenster zurückkehrt. (Während man auf die Seite starrt, erscheint noch
nichts von selbst — das bräuchte einen Push, den es noch nicht gibt.)

**Ein gelöschter Kommentar nimmt seinen Eintrag in der Glocke mit.** Bisher blieb
er stehen und zeigte auf einen Faden, den es nicht mehr gibt.

**Der Freigaben-Bereich hat eine Seitenleiste.** Links, von mir, für mich als
drei Einträge mit Anzahl; das Ergebnis im Content. Vorher lag alles untereinander
und links war nichts.

**Kleinigkeiten:** der Zähler eines ausklappbaren Elements schrieb ab zehn über
den Text; im geteilten Seitenbaum fehlten Ordner-Symbole und -Farben, die der
Titel sehr wohl zeigte.

Nichts zu tun beim Aktualisieren.

**Erwähnungen landen jetzt in der Glocke.** Wer in einer Seite mit `@` genannt
wurde, bekam nichts — und zwar am zuverlässigsten dann, wenn er die Seite gerade
offen hatte.

Der Grund: eine Erwähnung wird dem, der sie geschrieben hat, nicht gemeldet, und
„wer sie geschrieben hat" wurde vom Sync-Raum geraten. Der merkt sich nämlich
nicht den letzten Schreiber, sondern den letzten, der überhaupt etwas geschickt
hat — und ein Leser, der die Seite öffnet, schickt etwas. Wer also gerade
draufschaute, während jemand ihn nannte, filterte seine eigene Erwähnung weg.
Und zwar dauerhaft.

Jetzt steht im Dokument selbst, wer den Namen gesetzt hat. Sich selbst zu nennen
bleibt eine Notiz an sich selbst.

**Die Glocke zählte außerdem anders als sie auflistet.** Eine Benachrichtigung
auf einer inzwischen gelöschten Seite wurde gezählt und nicht angezeigt —
„Abzeichen zwei, Liste leer".

**Und Textstellen einer Person werden jetzt wirklich hervorgehoben.** Im Reiter
„Personen" jemanden anzuwählen tat sichtbar nichts: die Stelle, die eine
Textposition in eine Editor-Position übersetzt, suchte das Falsche und fand nie
etwas. Es wurde also jedes Mal nichts markiert.

Nichts zu tun beim Aktualisieren.

**Wer eine Seite zum Kommentieren freigegeben bekommt, kann jetzt auch
kommentieren.** Klingt selbstverständlich und war es nicht: die Stufe
„Kommentieren" gab es in der Freigabe seit es Links gibt, und sie hat nie etwas
bewirkt — der Schreibschutz der Sync-Verbindung gilt für das ganze Dokument, und
darunter ging gar nichts. Das betraf **nicht nur Gäste**: auch ein Mitglied, dem
eine Seite mit „Kommentieren" gegeben wurde, konnte nichts sagen.

Jetzt: Text markieren, kommentieren, antworten — im Workspace und über einen
Freigabelink. Ein Gast unterschreibt mit dem Namen, den er beim Öffnen des Links
angegeben hat.

**Keine neue Freigabe-Option.** Die Stufe des Links sagt es schon: ein
Viewer-Link bekommt weder den Reiter noch den Knopf, ein Kommentar-Link beides.

Ein paar bewusste Grenzen: löschen darf weiterhin nur, wer die Seite bearbeiten
darf — auch die eigene Nachricht nicht, denn eine Nachricht, die man nach der
Antwort zurücknehmen kann, ist ein Gespräch, das sich umschreiben lässt.
Auflösen bleibt ebenfalls, wo es war. Und ein Gast kann niemanden per @ ansprechen:
er kann die Leute hier nicht kennen. Nötig ist es nicht — eine Antwort erreicht
ohnehin alle, die schon im Faden sind.

Wer eine Seite per Link freigegeben hat, wird über den ersten Faden eines
Besuchers benachrichtigt. Vorher hätte es niemand erfahren.

Namen in den Kommentaren sieht ein Gast nur von den Leuten, die auf **dieser
Seite** geschrieben haben — nicht die Mitgliederliste des Workspace.

Nichts zu tun beim Aktualisieren.

**Der Seitenbaum eines Freigabelinks ist jetzt eine Seitenleiste.** Er kam als
breites Menü quer über die Seite heraus — und sah außerdem aus wie ein zweites,
eigenes Ding neben dem Seitenbaum im Workspace. Jetzt ist es dieselbe
Seitenleiste: derselbe Kopf, dieselben Zeilen mit Symbolen, derselbe Knopf zum
Ein- und Ausklappen.

Ohne die schmale Symbolleiste am Rand: die führt zu Posteingang, Papierkorb,
Einstellungen und Konto, und davon hat jemand mit einem Link nichts.

**Und die rechte Seitenleiste gibt es dort jetzt auch** — mit den vier Reitern,
die über die Seite selbst sind: Gliederung, Dateien, Bilder, Links. Verlauf,
Personen, Aufgaben und Kommentare bleiben draußen; die sind über den Workspace,
und der Verlauf nennt jede Version samt Autor.

Das ist bewusst keine Freigabe-Option. „Rechte Seitenleiste anzeigen" würde
entweder den Verlauf und die Namensliste mit hinausgeben oder nur eine
Gliederung verstecken — die Trennung ist eine Eigenschaft der Reiter, keine
Entscheidung pro Link.

Nichts zu tun beim Aktualisieren.

**Eine Beschränkung hält jetzt auch gegen die, die den Ordner darüber haben.**
Wer eine Seite oder einen Bereich beschränkt („nur die unten hinzugefügten
Leute"), hielt damit bisher nur die Rolle des Workspace fern. Eine Freigabe auf
einem Ordner *darüber*, die den Teilbaum einschließt, ging glatt hindurch — also
genau gegen die Leute, gegen die man beschränkt: das eigene Team, alle, die den
Bereich darüber bekommen haben.

Ab jetzt zählt eine Freigabe nur, wenn sie **auf oder unterhalb** der
beschränkten Seite gesetzt wurde. Wer direkt dort hinzugefügt wurde, kommt
hinein; wer den Ordner darüber hält, nicht mehr. Freigabelinks folgen derselben
Regel: ein Link auf einen Ordner öffnet keine beschränkte Seite darin.

**Zu tun beim Aktualisieren: nichts — aber jemand verliert womöglich Zugriff.**
Wer heute über eine Freigabe von weiter oben in einen beschränkten Bereich
kommt, kommt danach nicht mehr hinein. Das ist der Zweck der Änderung. Wer den
Zugriff behalten soll, wird direkt auf der beschränkten Seite hinzugefügt.

**Dabei sind sechs Stellen aufgefallen, die eine beschränkte Seite nicht
verbargen.** Der Seitenbaum hat sie immer verborgen; diese sechs Wege nicht:

- eine beschränkte Seite direkt über ihre Adresse abrufen — Titel, Symbol,
  Titelbild kamen zurück,
- Schlagwörter samt Anzahl aus einem beschränkten Bereich in der Schlagwortliste,
- beschränkte Seiten im Papierkorb,
- eine neue Seite in einem beschränkten Ordner anlegen,
- eine Seite in einen beschränkten Ordner wiederherstellen,
- eine beschränkte Seite auf einen früheren Stand zurücksetzen.

Betroffen waren **Mitglieder** — Gäste wurden ohnehin abgewiesen, weshalb es in
keinem Test auffiel. Alle sechs sind geschlossen und durch Tests abgesichert,
die vorher fehlschlagen.

**Eine freigegebene Unterseite steht jetzt an ihrem Platz im Seitenbaum.** Wer
eine Seite tief in einem beschränkten Bereich freigegeben bekommt, sah sie
bisher ganz oben in der Seitenleiste stehen, außerhalb des Bereichs, in dem sie
liegt — der Ordner darüber fehlte einfach. Jetzt erscheint er, als Sprosse:
ohne Namen, ohne Menü, ohne Link, mit dem Hinweis „Nicht freigegeben". Der Name
war absichtlich zurückgehalten, und ihn mitzuschicken, damit die Oberfläche ihn
verstecken kann, wäre ihn mitzuschicken.

Betroffen waren Gäste. Für Mitglieder ging es zufällig gut.

Nichts zu tun beim Aktualisieren.

**Ein Freigabelink auf einen Ordner öffnet jetzt auch, was darin liegt.** Wer
einen Ordner geteilt hat, teilte damit bisher eine leere Seite mit einem Namen
darüber: die geteilte Ansicht zeigte genau eine Seite und hatte keine
Navigation. Jetzt steht daneben eine Liste dessen, was der Link erreicht — und
nur das. Wer einen Link hat, ist kein Mitglied und erfährt weiterhin nichts
darüber, was es sonst in diesem Workspace gibt.

Ein Link auf eine einzelne Seite zeigt keine Liste; da gibt es nichts zu
navigieren.

**Neuer Menüpunkt „Freigaben", neben Papierkorb und Posteingang.** Drei Listen:
Links, von mir freigegeben, für mich freigegeben. In der Reihenfolge, weil ein
Link das Einzige ist, was das Haus bereits verlassen hat.

Bisher war eine Freigabe nur *von der Seite aus* zu sehen. Das beantwortet „wer
kann diese Seite sehen" und nicht die Frage, die man tatsächlich hat: was habe
ich hinausgelassen. Eine Regel, die niemand aufzählen kann, prüft auch niemand.

Links lassen sich hier zurückziehen. Eine Zugriffsstufe zu ändern nicht — das
ist eine Entscheidung über eine bestimmte Seite und wird dort getroffen, sonst
gäbe es zwei Orte für Rechte und damit irgendwann zwei Antworten.

Nichts zu tun beim Aktualisieren.

**Eine Seite oder ein Bereich lässt sich jetzt deckeln: „hier höchstens
lesen".** Im Freigabe-Bereich einer Seite, unter der Beschränkung. Die
Obergrenze gilt für die Seite und alles darunter — auch für Leute, denen weiter
unten ausdrücklich mehr gegeben wurde, und auch für Freigabelinks.

Das ist die einzige Regel in SONE, die etwas *wegnimmt*. Alle anderen geben:
die Rolle gibt eine Grundlage, einzelne Freigaben erweitern sie, und die
Obergrenze deckelt am Ende alles. Sie hängt an der **Seite**, nicht an einer
Person oder Gruppe — deshalb kann sie senken, ohne dass ein Gruppenbeitritt
jemandem etwas nehmen könnte.

Gilt mehr als eine, gewinnt die **niedrigste**. Eine Decke unter einer Decke ist
die wirkliche Decke; sonst könnte eine Unterseite still aufheben, was für den
Bereich darüber festgelegt wurde.

Wer den Workspace verwaltet, ist ausgenommen — sonst ließe sich eine Obergrenze
auf der obersten Seite setzen, die danach niemand mehr aufheben kann.

Und weil eine gedeckelte Seite aussieht wie jede andere und sich anders verhält:
der Freigabe-Bereich sagt, **von wo** eine geerbte Obergrenze kommt.

Migrationen laufen beim Start automatisch. Sonst nichts zu tun.

**Rollen lassen sich jetzt selbst festlegen — Workspace-Einstellungen →
Rollen.** Eine Rolle sagt zweierlei: was jemand auf Seiten darf, für die nichts
Eigenes freigegeben wurde, und was er im Workspace verwalten darf. Beides wird
getrennt gewählt, weil es zweierlei ist: die Seitenstufe ist eine Leiter
(lesen → kommentieren → bearbeiten → verwalten), die Verwaltungsrechte sind
unabhängig voneinander.

**Damit gibt es endlich „nur lesend":** eine Rolle mit der Seitenstufe *Darf
lesen* und ohne Verwaltungsrechte. Einzelne Freigaben können weiterhin mehr
geben, nie weniger.

Rollen lassen sich **Personen und Gruppen** geben. Eine Gruppe mit einer Rolle
gibt sie allen darin; wer mehrere Rollen hat, bekommt jeweils das
Großzügigere — eine Gruppe beizutreten nimmt nie etwas weg.

Die vier eingebauten Rollen (Eigentümer, Admin, Mitglied, Gast) stehen in der
Liste und lassen sich nicht ändern. Ein Workspace hat immer einen Eigentümer,
und ein Eigentümer darf immer alles — sonst ließe sich ein Workspace bauen, den
niemand mehr verwalten kann.

Eine Rolle, die noch jemand hat, lässt sich nicht löschen; die Meldung sagt, wie
viele Personen und Gruppen sie halten.

Migrationen laufen beim Start automatisch. Sonst nichts zu tun.

**Ein Eigentümer kann eine beschränkte Seite jetzt auch beobachten.** Die
Sichtbarkeitsregel, die jede Liste im Programm benutzt, bekam von jeder
aufrufenden Stelle mitgeteilt, ob die anfragende Person alles sehen darf. Eine
davon sagte immer „nein", und ausgerechnet beim Beobachten einer Seite: wer
eine beschränkte Seite offen vor sich sah, bekam beim Klick auf *Beobachten*
„Seite nicht gefunden". Die Regel fragt das jetzt selbst.

**Unter der Oberfläche: Rollen sind jetzt Daten.** Bisher waren die vier Rollen
vier Wörter im Programmcode, und ihre Bedeutung stand in zwei `switch`-Blöcken.
Jetzt ist eine Rolle eine Zeile mit zwei Feldern — was sie auf einer Seite ohne
eigene Regeln gibt, und welche Rechte sie trägt. Die vier vorhandenen Rollen
bekommen genau das, was sie hatten; für dich ändert sich nichts.

Das ist die Grundlage für frei definierbare Rollen, die einen eigenen
Einstellungsbereich bekommen und Personen **und Gruppen** zugewiesen werden
können. Der Bildschirm dazu kommt als Nächstes.

Außerdem sind drei Fragen, die bisher alle mit „ist diese Person Eigentümer
oder Admin?" beantwortet wurden, jetzt drei benannte Rechte: Leute verwalten,
Gruppen verwalten, Workspace-Einstellungen. Wer eines davon vergeben will,
musste bisher alle drei vergeben.

Migrationen laufen beim Start automatisch. Sonst nichts zu tun.

**Eine Seite, die einer Gruppe freigegeben wurde, lässt sich jetzt auch
öffnen.** Bisher entschied die Frage „darf diese Person diese Seite" an zwei
Stellen unterschiedlich: der Seitenbaum kannte Gruppenfreigaben, die Stelle, die
das Dokument herausgibt, nicht. Wer eine beschränkte Seite ausschließlich über
eine Gruppe erreichte, sah sie im Baum und bekam sie nicht auf — sie sah kaputt
aus statt gesperrt. Freigaben an einzelne Personen waren nie betroffen.

Wer Gruppenfreigaben eingerichtet hat und dachte, sie wirkten nicht: sie wirken
jetzt. Es lohnt sich, einmal durchzusehen, ob alle noch gewollt sind.

Nichts zu tun beim Aktualisieren.

**A locked page can no longer have its contents deleted.** The lock stopped
typing, and it did not stop the ⋮⋮ handle beside a block: its menu still opened
on a locked page, and Delete still worked. The handle and the `+` are now gone
while a page is locked, and every command the interface can run is checked
against the lock rather than only what you type — so a button that misses the
lock cannot change a locked page.

Commenting on a locked page is unchanged, which is the point of a lock: the
toolbar over a selection keeps its comment button and drops bold, italic and
link.

Nothing to do when upgrading.

**Correction to the 0.11.0 notes: there is a container image, and there always
was.** Those notes say no image could be produced. That was wrong — it came from
a page in this repository that described the image workflow as something it is
not, and the runner published `0.11.0`, `0.11` and `latest` while the release
was being written. They are on `forgejo.thiel.tools/thiel/sone` and can be
pulled without credentials. A released tag's notes are not rewritten
(ADR-0013), so the correction lives here.

**You can connect a provider to the account you already have.** Invited, set a
password, and now you would rather use the company's login: **Deine
Einstellungen → Anmelden**. Your password keeps working — connecting adds a
second way in rather than replacing the first, and you can disconnect again
unless it is the only way into the account.

This was described in the documentation and never built, so until now only
accounts *created by* a provider could use one. Everybody invited before single
sign-on was configured was shut out of it with nothing on screen saying why.

Signing in through the provider does not ask for your second factor, and that is
deliberate: the provider did the authenticating and has its own. The password
door still asks. Worth knowing when you connect one — somebody who takes your
provider account gets in without your code.

**You can mention somebody.** Type `@` in a page or in a comment and a list of
the people in the workspace appears; pick one and they are told, with the
sentence they were named in and a way straight to it.

This is not an improvement to mentions — **there was no way to make one.** The
field in the document, the notification kind, the "Erwähnungen" setting on your
mail preferences, the inbox filter and the sentence in the notification mail
have all been in place since mentions were designed. The `@` was the missing
part, so all of it has been waiting for something that could never happen.

An `@` in the middle of a word is still an email address and does nothing —
writing down a colleague's address does not offer to turn it into a mention. In
a page the name is stored as a thing rather than as text: it survives being
searched for, and it is deleted in one keystroke rather than letter by letter.
Somebody who cannot see the page is not told, whatever the sentence says.

**The block handles stay with the text when the sidebar moves.**

Collapsing or expanding the sidebar, or dragging its width, left the `+` and
`⋮⋮` where the text used to be — and clicking into something else usually put
them right, which is the tell. The reading column has a maximum width and is
centred, so changing the room beside it makes it **re-centre without changing
width**; the code watching for movement only watched for resizing, and had
nothing to notice. The formatting toolbar, the table toolbar and the slash menu
drifted the same way for the same reason.

**Single sign-on could never create an account. It can now.** *(If you have OIDC
configured, this is the entry to read.)*

Pressing the sign-in button and coming back from your provider always ended in
"sign-in failed" for anybody who did not already have an account here — because
the statement that creates one named a database constraint that does not exist.
The failure was indistinguishable from a rejected token, so an instance with
perfectly correct settings looked like an instance with a wrong client secret.
Nobody has ever signed in to SONE through a provider unless their identity row
was created by hand.

Two related repairs. The short-lived cookie that holds a sign-in in progress is
**signed** now: without that, anybody able to set a cookie for your domain — a
neighbouring subdomain, or plain HTTP — could have completed a sign-in *into
their own account* in your browser, leaving you writing into their workspace
believing it was yours. And that cookie is now actually cleared when a sign-in
succeeds; it used to be discarded by the session cookie set immediately after
it, and lingered for ten minutes.

**Still missing, and now written down properly:** there is no way to attach a
provider to an account that already exists here. The documentation described one;
it was never built. Everybody who had a SONE account before OIDC was configured
still cannot use it, and that needs its own change rather than a note.

**Notification mail: putting something off now works, and a hiccup no longer
loses it.**

**Später did not reach your inbox.** A notification you put off until Monday
left the list and stopped counting against the badge — and still sent you the
mail about it that afternoon. It waits now, and arrives when the notification
does.

**Replying by email failed silently for whole mails.** A mail listing several
things carried a reply address taken from the *oldest* of them, and an
assignment cannot be replied to — so if the oldest thing happened to be an
assignment, the entire mail lost its reply address, mentions and all. It now
names the earliest item that can actually take an answer.

**A relay hiccup used to cost you notifications permanently.** The queue was
documented as retrying five times; it gave up on the first error, and by then
the notifications were already marked as sent. It retries now, five times with
widening gaps.

**A failed activity digest lost the day it covered** — the "up to here" mark
moved before the mail went out, so the window nobody was told about was never
mentioned again. And one unreachable address skipped everybody after it in the
list, for that whole day. Both fixed.

**Your digest showed you less than the app does, if you own a workspace.** It
asked whether you administer the *server* where every other screen asks whether
you own the *workspace*, so owners quietly lost rows from their own digest —
and instance administrators saw restricted page titles from workspaces where
they are ordinary members. It asks the same question as the page tree now.

Also: two workspaces with the same name no longer merge into one heading in the
digest, notification mail carries the `List-Unsubscribe` header it was always
documented as carrying, and the two mail timers now log what they did instead of
swallowing every failure in silence.

**A deleted workspace is now actually deleted.** *(Operators: read this one.)*

Deleting a workspace marks it, and after 30 days the maintenance job removes it
for good. It removed the entries and **left every page's content in the
database** — invisible to every screen, unreachable by any means, and permanent.
The promise in `docs/deployment.md` about "deleted" meaning what people take it
to mean when they ask whether their notes are still on the server was not being
kept. It is now. The same gap existed for a page's *internal comments* — the
ones written where the page's readers cannot see them — which survived every
"delete this page" because their document is stored under a different id.

**This release stops the leak; it does not clean up after it.** An instance that
has purged a workspace before today still holds that content. Removing it safely
needs a sweep with no workspace, page or owner to join against, which is one
mistake away from deleting live data — so it gets its own change, with a dry run
that reports before it removes, rather than being bolted on here.

**`SONE_VERSION_RETENTION_DAYS=0` would have deleted all page history.** Not
"kept none from now on" — deleted every existing version of every page on the
instance, on the next maintenance pass, unrecoverably. The setting is clamped to
at least one day now, and anything that is not a number falls back to 90.

**Maintenance says when it failed.** A pass in which every task threw looked
exactly like a clean one: "compacted 0 documents", which is also what a healthy
instance says. Failures are shown in the Administration panel now, and a
document that will not compact no longer sits silently at the head of the queue
starving the others. The panel's summary line is also translated, which it was
not.

**Backups say what they contain, and a failed restore leaves your database
alone.**

Nothing was producing bad backups — the round trip works and is tested. What it
was doing is keeping things to itself. An archive with no attachments in it
could mean three different things, and the restore told everybody the same one:
"if the source used S3 storage, point this instance at the same bucket", to
operators who had never had a bucket. The archive now records which it was, and
the restore says the true sentence.

An instance keeping attachments in **S3** gets a database-only backup — that is
correct and always was, but it happened quietly. The backup now says so while it
runs, in as many words: the bucket needs a backup of its own.

A file directory that **cannot be read** — a volume that failed to mount, say —
now refuses the backup instead of quietly producing one without the
attachments. A backup may leave things out; it may not do so by accident.

A **restore that fails** now leaves the database exactly as it was, rather than
partway between two states. A backup **interrupted** before it finished is named
`.incomplete` and is refused with that word, rather than looking like an archive
and failing on a missing file at the worst moment. And a very large backup no
longer needs as much memory as the database is big — above two gigabytes it
could not be made at all.

Two corrections to what was written down. `--force` on a restore never dropped
and recreated anything, whatever the message said — it skips one check, and
using it to move a database *backwards* leaves the newer tables in place and
breaks the next start. And the README printed the backup and restore commands
side by side as though both could run against a live instance: **a restore
cannot.** There is a restore section in `docs/deployment.md` now, which also
says the thing nobody had written down — a restore with a different
`SONE_SECRET_KEY` succeeds and then silently fails to read second factors and
share links.

**Replies that arrive by email: umlauts, and who is allowed to send one.**

An answer typed on a phone arrived with its accented letters doubled — "Grüße"
landed in the page as "GrÃ¼ÃŸe" — for as long as replying by mail has existed.
Mail sent as base64 or quoted-printable, which is what most desktop clients
send, was always correct; the plain kind a phone sends was not. Comments already
written that way stay as they are: nothing rewrites somebody's words afterwards.

The permission check on those replies was also weaker than the one everywhere
else in SONE, in two ways that matter. A **guest** could answer by mail on a
page they cannot open — the inbox has always refused them. And a member could
answer on a **restricted** page they were never granted access to, because the
check looked only at workspace membership and never at the page's own rules.
Both are refused now, by the same rule the rest of SONE uses. Anyone in that
position gets "You no longer have access to that page" — accurate about what
happens next, if generous about the history.

Three smaller repairs on the same path: a reply SONE could not use produced a
refusal addressed to the sender's *display name*, which every mail server
rejects — and because that happened before the message was filed, the same
failure repeated every two minutes and blocked everything behind it. A refusal
that cannot be sent at all is now written to the log instead of vanishing. And
two overlapping mail checks can no longer post the same answer twice.

**The test pipeline had not run a test in five days.** It failed on 295
consecutive runs — through eight merges and the 0.11.0 release — on one line
asking for a tool the project never installed at its root. Every run stopped
thirteen steps in, before typecheck and before the suite, and showed twelve
green ticks on the way there. Nothing shipped broken because of it: the same
checks ran on every change, in full, elsewhere. But for five days the thing
whose job is to say so was not saying anything, and that is worth an operator
knowing about a project they run. The tool is installed now, a check refuses any
workflow that reaches for one that is not, and ADR-0077 records the rest —
including the part that is about a habit rather than a line of YAML.

## 0.11.0

Pull and restart. One migration runs by itself; there is nothing else to do.

SONE has a face, a shape, and an inbox you can actually work down.

**SONE looks like something now.**

There was no logo, no favicon and no installed icon — a tab in a row of tabs was
a blank sheet. There is a mark: an indented stack of bars, the page tree drawn
as a glyph, and the bar that carries the accent takes the workspace's own accent
colour, so a workspace set to blue has a blue mark. It is the tab icon, the icon
iOS puts on a home screen, and the icon an install uses. Adding SONE to a
phone's home screen works; it is still not offline, which needs a service worker
and is not here yet.

Two typefaces come with it, Archivo and Jetbrains Mono, served from your own
server like everything else — no request leaves the instance to fetch them.

A page's title is set firm and tight instead of large and thin. Headings
*inside* a note are unchanged and stay light: the two had been sharing one
setting, so a decision made about writing was being applied to the label on the
window as well. Anything technical is in the monospaced face — the path above a
title, the column headers in a table, a file's size and date, version numbers,
the counts beside a section — which is what tells a label naming a place apart
from a title naming a page. A table's header is a firm line rather than a grey
band.

**Where you are is a narrow rail down the left edge, and a bar along the bottom
on a phone.**

The rail holds the mark and three places: your workspaces, your inbox, the
trash. Open the bell and the column beside it becomes the inbox's menu — unread,
by kind, by workspace, each with its count — while the notifications themselves
fill the page. Open the trash and it becomes the trash's. Your pages are the
mark at the top, and that column is the tree, exactly as before. The menu that
used to hang above the tree is gone; what is left in its place is the workspace
switcher alone, as the column's title, which is what most people were using it
for.

On a phone the rail is not drawn. The same places sit in a bar along the bottom
— Seiten, Workspaces, Posteingang, Papierkorb and you — where a thumb can reach
them, instead of at the foot of a drawer behind a toggle. The bar moves out of
the way when the keyboard opens, so it never sits between you and the line you
are writing, and it leaves room for the home indicator on the phones that have
one. What it covers is given back: the page you are reading ends above it, and
the drawer stops above it.

Your face and its menu are at the foot of the rail, or at the end of the bar.

**Settings, your workspaces and the administration open in that frame** rather
than as screens that replace everything, so getting back is one press of the
mark rather than a "back" button that only exists inside settings.

They are three areas and they stay separate. **Deine Einstellungen** is yours
and says so; **Verwaltung** is the server's and says "für alle auf diesem
Server", which is the fact that should be on screen when somebody changes a mail
server. A workspace's settings are neither: they are in **Workspaces**, where
the column names the workspace at the top with the same switcher the page tree
has. Pick one and its sections are the ones underneath — and picking also
switches you into that workspace, so the mark takes you to its pages afterwards.
Before this they sat in the middle of the settings menu, three rows above
"Mailserver", as though a workspace could have its own.

The logo always takes you somewhere. It goes where "Wo du landest" points; with
the default setting — the page you were last on — that is the page you are
already standing on, so it goes to the top of your tree instead. Signing in,
reloading and switching workspace are unchanged: they still put you back on the
page you were reading.

**A workspace gives access; the instance invites.**

The workspace's **Einladungen** section is gone. It made a link that let whoever
opened it join — creating an account on the server if they had none — which
meant any workspace owner could add people to the server itself. Two different
jobs in one form.

Under **Leute** there is **Zugriff geben**: type the address of somebody who
already has an account here, choose what they come in as, done. No link, nothing
to send, nothing outstanding. Somebody who has no account yet is invited under
**Verwaltung → Einladungen**, which is where making an account belongs.
Invitations sent before this still work and are still listed under Leute so they
can be withdrawn; no new ones can be made there. The roles in the members table
are in your language now — they read "owner", "admin", "member", "guest" in
every language before this.

**The inbox reads like an inbox.**

Several replies in one conversation are one row, saying the newest thing and how
many there were, so three people talking on one page no longer fill the list.
You can work down it from the keyboard: **j** and **k** move, **Enter** opens,
**e** marks a row read, **u** puts it back to waiting — which was not possible
at all before, reading something was a one-way door — and **s** puts it aside
until tomorrow morning. Every row carries the same acts as buttons.

**Später** gives three times — in drei Stunden, morgen früh, nächste Woche — and
each shows the moment it means, so you can see what you are agreeing to. What is
asleep leaves the list and stops counting against the badge on your picture,
which is the point: a count that includes what you deliberately put off is a
count nobody believes. It comes back on its own when the time arrives; nothing
runs, the moment simply passes. A **Später** view appears while anything is
asleep, saying when each one returns, and one button brings any of them back
early.

**Antworten** answers a conversation without leaving. The box opens under the
row, so the passage you are answering stays on screen while you write; Enter
sends, Shift+Enter makes a line. Answering marks the conversation read, and the
reply appears immediately for anybody who has that page open.

A repair came with that one: **replies that arrive by email now notify the
person being answered.** They were written into the page correctly and then not
projected, so nobody was told about them until somebody happened to edit that
page for another reason.

**The trash lets you look before you decide.**

There is a search field over it, and any entry can be opened for a read without
being restored — the first page or two of its text, which is the only way to see
inside something that is no longer in the tree. An entry whose folder was
deleted as well now asks where it should go instead of refusing: its button says
"Wiederherstellen nach…" and offers the folders that still exist. Every entry
says how many of its thirty days are left, and says it in red in the last week:
"gelöscht am 12." is a date somebody has to do arithmetic on, and nobody does it
until the thing is gone.

**Said in your language, at last.** The trash wrote four of its lines in English
("deleted", "with 12 entries inside", "the folder it was in is gone", "Untitled
folder"), a workspace with no name read "Untitled" in the switcher, and the
roles in the members table were raw English ids. All of it was only visible by
reading the screens in German.

**Fixes found along the way.**

- Quiet text in the light theme was too pale to meet the contrast standard — 3.6
  against white where 4.5 is the minimum. Every secondary label is darker now.
  The dark theme was already correct and is unchanged.
- The sidebars were see-through. Not by much and not on purpose: a workspace
  with no colour set was having "nothing" mixed into its surfaces, and CSS reads
  that as an instruction to be sixteen per cent transparent. On a phone, where
  the sidebar slides over the page, the page showed through the navigation.
- A workspace colour reached people who had chosen the dark theme and was
  ignored for people whose device had chosen it for them. Both now.
- The sidebar's draggable edge is on the sidebar. It had always been at the
  right-hand edge of the *window*, over a thousand pixels from the edge it
  resizes, so if you never found it, that is why. And a sidebar you had dragged
  wider snapped back to its default whenever the right-hand panel opened.
- Two floating elements were drawn without their shadow.
- 0.10.0 shipped a workspace list alongside the "this workspace" entry it was
  meant to replace, and left the same list in the administration as well. There
  is one way to each now, and the administration is the instance only —
  accounts, sign-in, mail, maintenance.

## 0.10.0

Workspaces, in one place.

A workspace's settings were split between two screens with no line between them
— one for the workspace you were in, one inside the administration for anybody
else's — and each had sections the other lacked. So an administrator could not
change another workspace's typography, and an owner could not delete their own.
There is one screen now, with the workspace in the address, reached from the
account menu and from the list alike.

And there is a list for everybody: it existed only for administrators, which is
why a member could only ever edit the workspace they happened to be looking at.
It shows the ones you are in, or every one if you look after them — the same list
at a different length, decided by the server.

**Operator action: none.** `docker compose pull && docker compose up -d`. No
migrations, no settings, no contract changes — document schema 4, sync protocol
1, and the migration set is identical to 0.9.1's.

Two rights faults came out of the same work and are fixed: somebody who manages
workspaces could not edit one they were a *member* of, because the right was only
consulted for workspaces they were not in — so joining a workspace took away the
ability to administer it. And the settings screen disabled its controls for
anybody without a role in the workspace, even where the server would have
accepted the change.

A workspace's settings have their own address now, `/workspace/<id>/<section>`.
The old form still works and means the workspace you are in, so a bookmark from
before lands somewhere useful.

**Fixed: somebody who manages workspaces could not edit one they were a member
of.** The right was only consulted for workspaces they were *not* in, so joining
a workspace took away the ability to administer it. And the settings screen
disabled its controls for anybody without a role in the workspace, even when the
server would have accepted the change.

**Everybody has a workspace list.** It existed only for administrators, so a
member could only ever edit the workspace they happened to be looking at. It is
under Workspaces in the account menu now, showing the ones you are in — or every
one, if you look after them.

**A workspace is edited in one place.** Its settings were split between
`/workspace/…` and the administration, each with sections the other lacked — so
an administrator could not change another workspace's typography and an owner
could not delete their own. One screen now, with the workspace in the address,
reached from the account menu and from the administration's list
([ADR-0067](docs/adr/0067-one-place-to-edit-a-workspace.md)).

**The sidebar can be dragged wider**, and remembers it. Long page titles in a
nested folder had nowhere to go: a name like `02.03.2026 - 09:05 - Notiz` needs
about 200px, and three levels of nesting inside a 260px sidebar leave it 180.
Double-click the edge to put it back.

## 0.9.1

Two controls that were missing.

Requiring two-step sign-in had no switch in the administration, and lifting
somebody's second factor — the only way back for a person who has lost both
their phone and their recovery codes — had no button. Both worked over the API
and nowhere else, which means neither was usable.

**Operator action: none.** `docker compose pull && docker compose up -d`. No
migrations, no settings, no contract changes — document schema 4 and sync
protocol 1, and the migration set is identical to 0.9.0's.

**Fixed: two things you could not actually do.** Requiring two-step sign-in had
no switch in the administration, and lifting somebody's second factor — the only
way back for a person who has lost both their phone and their recovery codes —
had no button. Both worked over the API and nowhere else. There is now a check
that every route the server offers is one the interface can reach.

## 0.9.0

A small release about one thing: getting notes *into* SONE.

Markdown files can be imported directly — one, or several at once — where the
import previously demanded a ZIP for no reason other than that nothing had ever
made it not. And two refusals that named the wrong reason now name the right
one: an archive in the Zip64 format said it held too many entries, which sent
people looking for files to delete that were never the problem.

**Operator action: none.** No migrations, no settings, no contract changes —
document schema 4 and sync protocol 1, both unchanged, and the migration set is
identical to 0.8.0's. `docker compose pull && docker compose up -d`.

Both of the fixed refusals came from a real import that failed, which is worth
saying because neither would have been found by testing the happy path:
`too_many_entries` had no message at all, so the interface showed the error code
itself.

**Markdown files can be imported without zipping them first** — pick one, or
several, and each becomes a page. The import demanded an archive for no reason
other than that nothing had made it not; several files are packed into one
archive in the browser, so there is still a single plan to look at before
anything is created.

**Fixed: an archive the import could not read said the wrong thing about why.**
A Zip64 archive was reported as holding too many entries, which sent people
looking for files to delete; it now says it is Zip64. And "too many entries" now
says how many it found and how many it reads, instead of showing a bare error
code — which had no message at all.

## 0.8.0

Watching, and the requirement.

Pages can be watched — a bell beside the star, and watching a folder covers
everything under it. The mail about what changed can then be narrowed to only
what you watch, which is what makes it usable in a workspace of three thousand
pages rather than thirty. Favouriting still means only "I come here often" and
never sends anything.

And an instance can now require two-step sign-in: fourteen days of grace with a
banner and two emails, then setup is the only screen that opens — reading
included, because a stolen password that grants read access to a company's notes
has granted the thing that mattered. An administrator cannot switch it on
without having one themselves.

**Operator action: optional.** Three migrations apply on start; upgrading from
0.7.0 has been tested in place with a confirmed second factor, a spent recovery
code and a set of mail preferences, all of which come through untouched. Nobody
is watching anything until they say so, and the digest keeps covering everything
you can see unless you narrow it: a release that silently narrows what somebody
receives is as bad as one that widens it.

This release also **drops the four mail-preference columns** 0.7.0 superseded and
kept for one release, as `0050` said it would. Nothing read them.

**Both contract versions are unchanged** — document schema 4, sync protocol 1.

**Fixed: the session request asked the database twice for the same thing.** No
visible change, but it was on the route every page load hits.

**An instance can require two-step sign-in**
([ADR-0065](docs/adr/0065-requiring-a-second-factor.md)). Fourteen days of
grace with a banner and two emails, then setup is the only screen that opens —
reading included. An administrator cannot switch it on without having one
themselves, and single sign-on accounts are exempt because their provider is
where a second factor belongs.

**Removed the four mail-preference columns** that 0.7.0 superseded and kept for
one release. Nothing read them; the preferences themselves are untouched.

**Pages can be watched**, with a bell beside the star in an entry's menu
([ADR-0064](docs/adr/0064-watching.md)) — watching a folder covers everything
under it. The mail about what changed can then be narrowed to only what you
watch, which is what makes it usable in a workspace of three thousand pages.
Favouriting still means only "I come here often" and never sends anything.

## 0.7.0

Two-step sign-in, and the settings that go with it. An authenticator app can now
be required after your password — and a password reset deliberately does *not*
remove it, because otherwise anybody with your mailbox would have your account.
If both the app and your recovery codes are gone, an administrator can lift it,
and you are told by mail who did.

Notification email also stops being all-or-nothing: each kind now has its own
answer — at once, in the daily mail, or never. "Tell me immediately when
somebody mentions me, let the rest wait until tomorrow" was not sayable before.

**Operator action: optional.** Two migrations apply on start; upgrading from
0.6.0 has been tested in place with four accounts carrying different mail
settings, and every one keeps exactly the behaviour it had. Nobody has a second
factor until they set one up, and nothing about single sign-on changes — an OIDC
account authenticates at its provider, which is the right place for its own
second factor.

The four superseded mail-preference columns are still present and unused. They
go in 0.8.0, so a rollback from this release to 0.6.0 still finds them.

**Both contract versions are unchanged** — document schema 4, sync protocol 1.

**Also**: mail has its own area in the administration rather than a heading
under the instance settings, and asking to reset a single sign-on account's
password now gets a mail explaining where it signs in, instead of the silence
that left people waiting for a link that was never coming.

**Sign-in can ask for a code from an authenticator app**
([ADR-0063](docs/adr/0063-second-factor.md)). Scan the QR code under You →
Signing in, or type the secret in by hand;
ten recovery codes come with it, shown once. A password reset does *not* remove
it — otherwise anybody with your mailbox would have your account. If both the
app and the codes are gone, an administrator can remove it, and you are told by
mail who did.

**Asking to reset the password of a single sign-on account now gets an answer**
([ADR-0059](docs/adr/0059-password-reset.md)) — a mail saying the account signs
in through its provider, instead of the silence that left people waiting for a
link that was never coming. The form itself still answers the same way for every
address.

**Each kind of notification now has its own answer**: at once, in the daily
mail, or never ([ADR-0061](docs/adr/0061-digest.md)). "Tell me immediately when
somebody mentions me, let the rest wait until tomorrow" was not sayable before.
Existing accounts keep exactly what they had.

**Mail is its own area in the administration**, not a heading inside the
instance settings — it had grown to six SMTP fields, four IMAP fields and a test
button under a heading about who may sign up.

## 0.6.0

Mail in both directions. A notification can now be answered by replying to it,
and the address it was sent *to* is what identifies the writer — a forged sender
does nothing, because the `From` header is never consulted. A forgotten password
can be reset by email. And two mails you can ask for rather than receive: your
notifications once a day instead of as they happen, and a list of what changed
in your workspaces.

None of them says more than the notification mail already did: who, where, a
link, and never what was written. The activity mail additionally never lists a
page you cannot open — it uses the same visibility rule as the page tree, per
recipient, rather than a second answer to that question.

**Operator action: optional.** Four migrations apply on start; upgrading from
0.5.0 has been tested in place and every existing account keeps its current
behaviour — mail as it happens, no activity digest. Replying by email needs a
mailbox to poll (IMAP settings beside the SMTP ones, password in
`SONE_IMAP_PASSWORD`); without one, notifications carry no reply address and the
feature is absent rather than broken. Same for the password reset, which does not
appear on the sign-in page unless a mail server is configured.

**Both contract versions are unchanged** — document schema 4, sync protocol 1.
A comment message gained three optional fields saying it arrived by email; the
schema's own rule is that an optional field does not warrant a bump, and an
older client ignores them.

**Also**: password hashing cost is configurable (with a warning and a maintenance
entry when lowered), search can be narrowed to a folder with `in:`, formulas
complete column and function names, a commented canvas item finally shows that
it is commented, and fourteen settings that never reached the container now do.

**A mail about what changed in your workspaces**
([ADR-0062](docs/adr/0062-activity-digest.md)), every weekday morning or on
Mondays — a list of pages with who touched them, never what was written, and
never a page you cannot open. Off unless you choose it, under You →
Notifications.

**Notification emails can arrive once a day instead of as things happen**
([ADR-0061](docs/adr/0061-digest.md)) — at eight in the morning in your own
timezone, and only when something is still unread. There is a "never" too, which
is one answer rather than three switches. Under You → Notifications.

**A notification can be answered by replying to it**
([ADR-0060](docs/adr/0060-reply-by-email.md)). Configure a mailbox under
Instance → Settings and every notification carries a reply address; answering it
posts a comment on the thread. The address a mail was sent *to* is what
identifies the writer, so a forged sender does nothing. Replies are marked in the
panel, because trimming the quoted part is guesswork.

**A forgotten password can be reset by email**
([ADR-0059](docs/adr/0059-password-reset.md)). A link that works for an hour and
once, a new password of your choosing, and every session signed out — including
whoever else might have been in the account. The form answers the same way for
any address, so it cannot be used to find out who has an account here. The link
on the sign-in page appears only when a mail server is configured.

**The mail settings have a section of their own and a test button.** It sends one
mail to your own address and reports what the server said — "535 authentication
failed" rather than "sending failed" — and, when it fails, which settings the
server actually used: host, port, encryption, user, sender, and the password's
*length* plus whether it arrived wrapped in quotes or padded with whitespace.
Never the password itself
([ADR-0058](docs/adr/0058-email-notifications.md)).

**Fixed: fourteen settings never reached the container.** Compose does not
forward the host's environment, and the SMTP settings, both secrets
(`SONE_SMTP_PASSWORD`, `SONE_OIDC_CLIENT_SECRET`), all six S3 values and the
workspace retention were not named in its `environment:` block — so an operator
who set them in `.env` got a server that never saw them. All present now, with a
check that fails if another one goes missing.

**Removed two things the schema promised and nothing kept**: a `users.avatar_url`
column superseded three years of migrations ago, and a `password_resets` table no
code has ever touched. Neither held a single row. A check now asks which columns
exist that nothing reads, so the next one is noticed.

**A formula completes column and function names as you type**
([ADR-0056](docs/adr/0056-formula.md)). Arrow keys and Tab or Enter to accept;
a column with a space arrives in its brackets and a function with its opening
parenthesis, so what is inserted always parses. Escape closes the list without
closing the dialog.

**Password hashing strength is configurable** as `SONE_PASSWORD_COST`
([ADR-0010](docs/adr/0010-sessions-and-password-hashing.md)), defaulting to the
recommended 2^16. Lowering it warns at startup and appears in the maintenance
panel, and raising it again upgrades existing passwords on their owners' next
sign-in. Mainly so the test suite stops paying production hashing cost 105 times
per file.

## 0.5.0

Two things that leave the instance, decided carefully. Comments can be internal:
a second document per page that a share link cannot open at all, so a team
discussing a draft and then sending the link to a client has not published the
discussion. And notifications can arrive by email, which says who did what and
on which page and never the comment itself — a mailbox is not a permission
system.

**Operator action: optional.** Four migrations apply on start; upgrading from
0.4.0 has been tested in place, and a 0.4.0 comment thread and notification come
through intact — the notification with no actor, which is a real answer rather
than a gap. Email is off until a mail server is configured under Instance →
Settings, and an instance without one is a normal instance: nothing is
attempted, nothing is offered, no queue fills up. The password is read from
`SONE_SMTP_PASSWORD` and deliberately cannot be stored in the database.

**Both contract versions are unchanged** — the document schema is still 4 and the
sync protocol still 1 — so clients and servers across 0.4.0 and 0.5.0 keep
working together. Internal comments needed no schema version because their
document id is derived from the page's rather than recorded anywhere.

**A commented canvas item now shows it** — a count over its corner, for
everybody reading the page, where before a discussion about an item was
invisible unless you opened the comments panel. Internal comments are named in
the mark's label and ringed rather than recoloured
([ADR-0057](docs/adr/0057-internal-comments.md)).

**Search can be narrowed to a folder**: `in:Projekte Rechnung`, or `ordner:` in
German ([ADR-0050](docs/adr/0050-search-filters.md)). It searches everything
beneath that folder, and the chip says how many folders the name matched — two
with one name reach further than you meant, and a name nothing is called finds
nothing rather than everything.

**You can choose which notifications reach you by email** under You →
Notifications — mentions and tasks on, replies off, and the screen says what a
mail contains before asking whether you want one.

**Notifications can arrive by email** ([ADR-0058](docs/adr/0058-email-notifications.md)).
One mail per person per workspace, five minutes after the fact, and only for what
is still unread — so something dealt with in the app produces no mail at all. The
mail says who did what and on which page, with a link, and never the comment
itself. Emails the relay refuses show up in the maintenance panel.

**A mail server can be configured in the administration area**
([ADR-0058](docs/adr/0058-email-notifications.md)) — host, port, encryption,
user, sender address, and whether a mail may name the page. An empty host means
no email at all, which the screen says. The password stays in the environment as
`SONE_SMTP_PASSWORD`, because a secret in a table is a secret in every backup.

**A comment can be internal** ([ADR-0057](docs/adr/0057-internal-comments.md)):
tick "only for members" under the draft and the thread goes into a second
document that a share link cannot open at all — not hidden from it, unreachable.
Internal threads appear in the same panel, marked, and a
mention in one reaches the member's inbox — only ever a member's. The choice is made when the
thread starts and cannot be changed afterwards, because nothing can take back
what a guest has already synced.

**A search can be kept** ([ADR-0050](docs/adr/0050-search-filters.md)). Give
`tag:rechnung assigned:me` a name and it waits under the empty search field.
Kept per person, because `assigned:me` means something different to everybody.

## 0.4.0

Collections became a database: a column can point at rows in another collection,
another can count or total what points back, and a third can work out a value
from the row's own cells. Along the way a collection stopped sending every row it
has on every load, comments reached the people they were addressed to, and a page
can be compared with what it said before.

**Operator action: none.** Five migrations apply on start; upgrading from 0.3.0
has been tested in place, and a collection row written by 0.3.0 comes through
with its values intact.

**Both contract versions are unchanged** — the document schema is still 4 and the
sync protocol still 1 — so a client from 0.3.0 keeps working against this server
and the other way round. That is a quieter release than the last one in the only
way that matters to an operator.

One setting is new, and optional: nothing. The features below need no
configuration.

**Two dozen refusals now say what is wrong** instead of "an unknown error
occurred" — from "a workspace has to keep one owner" to "that value does not fit
this column". A new check makes sure a refusal the server can send either has a
message or is written down as deliberately not having one.

**A collection can have a formula column** ([ADR-0056](docs/adr/0056-formula.md)):
`Menge * Preis`, `if(Menge > 0, …)`, `round(…)`, computed per row. An empty cell
is empty and not zero, so a total over a row with a missing price is empty rather
than wrong — `coalesce(Preis, 0)` is how you say you meant zero. A formula that
cannot be worked out says why in the cell, and can be edited from its own
column. A formula cannot read another formula,
which is what stops a column depending on itself.

**Fixed: a board's column counts were counting only the loaded cards** now that a
collection loads a page at a time — "Done: 4" with three hundred in the
collection — and an empty column claimed nothing was in it. A column shows `4+`
while more may exist, and its three sentences are translated.

**A collection loads a page of rows at a time** ([ADR-0055](docs/adr/0055-paging-a-collection.md))
with a "Show more rows" button, instead of sending every row and every cell on
every load — which was 7 MB of JSON for a collection of twenty thousand rows. A
view sorted by a computed column still reads the whole collection and says so.

**A view can be sorted by a rollup** — most invoices first, largest total first
([ADR-0054](docs/adr/0054-relations.md)). Sorting by a computed column used to be
silently ignored: the view came back in its ordinary order and nothing said why.

**A row's own page now shows its fields** in the properties panel, above the
page's kind and dates — editable, and including relations and rollups. Opening a
row from a table previously showed a page that said nothing about the row it was.

**A collection can have a relation column** ([ADR-0054](docs/adr/0054-relations.md)),
pointing at rows in another collection — chosen when the column is created,
because a relation that could point anywhere has nothing to aggregate on the
other side. The cell shows the linked rows as chips that open them, with a picker
that searches inside the collection it points at. **The other side is derived**: a rollup
column on the collection being pointed at says how many rows point here, or lists
them, or sums a number on them — computed on the server and read-only, because
nothing is ever written to the other side. It runs with your own visibility, so a
count says when something was left out rather than quietly differing between two
people. Pick **Rollup** as a column type, choose which relation it should
read, and then choose in its header what to do with what it finds: list the
rows, count them, show their values, or their total, smallest or largest — with
the field to read chosen beside the aggregate. Gallery cards show
relation counts and rollups too.

**A canvas item can be commented on** ([ADR-0046](docs/adr/0046-comments.md)) —
the speech bubble in the item's own handle menu. The thread appears in the
comments panel like any other, saying it is about an item rather than quoting
words it does not have.

**`assigned:me` in the search** lists the pages holding your tasks
([ADR-0050](docs/adr/0050-search-filters.md)) — the counterpart to being able to
assign one. `assigned:` with somebody else's id works too, and the syntax line
under the search field now mentions it.

**A task can be assigned to somebody**, who is told in their inbox
([ADR-0052](docs/adr/0052-notifications.md)). Choose the person in the task
block's menu; their name appears at the end of the line. Only tasks can be
assigned.

**A page says where it sits when the sidebar is hidden** — the folders above it,
above the title. Most useful for a collection's row, which opens as a page with a
name and, until now, no visible parent at all.

**Live HLS streams play in Chromium, Firefox and Brave**
([ADR-0037](docs/adr/0037-video.md)), not only in Safari. The player is fetched
only when a page actually shows a stream, so nobody pays for it otherwise. The
three sentences the video block shows when a stream cannot be played were in
English regardless of the interface language; they are translated now.

**Two versions of a page can be compared** ([ADR-0053](docs/adr/0053-version-diff.md)):
"Compare" beside an entry in the History panel shows what that version changed, or
what has changed since it. A moved paragraph is reported as **moved** rather than
as a deletion and an insertion somewhere else — blocks carry stable ids, so the
comparison knows rather than guesses. Formatting is not compared, and the view says
so.

**Fixed: the administration overview showed a number that was always zero** —
"waiting to project" counted a state nothing had written since the rebuild path
was replaced by failure-and-retry. It now counts projections that failed and will
be tried again, and "failed" counts the ones that have been given up on.

**Eight translations that nothing used have been removed**, and two new checks
keep both from returning: a message defined and never used now fails a test, and
so does a route module the server never mounts.

**Fixed: nine class names in the interface had no styling behind them** — panel
sections, a comment's reply box, an import plan's indentation and the "+" beside a
collection's views, which looked exactly like a view.

**The share dialog says that a link exposes the page's comments**, with how many
([ADR-0046](docs/adr/0046-comments.md)) — because a team discussing a draft in
comments and then sending the link to a client has published that discussion.

**The right panel slides in and out** like the left sidebar does, with the same
timing. **Fixed: a closed drawer was still reachable with the Tab key** — on both
sides, and on the left it had been for longer.

**An inbox** ([ADR-0052](docs/adr/0052-notifications.md)). When somebody names you
in a comment, or replies in a thread you are in, it appears under your face in the
sidebar with a count — across every workspace, because the question you missed is
usually the one asked somewhere you were not looking. Opening a notification marks
it read; looking at the list does not. It is deliberately not an activity feed: no
row appears because a page changed. SONE sends no email, and the inbox says so.

**A PDF can be paged and read with a keyboard.** The viewer shipped as a
scrolling column that was not in the tab order, so it could be read with a
pointer and not otherwise, and it had no paging controls at all despite
[ADR-0048](docs/adr/0048-pdf-viewer.md) describing them.

**A misspelt word in the body now suggests the right one**
([ADR-0051](docs/adr/0051-body-typo-tolerance.md)). Searching for "beratenummer"
offers "beraternummer" under "did you mean", and pressing it runs the ordinary
search — so the results are ranked and snippeted like any other search rather than
by how similar the letters were. A misspelt title already found its page; this
closes the other half.

**A search can be narrowed** ([ADR-0050](docs/adr/0050-search-filters.md)) by
typing filters into the search box: `tag:budget`, `author:markus`,
`after:2026-08-01`, `before:2026-09-01`. A filter on its own is a valid search, so
`tag:rechnung` lists everything tagged that way. The German prefixes (`autor:`,
`schlagwort:`, `seit:`, `bis:`) work too. What the search was read as is shown as chips above
the results, and a filter that cannot be read appears struck through with the
reason rather than being silently ignored — the rest of the search still runs.
The syntax is written under the empty search field. Dates are in the server's time zone — there is no
per-workspace zone yet, and the record says so.

**Fixed: a workspace's tint reached the menus and not the sidebar.** The sidebar
sits on its own surface token, which the first version of the tint missed.

## 0.3.0

The release where SONE became something more than one person's notes: accounts,
invitations, groups and per-page permissions — then comments, page history,
templates, import and export, a canvas, a PDF viewer, and a great deal of work on
how the thing looks and reads while using it.

**Operator action: none.** Thirty-six migrations apply on start; upgrading from
0.2.0 has been tested in place, and a page written by 0.2.0 survives it intact.

**Two version numbers changed and one did not.** The document schema is now
version 4 (it was 1), because documents gained canvases, comments and page
properties. Every step has a migration and they run when a document is opened, so
there is nothing to do — but a client from *this* release writing a document that
an older client then opens is not a case that has been designed for, so upgrade
all of them together. The sync protocol is unchanged at version 1, which is what
makes upgrading the server first safe.

Settings worth knowing about, all optional and all with sensible defaults:
`SONE_WORKSPACE_RETENTION_DAYS` (how long a deleted workspace can be restored),
`SONE_OIDC_CLIENT_SECRET` (turns single sign-on on), `SONE_VERSION_RETENTION_DAYS`
(how long page versions are kept), `SONE_VERSION_QUIET_MINUTES` (when a sitting
counts as ended), and `SONE_JOB_RESULT_HOURS` (how long a prepared workspace
export stays downloadable).

**A note about this section's history**, because a reader deserves it: these notes
were first cut at the end of August, and the release was not tagged. It kept
growing for two more days — everything from comments onwards was written after the
summary above was first drafted — and rather than skip the number, the notes were
rewritten and the whole of it shipped as 0.3.0.

**A single block can be locked too** ([ADR-0049](docs/adr/0049-locking.md)), from
the block's own gutter menu — for a page of working notes with one table that must
not move. A locked block is marked with a hairline in the margin.

**Fixed: the page lock's label was too long for the menu** and ran past its edge.

**A workspace can set the interface's tint and accent** under This workspace →
Typography ([ADR-0023](docs/adr/0023-workspace-theme.md)). One tint is mixed into
the sidebar, panels and menus rather than a colour per surface, so they keep
belonging to each other; the accent covers links, defined text and filled
buttons, and the text colour on a filled button is worked out from it.

**Fixed: reaching for a block's handle on a tablet selected the text beside it.**

**A page can be locked against accidental changes**
([ADR-0049](docs/adr/0049-locking.md)) — in the entry's ⋮ menu, above the trash. A
locked page can still be read, selected, copied, exported, commented on, and its
tables filtered and sorted; only its text stops being editable. The tree shows a
small padlock. **This is a guard, not a permission**: anybody who may edit the
page may lift it, and what restricts other people is a page permission.

**Importing and exporting are documented** for people using SONE, not just for
the record: [docs/import-export.md](docs/import-export.md) says what an archive
must look like, what round-trips and what does not, and answers the questions
worth asking before trusting it with your notes.

**PDFs are drawn by SONE itself now** ([ADR-0048](docs/adr/0048-pdf-viewer.md)):
a scrolling column of pages with a page count, the same on a phone as on a
desktop. The browser's embed showed only the first page on iPhone and iPad and
would not scroll. The renderer is downloaded the first time a PDF is opened and
never otherwise.

**A whole workspace can be exported** — "Export this workspace" under This
workspace ([ADR-0044](docs/adr/0044-import-export.md)). The archive is packed in
the background, so the page need not stay open, and the download is available for
a day (`SONE_JOB_RESULT_HOURS`). An archive holds what its asker can read at the
moment it is packed: less if their access changed in between, never more.

**Fixed: a favourite was drawn with a default icon** instead of its own, and a
favourited canvas appeared as a page.

**The sidebar has two sections that fold**, Favourites and Folders, separated by a
line — and a `+` on the Folders heading replaces the "New folder" button at the
foot of the tree. Whether a section is open is remembered.

**An archive can be imported**: "Import…" in an entry's ⋮ menu
([ADR-0044](docs/adr/0044-import-export.md)). Choosing a file shows what would
happen — the pages and folders it would create, which names are already taken,
what will not come — and nothing is written until you confirm it. Nothing existing
is ever replaced. **The files come with it**: a picture in the archive arrives as a
picture, stored here and linked to the page that used it.

**Fixed: the export window opened at the foot of the menu** instead of centred
like the sharing window. **Fixed: the sharing window's title was in English.**

**A person can be given permission to comment on a page without being able to
edit it.** The role has been in the access model since the beginning; no screen
offered it. **Fixed: a share link's roles were shown in English** in an otherwise
translated interface.

**Fixed: a past version showed every heading and list item as a paragraph**, and
an exported page did the same — both were written against block names that do not
exist.

**Fixed: bold and italic were stored in the search index as literal `<strong>`
tags.** Every document's text had been projected by serialising it rather than
reading it, so searching for a mark's name matched half a workspace and a word at
the start of a bold run could not be found at all. Existing pages are corrected as
they are next edited, or by a rematerialise.

**Fixed: a filled button went pale on hover** and its label vanished into the
background.

**A page and everything under it can be exported**: "Export…" in an entry's ⋮
menu, as Markdown files with the attachments beside them, in one archive
([ADR-0044](docs/adr/0044-import-export.md)). Leaving the files out makes it small
enough to email. Exporting a whole workspace needs the job runner the record
describes; importing is the next piece.

**A page has a History panel** ([ADR-0047](docs/adr/0047-page-history.md)): the
moments it was kept at, who wrote in between, and what it said — read in place of
the page, with a way back to now. A version is taken when a sitting ends and
always before compaction, which is where a page's past used to be discarded. The
panel says how far back the list goes and that it does not go all the way, because
history begins when it was switched on. **A version can be restored** — as an edit
applied forward, so everything since stays in the list and the restore becomes a
version of its own. Comments are not touched.

**A reply has a Reply button.** Enter still sends it; the button is for everybody
who did not know that.

**Fixed: deleting a comment left its highlight in the text** until the page was
reloaded.

**Commented passages are marked**, and how much is up to the reader:
highlighted, underlined, or not at all, with a switch in the comments panel to
turn them off for the page you are reading. **Threads fold**, one at a time or all
at once, so you can concentrate on one part of a page.

**Fixed: a filled button turned pale on hover** — near-white text on pale grey,
which read as an empty box. **Fixed: comment threads had a bullet** and an indent
to make room for it.

**Comments are searchable, and a workspace can list what is still waiting.** A
page's threads are projected into the database, so "what has somebody asked that
nobody has answered" is a query rather than a hunt — and the text of a discussion
is now found by search, which is often where a decision is actually explained.

**Pages can be commented on** ([ADR-0046](docs/adr/0046-comments.md)). Select some
words, press Comment, and write. Commented passages are underlined, replies and
resolving live in the panel beside the page, and a thread whose text somebody
later deletes keeps the words it was about instead of disappearing.

**The document format is version 4**, for comments. A browser holding an older
build is asked to reload.

**Pages can be started from a template** ([ADR-0045](docs/adr/0045-templates.md)).
Mark any page — or any canvas — with "Use as a template" in its ⋮ menu, and it is
offered under the `+` beside every folder. The copy keeps everything the editor
can hold: collections, tables, boards, drawings.

**Fixed: somebody could appear in the People panel and then vanish.** Writing
inside a canvas note or a collection's properties was invisible to the tidying
that removes names whose words are gone, so it removed names whose words were
still there.

**Fixed: two confirmation questions were still in English**, and the one for
trashing an entry said "delete" when the entry is recoverable for thirty days.

**An entry's ⋮ menu is reordered**: what you can make inside it near the top, then
where it can go, then how it looks, with the trash on its own past a line.

**A canvas has a hand tool**, so the board can be moved on a phone or tablet.
**Fixed: the ink colours were squashed into ovals** on a narrow screen.

**Fixed: a canvas showed a sheet on its own heading**, and did not appear in its
folder's list at all. Both were the same line of code written out in five places;
it is one function now.

**A picture placed on a canvas now appears in the page's Pictures panel.** It has
no block to scroll to, so pressing it opens the file.

**Fixed: drawing over a note or a picture put the stroke behind it**, and "bring
to front" could not help — the board was two layers with all the ink underneath.
It is one stack now, in one order, and a drawing tool reaches the board through
whatever is on it.

**Fixed: the buttons on a canvas item's handle did nothing.** The press reached
the board underneath, which cleared the selection before the click arrived.

**Fixed: the + menu in the tree was cut off** by the content area. It is the same
panel as the ⋮ menu now — same width, same alignment, opening the same way.

**A visitor using a share link now appears by the name they gave**, marked as a
guest. **A read-only link no longer asks for a name** — it is only needed so
others can see who is editing. Writing that still cannot be attributed — from before the page began
keeping track, or by somebody who gave no name — is stated rather than left
silent.

**The pen draws in the workspace's own palette**, plus any colour you pick.

**Fixed: the People panel was always empty.** Attribution was switched off by a
single hardcoded `null` — nobody's edits were ever recorded, on any page, since
the panel was built. Writing done from now on is attributed; anything typed before
this cannot be, because the information was never captured.

**The canvas tools are icons**, and a line is now visible while it is being
drawn.

**Anything on a canvas can be picked up** — strokes and shapes included — and
whatever is selected carries a small handle: duplicate, lock in place, bring to
front, remove. **Fixed: a picture could not be dragged**, only copied.

**A canvas has shapes, pictures and a ruling.** Rectangles, ellipses and lines are
dragged out like a selection; a picture can be inserted from the toolbar as well as
dropped; and the board can be dotted, squared, lined or plain.

**Fixed: nothing could be drawn on a canvas** after the last release — everything
was being placed thousands of pixels off screen. A note placed with the text tool
also has the caret straight away now.

**Fixed: the icon picker offered a sheet as a canvas's default.** The first
swatch — the one that means "no icon of its own" — now shows the brush, and is
selected until another is chosen.

**Fixed: a canvas was drawn as a document in the tree.** It has a brush of its
own now, and the three things you can add are shown with the marks the tree draws
them with.

**A canvas has no scrollbars and no edges.** It fills the window below the
heading, the wheel moves the board, ⌘ or Ctrl with the wheel zooms about the
pointer, and the percentage takes you back to where you started.

**An entry's ⋮ menu is shorter and wider.** Rename, favourite, share and the two
reorderings are one row of marks; what can be added inside a folder is another,
under "New". Everything still says what it is when you rest on it.

**The document format is version 3.** A browser holding an older build is asked to
reload rather than being shown a canvas it cannot draw.

**A page can be a canvas** ([ADR-0043](docs/adr/0043-canvas.md)). The `+` beside a
folder now asks what to add — a page, a canvas or a folder — and a canvas is
offered in a folder's own view and its ⋮ menu as well. a pen in five colours and any thickness, text notes you can place
and drag anywhere, pictures dropped straight onto the board, and a corner to
resize what is selected. It zooms from a quarter to three times, drags a band across the
board to catch several things and move them together, pans with the middle button
or a held space, has an eraser, and undoes with ⌘Z — your own changes only, never
somebody else's. Everything on it merges
properly when two people work at once. Connectors between items are not built.

**A page can be set to the full width of the window**, under Width in the panel
beside it. The reading column stays the default; this is for the pages that are
not prose — a wide table, a board, a page of pictures. The setting travels with
the page, so it looks the same on every device and for everybody.

**The block menu's six actions are one row of icons** — move up and down, out and
in, duplicate, delete — instead of six rows of text, and the duplicate "Nesting"
section is gone. **The block menu has marks too**, the same ones the `/` menu uses, and alignment is
four icons instead of four words. **Fixed: the block menu could scroll sideways** —
a row of choices that did not fit made the whole menu overflow.

**The interface moves a little** ([ADR-0042](docs/adr/0042-motion.md)): a button
gives under a press, a tree branch fades its children in, and switching a panel
fades its body. All of it is off for anybody who has asked for less motion.

**The bar at the top is no longer a tinted band** — it sits on the same surface as
the page, and a line appears under it only once something has scrolled behind it.
**Both panel toggles are the same shape now**, mirrored, instead of a sidebar icon
on one side and an arrow on the other — and both are rounded like every other
button.

**Fixed: the block controls could sit where the text used to be** — after opening
or closing the page panel, which changes the editor's width without the window
noticing.

**Fixed: the panel beside a page had English headings**, and so did a good deal
else that a screenshot does not show — the filter conditions, the column types,
the whole block menu, the table toolbar, the undo tooltips, the roles and access
levels. A label held in a table of options is not markup, and the check for
untranslated text had only ever looked at markup.

**Fixed: notes ran into the tables and buttons above them** in the accounts and
maintenance panels. **A checkbox now has space between its box and its words**, and
the explanation under it lines up with the label. **The maintenance report is
stacked** rather than squeezed into two columns. The remaining English in the
administration area is translated: the accounts note, the storage advice and the
four counters.

**Fixed: the administration area showed key names instead of its headings**, and
**every longer explanation is translated too.** The guard that was supposed to
catch untranslated text could not see a sentence written across more than one
line, which is what all the long explanations are — so it had been reporting those
files clean.

**The interface is translated.** Every screen, dialog, menu and panel — the page
title, the formatting toolbar, the workspace switcher, the invitation screen, the
admin lists. Switch the language under Appearance; whether it says "du" or "Sie" is
the instance's setting.

**Invitations, groups, page permissions, single sign-on and the member list speak
German.** Thirty files are translated, and about eighteen lines of English are left
across the smaller panels.

**Six more areas speak German**: sharing a page, a workspace's typography and its
mark, where a workspace opens, a folder's own view, and moving an entry inside a
workspace. Twenty-two files are translated; what is left is mostly the panels for
invitations, groups, page permissions and single sign-on.

**The language can be chosen**, under Appearance: match the browser, English or
Deutsch. It applies at once, without a reload, and it follows your account rather
than the browser — unlike the text sizes beside it, which stay per device.

**The whole interface speaks German** — the sign-in and setup screens included,
which now take their language from the same `Accept-Language` negotiation the
server has always done. Fifteen files, and the guard's list is the record of them.

**The table of entries and the block menu speak German.** Fourteen files are
translated; only the sign-in and setup screens are still English, and they are
waiting on a decision about where the language is resolved.

**The administration area speaks German.** Twelve files are translated; what is
left in English is the collection table, the block menus and the sign-in screens.

**The `/` menu speaks German**, and searching it does too: typing "übersch" finds
"Überschrift 1", while "h1" keeps working as it always did.

**The panel beside a page and a view's filter and sort rules speak German.** Ten
files are translated; the admin area, the editor's own menus and the collection
table are still English.

**The workspace settings, the trash and search speak German too.** Eight files are
translated now; the admin area, the editor's menus and the collection table are
still English.

**The settings speak German**: the three areas and their switcher, the way back to
your notes, and every section of your own settings — profile, signing in,
appearance, where you land, about. Five files are translated now.

**The sidebar and an entry's menu speak German too** — the tree, the favourites,
search, and every entry in the ⋮ menu including the icon and colour picker. Four
files are translated now; the rest of the interface is still English.

**Every error message is translated.** All twenty-two of them, in German as well —
the table moved out of the sign-in screen and into the catalogue, which is where a
second language can reach it. The messages that diagnose a deployment keep their
technical terms in both languages, because an operator has to find them again in
their own configuration.

**The account menu has a mark beside every entry.** The three settings areas carry
the same symbols there as in the switcher at the top of a settings column.

**Whether the interface says "du" or "Sie" is an instance setting**, under
Administration → Settings. It applies to German and any other language that
distinguishes the two; English is unaffected. New instances say "du".

**The interface can speak German** ([ADR-0041](docs/adr/0041-interface-language.md)).
The machinery is in place — a catalogue, plural rules per language, and a language
chosen from your own setting, then the workspace's, then the browser's — and two
screens use it so far. The rest of the interface is still English and will be
translated a file at a time.

**A browser running an older build than the server now says so**, in a strip under
the topbar with a Reload button, instead of only in Settings → About.

**Entries in a table can be selected** ([ADR-0040](docs/adr/0040-row-selection.md)),
with a checkbox per row and one in the heading for everything the view is showing.
A selection can be **copied** — as the same tab-separated grid a paste reads, so
copy-and-paste duplicates entries anywhere — **exported as a CSV file** of exactly
the rows on screen, or **moved to the trash**, where they can be brought back.
Selecting works without edit rights, since reading a table is when a copy is most
wanted.

**A table in the text can be made wide or full page**, like an image, and scrolls
sideways when it is wider than the room it has. **Its cells also read a step
smaller** than the prose around them — at the body size a narrow column wrapped
every second word.

**Fixed: a full-width table looked a few pixels too wide.** It was not the block —
the selection outline is drawn two pixels outside it, which is right inside the
column and wrong for a block that already reaches both edges. It is drawn inside
now, and the table's frame loses its side borders there for the same reason.

**Fixed: Column, Wide and Full page did nothing for a video, a table or a file.**
The setting only ever reached an image. A player or an embedded frame now runs to
the page's edges the way a picture does, capped so a wide video still fits on
screen.

**Fixed: changing a table's row height did nothing.** The height comes from the
padding inside a cell's controls, not from their minimum height, so the setting had
been adjusting a number that never decided anything.

**Fixed: a select column's option editor was cut off** at the edge of the table,
the same way the column menu used to be — a scrolling container clips both axes.

**A collection can be shown as a gallery** ([ADR-0160](docs/adr/0160-gallery-view.md)):
cards with a cover, switched to like the board. The cover is the first image in a
files column, and an entry without one gets a blank panel rather than a
placeholder. The offer to add one appears once the table has a files column. No
migration.

**A table's row height can be set**, under "Filter and sort" beside the rules it
belongs with: compact, normal or tall. It is the view's setting rather than the
table's, since the same entries can be a list in one view and an overview in
another — and compact still leaves a tap target on a touch device.

**Fixed: a table block had no handle.** Clicking the frame around a table now
selects the block, which is what brings up the ⋮⋮. It appeared for a moment after
inserting one and never again, because inserting is the only thing that had been
selecting it. Clicks inside the table — cells, views, buttons — are still the
table's own.

**A video block can be reached by its handle.** Clicking beside the player selects
it, which is what brings up the ⋮⋮ — and with it the width and the card and link
forms. Clicking the player itself still plays it.

**Fixed: favourites from other workspaces appeared in the sidebar**, where they
could not be opened — and the refusal said "you no longer have access to this
page", which was not what had happened. The sidebar now asks for the favourites of
the workspace you are in.

**Fixed: a video block was deleted moments after being added — by another open
tab** ([ADR-0039](docs/adr/0039-client-schema-refusal.md)). A page open in a
browser that predates a block type does not ignore that block: it removes it from
the shared document, for everybody. Such a client is now refused with an
instruction to reload, instead of being allowed to delete writing it cannot draw.

**Operator note: after this upgrade, every open tab must be reloaded** before it can
edit again. That is the fix working.

**Fixed: a video disappeared moments after being added.** Its block was the one
piece of content that did not take itself out of the editor's editable region, so
the browser treated the player as text it could edit — and removed it.

**An upload in progress says so.** A video is the first thing SONE sends whole — a
photograph is shrunk in the browser first — so eight megabytes was seconds of
silence, which is indistinguishable from nothing happening. The picker also offers
every format the server will actually store, rather than a shorter list.

**An entry can be moved to another workspace** ([ADR-0038](docs/adr/0038-move-between-workspaces.md)),
with everything under it: "Move to a workspace…" in an entry's menu. It offers the
workspaces you own or administer, then says what the move will cost before it does
anything — how many entries and files move, how many will arrive without the
restriction they have now, how many share links stop working, how many links to
entries left behind are severed.

**The `/` menu has a mark beside every block**, and **fixed: its highlight
sometimes ignored the mouse.** Moving the pointer inside a row now moves the
highlight to it — before, only arriving in a row did, so pressing the arrow keys
or scrolling left the highlight elsewhere with the mouse sitting on an entry that
would not light up.

**Video** ([ADR-0037](docs/adr/0037-video.md)). Type `/` and choose Video: upload
one, paste a link from YouTube, Vimeo or PeerTube, or point at a live HLS or DASH
stream. Content width by default, and the ⋮⋮ menu offers full width, a card or a
single line — a stream is a player only.

**An embedded video loads nothing from its provider until you press play.**
Opening a page that contains one tells YouTube nothing.

Nothing is converted: a video is stored as you sent it, and the upload says at the
moment you choose the file whether this browser could play it — an iPhone `.mov` is
usually HEVC, which Safari plays and other browsers do not. A live stream plays in
Safari and iOS; other browsers say so and offer the address.

**Downloads are resumable, and no longer read into memory whole.** A file is
streamed and byte ranges are answered, which is what makes seeking in a large file
possible at all — the groundwork for video ([ADR-0037](docs/adr/0037-video.md)) and
an improvement to every large download on the way.

**Fixed: the mark on the settings switcher was drawn the width of the column.**
Two icons in the set had no size of their own and filled whatever they were put
in; a stylesheet happened to size them in the sidebar.

**The settings columns carry your account menu too**, so the trash, the other
settings areas and signing out are one click away from anywhere rather than back
through the notes. **Fixed on the way: that menu did not close when you clicked
outside it.**

**The workspace settings say which workspace**, under the area name in the
switcher. "This workspace" is true of all of them.

**The settings screens have a switcher at the top of the column**, in the place
the workspace switcher occupies in the application and looking exactly like it —
holding the three areas rather than workspaces. Getting from the instance's
administration to your own profile no longer means leaving the settings and coming
back in.

**The settings screens look like the rest of the application**: the section is
white paper, the list beside it carries the same faint tint the sidebar does, and
the cards and framed tables are set off from the page again. They had kept the old
arrangement — tinted page, white list — after everything else was turned over.

**A misspelled search offers names that are close** ([ADR-0036](docs/adr/0036-search-typo-tolerance.md)).
"Testordnr" found nothing at all before. Suggestions appear under their own
heading, only when the search itself found little, and only for names — a typo in
the middle of a page's text still finds nothing. No operator action; one migration
enables `pg_trgm` and indexes titles.

**Your profile and your password are two settings sections** rather than one long
one. Signing in is where single sign-on and a second factor will go.

**Workspaces can be reordered from the keyboard**: `⌥↑` and `⌥↓` on a row in the
switcher. Dragging was the only way before, which left anybody not using a pointer
with no way at all.

**Pasting more than fifty entries says how many were left over**, and says it as a
note rather than an error — fifty went in, and the rest is still on the clipboard.

Nothing else an operator or a reader would notice: `pnpm lint` runs for the first time
(it was in the scripts and had never had eslint installed or configured), and the
architecture records now say which decisions are actually implemented — nine of
them still said "not yet" long after they were.

**A collection is content in a page, not a folder.** 0.2.0 made a folder *be* a
table and put every row in the sidebar; a folder stopped meaning one thing, and a
hundred-row table meant a hundred sidebar entries. A page can now hold
collections — several, as in Craft — and a folder is a folder again.

**Rows are documents that are not in the tree.** Each one is a real page you can
open, with its own writing, and none of them clutter the sidebar. Craft and
AppFlowy both work this way; [ADR-0021](docs/adr/0021-collections-in-pages.md)
records why.

**A collection can be placed in the text.** Type `/` and choose "Table of
entries": the collection is created and a block for it appears where the caret
is, between paragraphs, as in Craft and AppFlowy. Several per page.

**Fixed: "Add columns" appeared to do nothing.** The collection was created and
nothing displayed it — the folder's row was never marked as one, because that
mark was read from a document field that nothing writes. Every collection made
since the feature shipped was invisible.

**Filters and sorting can be set.** The button beside a collection's views opens
them, and says how many rules are active rather than only "Filter" — a table
showing fewer rows than expected is the kind of thing people blame on the
software. The work happens in the database, as it already did; what was missing
was any way to reach it.

**A collection can be searched.** The box beside its views matches an entry's
title or anything in its cells, and narrows whatever the view already showed
rather than replacing it. Substring matching, not stemming: typing "plan" finds
"planning" and "unplanned", which is what a table's search box is expected to do.

**Two corrections in a collection's table.** The title column now says it is
fixed rather than simply lacking the bin every other column has, and the menu
for choosing a new column's type opens towards the empty space beside the table
instead of back across the rows it is about to add to.

**Fixed: the maintenance log reported every collection row as a misplaced
entry.** A row lives inside the page holding its collection by design
(ADR-0021), and the check predates that. It was logged every five minutes.

**A table can be filled by pasting** ([ADR-0034](docs/adr/0034-collection-table-editing.md)).
Copy a selection out of a spreadsheet, click an entry's name and paste: each line
becomes an entry and each column fills the column you pasted into and the ones to
its right. Up to fifty at a time — and a second paste is **added below** rather
than replacing what is there, so more than fifty is two pastes. Add the columns
first; a paste fills columns that exist and never invents one, because guessing a
column's type from data is how a PIN loses its leading zero.

**An entry's name is edited in the table**, with a small control at the end of the
cell to open its page. Filling the first column no longer means leaving the table.

**Undo and redo for a table**, and a button that moves every entry to the trash —
where "to the trash" is literal: an entry is a page, so nothing is destroyed and
everything can be restored.

**The menu for adding a column looks like the rest of the menus**, and names each
column type with an icon as well as a word. It had a frame and a type scale of its
own, and after being moved out of the table it inherited the page's font — so it
read as belonging to a different application.

**Fixed: the menu for adding a column to a table was cut off.** It opened inside
the table's own scroll area, which clips, so the column types below the fold could
neither be read nor chosen.

**A table column can hold files** ([ADR-0035](docs/adr/0035-files-column.md)) —
one column type for every kind, not one for images and another for PDFs. An image
shows as a thumbnail, anything else as its name; up to eight per cell, and each
one opens in a new tab. A file added here belongs to the entry's own page, so it
is reachable exactly as far as the entry is. No migration.

**Fixed: a table disappeared and a new one could not be added.** Introduced while
the paste work above was being built, and visible only once a page had loaded —
which is why the tests did not see it.

### Files, images and documents

**Documents can be uploaded, not only images.** Word, Excel, PowerPoint,
OpenDocument, PDFs, text and archives. PDFs and text are shown in place; a Word
or Excel file is offered as a file, because nothing here can render one and a
card that says what it is beats a viewer showing an error.

**Documents are a content element.** Type `/` and choose "File": a PDF or text
file opens as a viewer with its own scrollbar, and anything else becomes a card
with its name, type and size. Each block switches between card, one line, and —
where a browser can draw it — a viewer.

**Changed: a PDF is now shown in place** rather than downloaded. The earlier
caution was not wrong — a PDF viewer is a large attack surface — but a notes tool
where a PDF cannot be read is one where people keep their PDFs elsewhere. The
hardening that makes it acceptable is unchanged: the type comes from the bytes,
never the upload, and the response carries `nosniff` and a sandbox policy.

**Fixed: a PDF would not display.** The viewer frame was sandboxed, and
Chromium's built-in PDF viewer does not run in a sandboxed frame at all — first
it showed only page one, then Brave refused to show anything. PDF frames carry
no sandbox now. What keeps that safe is unchanged and stricter than it sounds:
the type is decided from the file's bytes rather than from the upload, `nosniff`
stops the browser reconsidering, and the document is served with permission to
load nothing at all.

**Fixed: a file with an umlaut in its name could not be opened.** Serving it
threw while writing the `Content-Disposition` header — HTTP headers carry only
ASCII — and the viewer showed an internal error where the document should have
been. Every file with an accent, an umlaut or a CJK character in its name was
affected. The name is now sent both ways RFC 6266 allows: a plain ASCII form
any client understands, and the real name UTF-8 encoded.

**A file block has a menu**: open in a new tab, download, and how to show it —
card, one line, or a viewer. The name itself opens anything a browser can draw
and downloads anything it cannot, so the common case needs no menu at all.

**Fixed: a file block's menu stayed open.** Its stylesheet set `display`, which
beats the browser's own rule for `hidden` — so the element carried `hidden` and
rendered anyway. No event handling could have fixed that, and the first attempt
tried.

**Files can be dropped onto a page**, several at once, and they land where they
were dropped. An image becomes an image block as it always did; anything else
becomes a file block.

**Fixed: a file card's menu sat below the card** rather than at the end of its
first line, where the other displays put it.

**Fixed: an image, a file or an embedded table had no drag handle.** A block
that cannot hold a text cursor was invisible to the gutter, so the ⋮⋮ menu — and
with it width, alignment and moving the block — could not be reached for any of
them.

**A file's actions moved into the ⋮⋮ menu**, where every other block's settings
already are — opening, downloading, and whether to show it as a card, one line
or a viewer. The `···` button on the block is gone.

**Fixed: no drag handle on a touch device.** Tapping a file now selects it, so
the ⋮⋮ handle appears — there is no hover on a phone or tablet to fall back on,
and the block was swallowing every tap. The gutter is also fully visible there
rather than half-faded, which had read as disabled.

**Fixed: the ⋮⋮ handle appeared at the top of the page** for an image or a file
instead of beside the block.

**An image is offered two widths instead of three**, and full width now reaches
the edges of the page. "Column", "wide" and "full" all read as the width of the
text give or take — three names for one thing.

**An image can be shown as a card or a link**, not only as a picture — the same
three layouts a file has, because an image is a file with a special way of being
drawn.

**Fixed: the ⋮⋮ controls vanished over a full-width image.** They sit beside the
block, which is empty margin beside a paragraph and a photograph beside a
full-width image. They carry their own background now.

**Fixed: a full-width image pushed the page sideways.** "Full page" meant the
window, sidebar included; it means the page's own area now, and the page cannot
scroll horizontally at all. A full-width image runs to both edges with no
corners and no border — a block with no ends does not need them marked.

**Large images are shrunk for display.** An uploaded photograph is stored as you
sent it and shown at a size a page can use; the ⋮⋮ menu offers "Download the
original" beside "Download" ([ADR-0029](docs/adr/0029-image-variants.md)).

### Who wrote what

**Attribution is being recorded.** Every editing session by a signed-in member
is now mapped to that person in the document, which is what makes "who wrote
this" answerable later. Nothing displays it yet — recording starts first because
attribution is not retroactive
([ADR-0022](docs/adr/0022-attribution.md)): an edit made before the mapping
exists can never be attributed.

Share-link guests are not recorded: there is no user id to record against, and
attributing to "a guest" would make one contributor out of several people.

**A "People" tab lists who has written in a page** — everyone who has, whether
or not they are here now, which is what the circles at the top show instead.
Somebody who has since left the workspace stays in the list: they wrote what
they wrote.

**Choosing somebody in the People tab marks what they wrote.** Choosing them
again clears it. Only writing recorded since attribution began can be marked —
it is not retroactive.

**The chosen person in the People tab is cleared when you open another page.**

**Attribution is pruned.** When nothing of somebody's writing is left in a page,
their entry goes with it — deleted text should not keep a name in the record
([ADR-0022](docs/adr/0022-attribution.md)).

### Access: permissions, groups and protected sections

**Protected sections.** Type `/` and choose "Protected section" to put a part of
a page behind its own permissions. It is a separate document, so the server
declines to send it to people who may not read it — the only way a permission on
part of a page can be enforced ([ADR-0026](docs/adr/0026-page-permissions.md)).

**Fixed: a restricted page was hidden from the tree and still synchronised.**
The listing stopped showing it and the protocol went on serving its document to
anybody holding the id. Restrictions are now checked where sync decides.

**Groups.** A group is a list of people, granted access to a page exactly as a
person is. Membership is the thing maintained — leaving a group takes its access
with it. Manage them under Settings → Groups, and give
one access to a page in the sharing dialog.

**Page permissions are enforced in the tree, in search and in favourites.** A restricted page and everything
under it is absent for people who were not granted it; a page kept only as the
path to a granted child appears without its title. Set them in the sharing dialog: give
somebody access to a page, or restrict it so only the people you name reach it
and everything under it
([ADR-0026](docs/adr/0026-page-permissions.md)).

### Accounts, invitations and single sign-on

**Everybody has a workspace of their own.** Created with the account, always —
including for existing accounts, which get one on upgrade. Somebody invited to a
team now lands in both ([ADR-0025](docs/adr/0025-personal-workspaces.md)).

**Fixed: every account created through sign-up became an instance
administrator.** Only the first one does now.

**Invitations are two things now.** An invitation to the instance creates an
account and nothing else — the person lands in their own workspace. An invitation
to a workspace works for people who already have an account, which previously had
no path at all.

**Invitations have an API at all.** They existed in the server's domain layer
since the authentication work and nothing ever exposed them, so in practice the
only way into a workspace was to be there when it was made.

**Invite people to the instance** under Settings → Invite people. They get an
account and a workspace of their own; adding them to a team is a separate step.

**An invitation followed while signed in now asks whether to join.** It used to
do nothing at all: the sign-up screen only appeared for people without an
account, so somebody who had one landed in their own workspace with no sign the
link had meant anything.

**Invite somebody to a workspace** under Settings → Workspace. Works whether or
not they already have an account: with one they are asked to join, without one
they register first and end up in both their own workspace and yours.

**Fixed: accepting an invitation left you in your own workspace** rather than the
one you were invited to — a member of a team, looking at nothing to do with it.

**Fixed: creating an account from an invitation ended on an error.** Registering
uses the invitation, and the page then looked the same token up again, found it
spent, and reported a failure — after everything had worked.

**Single sign-on.** Set `SONE_OIDC_CLIENT_SECRET` and configure the issuer in the
administration area under Settings → Single sign-on; the sign-in page then offers
a button beside the password form. One OIDC client rather than an integration per provider, so Keycloak,
Authentik, Zitadel, Entra, Google and the rest are a configuration
([ADR-0024](docs/adr/0024-oidc.md)). Password sign-in stays. One OIDC client rather than an integration per
provider, so Keycloak, Authentik, Zitadel, Entra, Google and the rest are a
configuration ([ADR-0024](docs/adr/0024-oidc.md)).

**Invitations you have sent can be seen and withdrawn.** Both invitation forms
produced a link and then forgot it, so one sent to the wrong address stayed valid
until it expired and nothing said it existed. The list sits under the form it
belongs to — This workspace → People, and Administration → Invitations — and shows
who each is for, how often it has been used and when it expires. The link itself
is never shown again: only a hash of it is stored, and a list that reprinted them
would turn "who can open this screen" into "who can join".

**A workspace's owners and administrators can manage their own members**, under
This workspace → People: roles, removing somebody, and inviting. It needed the
instance-wide right before — not because the server asked for it, but because the
table only existed inside the administration screen. Every member sees the list;
those who may not change it read it.

### Settings, your account and administration

**Settings are in three named areas** — You, Workspaces, Instance — and every
entry says in one line what is inside it. The two invitations are now told apart
by name: one gives an account, the other puts somebody in a team.

**A right for managing workspaces**, granted per account under Settings →
Accounts, with a way into the workspace list from the workspace switcher: create, edit, invite
to and delete workspaces, and set who is in them. Not accounts, not single
sign-on, not maintenance — and not reading anybody's pages
([ADR-0027](docs/adr/0027-administration-areas.md)).

**Every workspace in one list**, with people, pages and when each was last
edited — and open one to change
what people may do there, remove them, or invite somebody. Personal workspaces are counted and folded away, so a hundred accounts
do not read as a hundred teams.

**A workspace can be deleted** from the list, by typing its name. It stops
appearing to everybody in it and can be restored for a month, after which the
maintenance job removes it. `SONE_WORKSPACE_RETENTION_DAYS` changes that.

**Settings is a screen of its own**, with its own navigation and a way back to
your notes — not a page inside the workspace with a sidebar of pages beside it.
The entries are names now; the explanation is on each entry rather than under it.

**Your account is editable.** Change your name, and change your password without
signing out. Settings → Account.

**Settings pages have structure.** Controls that belong together sit in a card,
each row says what it is and why, and space between cards separates one topic
from the next.

**Every settings panel got the same rhythm** — field names read as names, the
sentence under one is quieter than both, and consecutive fields are a list
rather than a paragraph.

**Appearance and Where you land are in cards too**, and each choice now says
what it does rather than only what it is called.

**Every settings panel now shares one shape** — cards of labelled rows for
settings, and the same frame around the tables that list workspaces and groups, each row saying what its
setting is for and where its value came from.

**Fixed: settings labels wrapped one word per line** and the page was cropped to
a narrow strip.

**Settings work on a phone.** The list and the section are two views rather than
one stacked on the other, so a section gets the whole screen instead of scrolling
in whatever the menu left over.

**Profile pictures.** Choose one under Settings → Account; it is shrunk in your
browser before it is sent, and shows in the sidebar and beside your name.

**Your picture opens an account menu** — edit your profile, settings, trash,
sign out — instead of a row of icons.

**The foot of the sidebar is a row of tools** — your account, trash, settings,
sign out — instead of three lines of text competing with the pages above them.

**Settings are three places instead of one list** ([ADR-0032](docs/adr/0032-three-settings-areas.md)):
your own settings, this workspace, and — only if you administer the instance —
the instance. The account menu had two entries that landed on the same page; it
now has one per area. **Two sections come back with this: a workspace's
typography and its groups had fallen out of the navigation and could not be
opened at all**, which is where the per-workspace font sizes went. Old
`/settings/…` links are redirected to wherever their section now lives. No
operator action.

**SONE opens where you left off.** Each workspace remembers the page you were
last on, and you can choose a fixed one instead under Settings → Where you land.
It applies on sign-in, on a workspace switch, and whenever SONE is opened without
a page in the address.

**Fixed: switching workspaces opened a page from the one you left.** The tree
was still the old one for a moment, and the root redirects to its first page —
so the server refused it, correctly, to somebody who had only pressed a switcher.

**Fixed: switching workspaces still reported no access.** The connection
reconnects on a switch, and a page opened against the old one is refused —
correctly, about a moment that had already passed. A refusal is only shown once
the connection has settled.

### Workspaces

**Drag your workspaces into the order you want.** The switcher was alphabetical,
which is nobody's order; now you arrange it and it stays that way
([ADR-0031](docs/adr/0031-workspace-order.md)). Press and hold a row on a touch
device, or just drag it with a mouse. The order is yours alone — arranging your
list does not change anybody else's — and the first workspace is the one a
browser with nothing remembered opens, so dragging the one you live in to the top
makes it the one you land in. No operator action: the migration runs on start,
and a list nobody has arranged stays alphabetical until somebody does. Reordering
is a drag only; there is no keyboard equivalent yet.

**Fixed: a workspace marked for deletion still appeared in the switcher**, so it
offered somewhere to write that the rest of the interface had already taken away.

**Fixed: the switcher panel was wider than the sidebar** — it sat hard against
the page on one side, kept a gap on the other, and its rows stepped to the right
of the button that opened them. Both of its edges are now the sidebar's edges,
and the marks stay on one line.

**Dragging a workspace now shows which workspace you are dragging**, the way the
page tree does — the two lines said where it would land and nothing said what was
moving.

**Fixed: the workspace button was 8px narrower than the menu that drops out of
it.** The sidebar's collapse button is hidden on a wide screen and its container
still took up a gap.

### Search

**Search finds a part of a word, and a result says what it found**
([ADR-0033](docs/adr/0033-search-results.md)). Typing "testordn" now finds
"Testordner"; the last word you type matches as a prefix while the earlier ones
stay exact. Each result is a card with its own icon, whether it is a page or a
folder, the path to where it lives, and the passage that matched with the match
marked — and clicking it lands on that passage rather than at the top of the
page. Typos still find nothing; that is a separate change. No operator action and
no reindex.

### The right panel

**The right panel lists the files, images and links in the page.** Files and
links open from the list, with a control on each row that goes to where it sits in
the page; images are thumbnails, and clicking one takes you to it. **The tabs are
icons now** rather than words, so there is room for the three new ones — each
still says its name when you hover it, and the chosen one is named above the
panel.

### How it looks

**The interface is built on design tokens.** Colours are named for what they are
for rather than what they are, and a theme is a list of values rather than a set
of overriding rules — so a third one becomes a block to fill in
([ADR-0028](docs/adr/0028-design-tokens.md)). Light and dark look as before; this
is the layer everything after it stands on.

**Headings are thin and larger.** The same emphasis by other means: size carries
the weight rather than stroke width, so a heading reads as a change of level
rather than an announcement.

**Fields, buttons and menus share one treatment.** A field is a surface that
gains a border when focused; buttons come in three weights; everything that
floats has the same surface, border and lift.

**Fixed: checkboxes and radio buttons rendered as full-width blue lozenges**, and
the settings navigation was centred down the middle of its column.

**The areas are separated by surface rather than by lines.** The rule between
sidebar and content is the faintest one available.

**Fixed: the page heading was drawn as a text field**, and the four marks at the
foot of the sidebar stacked instead of sitting in a row.

**Fixed: the ⋮⋮ handle covered the menu it had just opened**, on a tablet — and
swallowed the tap meant for the first entry.

**Fixed: paragraph spacing was the browser's, not ours.** Six styling rules were
written for a class the editor does not emit, so they matched nothing and
paragraphs fell back to a default margin that sat oddly beside headings with
deliberate ones. That is the uneven spacing that was reported.

**A workspace can have its own defaults for how elements look** — size, colour
and spacing per element kind. It fills the gaps a block leaves rather than
overriding: a block that carries its own setting keeps it, and one that does not
follows the workspace, including when the workspace changes later.

Stored per workspace and set by owners and admins. Nothing is written into
documents, and a workspace with no theme renders exactly as every workspace did
before. Set it under Settings → Appearance defaults. Every control offers "As designed",
which removes the setting rather than storing the value it currently equals — so
a workspace that has chosen nothing keeps following the design as it changes.

**A workspace decides what its eight colours look like.** Settings → Appearance
defaults → Palette. Everything that stored a name — tags, columns, blocks, folder
icons — follows, which is what names were for.

**Fixed: an icon's colour could not be cleared.** The new icon was assigned onto
the old one, so a request naming no colour left the previous one in place — "no
colour" was the one swatch that did nothing. The swatches also sit in two rows of
five rather than one row that was always one too wide.

**A colour of your own, beside the eight.** Anywhere a colour is chosen there is
now a pipette beside the swatches, carrying whatever colour was picked, and it
opens the platform's own colour picker. The eight names remain the
vocabulary, so changing what a workspace's "blue" means still moves every blue
thing; a custom colour is the escape for what a palette cannot cover.

**Fixed: the icon picker scrolled sideways as well as down.** It fits as many
columns as the menu is wide now. The colour swatches also land in whole rows
rather than a row of seven and a stray pair.

**Every icon in the set is available, with a search box to find one.** Type
"boat" rather than hunting through squares. The curated fifty are gone; a name is
now checked by shape rather than against a list, and an entry whose icon a
version does not know simply draws the default.

**Fixed: every entry icon drew as the same sheet of paper.** A Lucide icon is an
object rather than a function, and the check that resolved a name rejected all of
them — so the picker showed fifty identical icons and choosing one changed
nothing. The set is also much wider now, beyond office work: food, weather,
travel, tools, music, health, study.

**Folders and pages can carry an icon**, with a colour for the icon and a
separate one for the name. A curated set of Lucide line icons, which match the
rest of the interface. Choose one from the ⋮ menu beside any entry.

**A workspace can have an icon and colours of its own**, chosen under
Settings → All workspaces with the same controls entries use ([ADR-0030](docs/adr/0030-workspace-appearance.md)). The switcher is
one line per workspace: a mark, a name, and the number of people only where there
is more than one.

**Fixed: the workspace switcher stacked its icons above the names** and centred
both. Its rows are now cards with the mark first, and the button lines up with
the search field below it.

**Fixed: choosing a workspace icon reloaded the page and looked as if nothing had
been saved.** It had been; the panel was thrown away and the list showed no
marks. The panel stays now, and the list shows the mark.

**Fixed: a workspace's name colour was saved and never shown**, and a colour
picked from the palette did nothing at all while a custom one worked.

**The writing is on white and the furniture is tinted**, where it used to be the
other way round. The sidebar, the top bar and the right panel now carry a very
slight warm tint — about two per cent — and the page itself is the brightest
thing on screen, which is the way round every tool people already use has it, and
the way round paper has it. Nothing changes in the dark theme: it already had
this relationship, and now both themes say so in the same words.

**A folder and a page are titled the same way**, and both show the icon and
colours you chose for them. A folder's name was bold and smaller than a page's,
and both drew the default icon for their kind — so decorating a folder changed
the sidebar and left its own page looking undecorated. The icon sits above the
name rather than in front of it, so the name stays on the column the text below
it lines up on. The entries listed inside a folder show their own icons too.

**Fixed: the ⋮ button on a sidebar row did not light up under the pointer**,
while the + beside it did, which made it look like nothing would happen.

**Editing a title is a line under the words rather than a box around them.**
Clicking a page or folder name turned it into a filled input the width of the
page, which read as a dialog opening instead of a caret being placed. The line
also appears faintly under the pointer, so a title says it can be edited before
you click it.

**The icon sits in front of a page or folder name again**, not above it, and the
heading no longer moves when you click it. A folder's name was a button that
became an input, and the swap changed the heading's height enough to nudge
everything below it down. It is the same input a page's title is now, so there is
nothing to swap.

### Writing and blocks

**Every block can be configured** from the ⋮⋮ menu: alignment, width and colour,
showing only the settings that mean something for that block. A wide paragraph
is just a harder-to-read paragraph, and an image has no colour to set.

**Blocks carry presentation: alignment, width and colour.** Three attributes
shared by every block type rather than a setting per kind, so a new block type
gains them for free. Width breaks out of the reading column — useful for an
image or a table, and ignored on a narrow screen where there is no margin to
break into.

The controls for these come next; this is the model and the styling.

**Fixed: a toggle could not be filled on a phone.** Its content is the blocks
indented under it, and indenting was only possible with Tab — which a phone
keyboard does not have. The ⋮⋮ menu now has In and Out, so nesting works
without a keyboard.

**Fixed: the page zoomed itself on a phone.** Tapping a small search or filter
field made iOS magnify the whole page, and it does not zoom back out — the next
gesture to fix that often landed on pull-to-refresh instead. Form controls are
now large enough on touch that the browser leaves the page alone, and the page
no longer pulls to refresh. Pinch zoom still works: disabling it would fix the
symptom by taking a capability away from people who need it.

**Edits survive a reload, not just a dropped connection.** A signed-in member's
browser keeps a copy of each document it opens; when the server comes back, the
two merge with no comparing and no conflicts to resolve — that is what a CRDT is
for.

A share-link guest gets no local copy: they are often on a borrowed machine, and
a link grants a page to read rather than one to keep. Signing out deletes the
copies, and ones untouched for 30 days are swept at startup.

**Fixed: losing the connection broke the layout.** The error banner was a child
of the app's two-column grid, so adding it pushed the sidebar into one row and
the page into another — the layout came apart at the moment something had
already gone wrong. It sits over the layout now, and the connection status
truncates instead of wrapping onto three lines and taking the bar's height with
it.

**A collaborator's name fades from their caret.** The bar stays — somebody else
is still in the document — but the label goes quiet a few seconds after they stop
typing, instead of sitting in the middle of a paragraph indefinitely. Hovering
the caret brings it back.

**Fixed: empty lines appeared on a page every time it was opened.** A document is
empty until the server's copy arrives, and the editor was writing an empty
paragraph into that emptiness on every visit — one per open, appearing anywhere in
the page depending on how the two edits merged. Existing stray lines are ordinary
empty paragraphs and can be deleted; no new ones will appear.

## 0.2.0

Collections, and a great many corrections found by running 0.1.0 in earnest.

**Operator action: none.** Two migrations apply on start. Upgrading from 0.1.0
keeps everything; the document schema and sync protocol are both still version
1, so an older client still works against this server.

Share links created before this upgrade keep working but cannot be copied
again — only their hash was stored. Replace one if you want that.

### Collections

A folder can gain columns and becomes a table: text, number, date, checkbox,
link, email, phone, select and multi-select, edited in place. A row is a page,
and its title opens it.

Shown as a board when a select column exists: each option a column, and dragging
a card into one sets that value. A view can filter and sort, and that work
happens in the database rather than the browser.

### Everything else

- Entries are dragged with a finger as well as a mouse, into folders or between
  them to reorder; "Move up" and "Move down" do the same without a pointer
- Tags have colours, derived from the tag's own name unless a workspace chooses
  one
- Share links open the page they were made for, can be copied again, and let a
  guest with edit rights upload images
- A collaborator's caret carries their name
- A server that cannot start says so in the browser instead of leaving a blank
  page

### In detail

**Tags have colours.** Every tag gets one derived from its own name, so the same
tag is the same colour for everybody with nothing stored anywhere. A workspace
can choose a different one.

The overrides live in a table that is **decorative on purpose**: losing it loses
chosen colours and never loses a tag, because every tag still has its derived
colour and the tags themselves live in the page documents.
[ADR-0020](docs/adr/0020-tags.md) explains why that distinction had to be
written down before the table was.

**Fixed: deleting anything from a document did not reach the projection.** A
removed column stayed in every table, because the check for "did this change
anything" compared Yjs state vectors — and a deletion does not advance one. This
affected every delete made through that path.

**Fixed: the typed columns behind sorting and filtering were never filled.** A
row finds its collection by being inside the folder, and the materialiser was
looking for it on the row's own document, where nothing writes it. Values still
read back correctly, which is why nothing looked wrong until something tried to
sort on them.

**Collections can filter and sort**, in the database rather than in the browser.
A view's rules live in its definition; unknown columns are skipped rather than
failing, because a view lives in a document other people edit.

**Fixed: every caret still said "Someone".** Updating presence merged the new
fields and left the editor's copy of the name behind, so somebody who gave their
name after connecting showed correctly in the avatars and as "Someone" beside
their own caret. The copy is now recomputed wherever presence changes.

**A share visitor is asked for their name once per tab**, not on every reload.
Remembered per link, for the browser session only — a display name is not a
credential, and should not outlive the session on a shared machine.

**Fixed: uploading through a share link failed.** Resolving the token is what
sets the share cookie, and the client only did it when the link's path carried no
page — so the newer, self-describing links never got a cookie and every upload was
refused.

**Fixed: every collaborator's caret said "Someone" in the same orange.**
y-prosemirror reads `awareness.user`, which nothing published, so it used its own
fallbacks for both the name and the colour.

**Fixed: a guest editing through a share link could not upload images.** The
upload route read only the member cookie, so the request was refused — and an
image block with no URL renders its filename as a label, which read as a picture
turning into text rather than as a refused upload. Guests with edit rights can
now upload; guests with read rights still cannot.

**Fixed: a collaborator's caret showed a number instead of their name.**
y-prosemirror's default label reads `user.name`, and SONE publishes
`displayName`, so it fell back to the internal client id.

**Fixed: images in a shared page did not load, and one of them took the whole
app down with it.** A share visitor had no HTTP credential — the token
authenticated the sync connection and nothing else — so every image returned 401.
The boot handler then treated that failed load as a failure to start and replaced
the page with "SONE failed to start". A share visitor now carries a cookie, and
the boot handler only reports failures that actually prevent a start.

**A share link can be read, not just copied.** "Show link" reveals the full URL,
wrapped so all of it is visible. The copy button had silently done nothing on
iOS: a clipboard write must happen inside the user's own activation, and awaiting
the request for the URL spends it.

**Share links can be copied again.** Every existing link has a "Copy link"
button; a link is no longer shown once and then lost. Tokens are stored
encrypted under a key derived from `SONE_SECRET_KEY`, so a database dump on its
own still contains nothing usable.

**Operator note:** changing `SONE_SECRET_KEY` leaves existing links working but
no longer copyable. Links created before this cannot be copied either — the
dialog says so and offers to replace them.

**Fixed: share links never opened.** A link was `/s/<token>` and nothing could
turn a token into a page, so a visitor arrived holding a credential with nothing
to open and sat on "Opening…" indefinitely. This affected every link ever
created, at every permission level.

New links carry the page in the path. `GET /api/share/:token` resolves the older
ones, because a share link is a public contract — one sent last month has to keep
working. A password-protected link reports only that a password is wanted; the
page and its title stay hidden until it is unlocked.

**Board views.** A collection with a select column can be shown as a board:
each option is a column, and dragging a card into one sets that value. Entries
with no value get their own column, first — hiding them would mean a board
showing fewer entries than the table with nothing to say so, and the unsorted
ones are the ones most likely to need attention.

Every view shows the same entries, because they are the folder's contents. A
board arranges them; it does not filter them.

**Select and multi-select columns**, with an option editor in the column
heading: name, colour, add, remove. They were held back because a column whose
options nobody can manage is a column nobody can fill.

Renaming an option keeps every entry that uses it — a value points at the
option's identity, not its name. Removing one hides it from those entries rather
than erasing them, and the editor says so plainly instead of implying an undo
that does not exist.

Colours are a fixed palette of names rather than colour values, so a theme
decides what each looks like. That is also the answer
[ADR-0020](docs/adr/0020-tags.md) could not find for tag colours: options are a
registry that already exists on the field. Tags have none, which is why they
still have no colours.

**Fixed: folders and pages in the sidebar stopped opening.** Pointer capture was
taken the moment a row was pressed, and with capture set the browser fires the
click on the row rather than on the link inside it. Capture is now taken when a
drag actually begins, which is the only time it is needed.

**The dragged entry is drawn under the pointer again.** The indicator lines say
where a drop lands; they do not say what is travelling. HTML5 dragging drew this
for free, and replacing it with pointer events lost it.

**Fixed: every tenth build refused to start.** Builds are versioned
`0.1.1-dev.<n>.g<sha>`, and the version fence compared the whole pre-release as
one string — so `dev.10` sorted below `dev.9` and the newer build was rejected as
a downgrade. Pre-release identifiers are now compared the way semantic versioning
defines: one at a time, numbers as numbers.

**A server that cannot start now says so in the browser.** Instead of exiting and
leaving nothing on the port, it serves a page naming both versions and the way
out, and reports 503 on `/health`. A blank page was never the right way to
deliver an accurate explanation.

**Collections work.** "Add columns" on any folder turns it into a table: text,
number, date, checkbox, link, email and phone columns, edited in place. The
first column is each entry's title and opens the page, because a row *is* a
page — a collection is a folder with columns, not a spreadsheet that happens to
live in a notes app.

Columns and values live in the documents, so they sync between people, survive a
rebuild, and travel with an entry when it is moved out of the collection.

Select, relation, formula and rollup are in the data model and deliberately not
offered yet: each needs something that does not exist — option management, a
second collection, an expression language — and a column nobody can fill is
worse than no column.

**Fixed: two drop lines appeared between two entries.** "Before this row" and
"after the one above" are the same place, and each band drew its own line — so a
single gap looked like two places to drop. The row above owns the gap below
itself now, and the gap an entry already occupies is not offered at all, since
dropping there would change nothing.

**Fixed: dragging a row started the browser's own drag instead.** A row's label
is a link, and links are draggable by default — so pressing the obvious place
produced a floating copy with a green plus, and cancelled the app's gesture
underneath it. Dragging now starts from the label, and the click that would
follow a drag is suppressed so moving a page does not also navigate to it.

**The drop indicator says what will happen.** A line between two rows for
"reorder", a filled outline for "put inside", and nothing at all on a row that
would refuse the drop — marking one that will refuse promises something that then
does not happen.

**Fixed: dropping an entry between two rows did nothing.** Reordering targets
the folder the entry is already in, and the move rules refuse that as "already
here" — so every reorder was rejected before it reached the server, silently.
The entry snapped back and a reload showed it unmoved. This affected the mouse
as well: reordering by dragging had never worked.

**A failed tree operation now says so.** The error was recorded and nothing
displayed it, which is why a refused move looked like a move that did not save.

**Dragging works with a finger.** Press and hold a row for a moment, then move
it — into a folder, or between two rows to reorder. A press that moves straight
away scrolls the sidebar as before, which is how the two gestures are told
apart.

**Entries can be reordered without a mouse.** "Move up" and "Move down" in a
row's menu. Dragging is a pointer-device feature — iOS never fires those events
— so shipping reordering as drag-only left a tablet with no way to do it at all.
These also work with a keyboard.

**Fixed: pressing and holding a sidebar row selected its text** instead of doing
nothing. Rows are draggable, and on a touch screen, where the drag never starts,
that left a text selection in the sidebar.

**Fixed: builds after the 0.1.0 tag would not start.** `git describe` on a
commit after `v0.1.0` produces `0.1.0-1-g<sha>`, which semantic versioning reads
as a *pre-release of* 0.1.0 — below the release, and below `0.1.0-rc.1-…` as
well. The version fence correctly refused it as a downgrade, and the page stayed
blank because nothing was running to explain why.

Commits after a stable tag are now versioned as the next patch
(`0.1.1-dev.<n>.g<sha>`), which sorts where it belongs. CI checks the ordering
against the exact versions that caused this.

**Operator note:** an instance stopped by this starts once with
`SONE_ALLOW_DOWNGRADE=true`, or with any build from this commit onwards.

**Entries can be reordered by dragging.** Dropping between two rows places an
entry there; dropping onto the middle of a folder puts it inside. A line means
"between", a filled row means "inside", because a drop that could mean either is
a guess.

Reordering rewrites one row, not the whole folder, so two people rearranging the
same folder do not collide over entries neither of them touched.

## 0.1.0

The first release worth another person's time.

**Operator action: change the image tag.** `docker-compose.yml` now defaults to
`:latest` rather than `:main`. If you set `SONE_IMAGE` yourself, point it at
`forgejo.thiel.tools/thiel/sone:0.1.0` for a version that will never move under
you, or `:latest` to follow stable releases.

Upgrading from `0.1.0-rc.1` applies four migrations (folders, favourites, tags,
administration) and needs nothing else. Whoever created the first workspace
becomes the instance administrator.

The document schema and the sync protocol are both still version 1, so an older
client keeps working against this server.

### What it does

Write and organise notes, together, on your own server.

- Pages in folders, moved by dragging or by a picker, with a tree that
  remembers what you collapsed
- A block editor: headings, lists, to-dos, toggles that collapse, quotes,
  callouts, code with a copy button, dividers, images, tables, and markdown
  shortcuts and paste
- Real-time editing with other people, and edits kept locally when the
  connection drops
- Full-text search across a workspace, in the workspace's language
- Tags, favourites, an outline, and a task panel
- Share links: read, comment or edit, optionally with a password and an expiry
- An administration area: accounts, workspaces, settings that take effect
  without a redeploy, and maintenance that reports what it cannot fix
- Backup and restore, including the files

### What it does not do yet

Collections and database views render a placeholder. There is no mobile layout
(ADR-0009), no end-to-end encryption (ADR-0003), no tag colours
([ADR-0020](docs/adr/0020-tags.md) explains why they need a decision first), and
no reordering by dragging.

**An administration area.** Settings now has a sub-navigation: Account,
Appearance and Workspace for everyone, and — for instance administrators —
Instance, Accounts, Workspaces, Maintenance and About.

Whoever set the instance up administers it. Administrators can promote others,
deactivate accounts, see every workspace's size, read what the maintenance
checks are reporting, and change a few settings without editing a compose file
and restarting: who may sign up, the instance name, whether members may create
workspaces.

Two things it deliberately does not do. It cannot read what is in a workspace —
that needs membership, which is a decision somebody takes rather than a button.
And it cannot delete an account: deactivating keeps the person's work and signs
them out immediately, where deleting would take every page they created with
them.

**Tags.** Add them in the properties panel. `Meeting` and `meeting` are one tag,
and the first spelling used is the one shown. Typing a tag name into search
finds the pages carrying it — no filter syntax to learn.

There is no list to create a tag in and none to tidy up: a tag exists because a
page carries it, so an unused one stops existing. Tag colours are deliberately
not implemented; see [ADR-0020](docs/adr/0020-tags.md) for why they need a
decision rather than a table.

**Favourites.** Star a page or folder from its menu; favourites sit at the top
of the sidebar and can be reordered. They are yours, not the page's — nobody
you share a page with can see that you keep a shortcut to it.

**Entries can be moved between folders.** "Move to…" in a row's menu opens a
folder picker with a filter. Destinations that would not work are listed with
the reason rather than hidden — a folder missing from a list looks like a bug or
a permissions problem.

A folder cannot be moved into itself or into anything inside it. That would
leave the whole branch existing but unreachable from the root, with the ancestor
paths that every share link is computed from recursing forever.

**Choosing a block type is now one edit, not three.** Deleting the typed
command, splitting the block and applying the type were three separate changes,
and each one is written to the document and gives the collaborative layer a
chance to restore the caret from a position measured against the previous state.
The caret could end up several blocks away, so the new heading had to be hunted
for. It is a single change now, and the new block is created as the chosen type
rather than as a paragraph that then becomes one.

**A size scale.** Three control sizes and one spacing run, written down and
used. The unfinished feel was not missing components — it was every control
picking its own height and padding, some of them by accident.

**Fixed: to-do checkboxes and toggle triangles were the wrong size and
position.** A global rule gave every `button` on the page a 44px minimum height,
including a 15px checkbox — and a minimum beats an explicit height, so the box
rendered as a tall rounded rectangle overlapping its own text. Button styling is
opt-in now, which is the right default for an element used for a dozen unrelated
things.

**Enter in a to-do or a list continues with another one.** It produced a
paragraph, because ProseMirror's split creates the parent's default type. A new
to-do also no longer arrives already ticked.

**Fixed: a hidden sidebar came back on its own.** There were two states for one
thing: a drawer flag that meant nothing at widths where the sidebar is a column,
so hiding it and then rotating a tablet brought it back. One state now, with the
layouts differing in their default rather than in what they store, and a toggle
present at every width — previously there was no way at all to reclaim the space
on a wide screen.

**Fixed: a floating menu could disappear permanently.** The slash menu, the block
gutter controls and the formatting toolbar each hid themselves while their
position was unknown, and a single failed measurement was never retried — so the
`+` inserted a slash and no menu ever appeared. They retry now, and the slash
menu shows itself in a fallback position rather than not at all.

**Empty blocks say what they are.** An empty heading looked exactly like an empty
paragraph, so choosing a block type felt as though nothing had happened and the
line that had become a heading had to be hunted for. The empty block holding the
caret now names itself — only that one.

**Fixed: heading levels and checked boxes never reached the projection.** A
block's ProseMirror attributes — a heading's level, a to-do's checked state, a
toggle's collapsed state, an image's URL — were written to the document and then
ignored when reading it back. The outline showed every heading at one size, the
task panel showed every task as open, and ticking a box in the panel changed
nothing on the page. None of it looked broken enough to investigate.

**Toggles collapse.** Click the triangle, or `Mod-.` inside one. A collapsed
toggle shows how many blocks it is hiding, and the content stays in the document
— still synced, still searchable. Collapsing is stored in the page, so it is the
same for everyone looking at it.

**To-do boxes are clickable.** They were drawn with CSS, which cannot take a
click, so the only way to tick one was a keyboard shortcut.

**A + beside every block.** Inserting no longer requires knowing that `/`
exists. The ⋮⋮ handle beside it opens the block menu — it previously rendered
and did nothing useful, which is worse than not being there.

**`/image` opens a file picker**, so an image can be inserted without having one
on the clipboard.

**The page tree has no guide lines.** They were heavy and busy on screen —
several parallel lines competing with the labels they were meant to organise.
Spacing, a muted icon and a clear indentation step do the work instead.

**A Tasks tab** in the right-hand panel: every to-do on the page with a count of
what is open, tickable from the panel, and a jump to the block. Completed tasks
stay listed below rather than disappearing.

**Tables.** `/table` inserts one, Tab moves between cells, columns can be
resized by dragging, and the block menu grows a Table section inside one — add
and delete rows and columns, toggle header row or column, merge and split cells.

Cell contents are ordinary blocks, so a list or a heading inside a cell works.
Table text is searchable, which is the point of putting anything important in
one.

Built on prosemirror-tables rather than by hand: rectangular cell selection,
merging, resizing and repairing a malformed table are each harder than they
look, and a CRDT merge can produce a table with ragged rows that has to be
repaired rather than rendered defensively.

**Images.** Paste or drop one into a page and it uploads. A placeholder appears
straight away and fills in when the upload finishes; a failure leaves the block
in place with the reason on it rather than disappearing.

Storage is content-addressed, so the same screenshot pasted into five pages is
one file on disk. Files are authorised through the page they hang on, so a file
in a page you cannot see is a file you cannot fetch.

The declared content type is ignored — the bytes decide. SVG is deliberately not
an inline type: an SVG is a document that can carry script, and serving one from
the application's own origin would be a cross-site scripting vector. PDFs are
stored and downloaded rather than rendered in place.

**Fixed: the page you just created never finished syncing.** A document opened
while the connection was still authenticating had its open request dropped, and
nothing retried it — so the newest page, which the app navigates to immediately
after creating it, sat at "Opening…" with the header stuck on "Syncing…"
indefinitely. Pending opens are now re-issued on every authentication, including
the first.

**Pasting markdown works.** Text copied from another notes app, a README, a chat
or an LLM arrived as literal characters — `## Heading` stayed a paragraph
reading "## Heading". Headings, lists, checklists, quotes, fenced code, rules,
bold, italic, strikethrough, inline code and links are converted, and
indentation becomes nesting. Only when the text is recognisably markdown:
pasting a code sample or a quotation leaves it exactly as it was.

**Fixed: a slash command after text took over the paragraph instead of adding a
block.** Typing text and then reaching for `/heading` turned the writing into a
heading, so the heading appeared to jump somewhere else. Now an empty block is
converted and a block with text gets a new block after it — which is what the
gesture means in each case.

**Links.** There was no way to make one: the mark existed and rendered, and
nothing could apply it. `Mod-K`, or a selection toolbar with bold, italic,
strikethrough, code and link. Addresses are normalised, so `example.org` becomes
`https://example.org` rather than a path on your own instance, and
`javascript:` and `data:` links are refused rather than sanitised.

**Fixed: editing a page's heading did not rename it in the sidebar.** The title
lives in the document and the sidebar reads the projection over HTTP, so the
change reached the server and the tree went on showing the old name until
something refetched. The sidebar now follows the heading as it is typed, and the
tree is refetched when the tab regains focus so other people's changes arrive
too.

**Clicking a folder opens an overview of what is inside it**, with folders and
pages listed separately, when each page was last edited, and buttons to add to
it. Expanding and collapsing stays on the disclosure triangle. Using the name
to expand wasted the gesture people reach for most and left a folder with
nothing to open.

**The tree shows where things belong.** Nesting is drawn with a guide line down
each branch rather than by indenting rows further; the branch containing the
current page is emphasised. Indentation alone reads as a flat list of rows at
different offsets, because nothing connects a child to its parent.

**The sidebar header carries the collapse button**, not "new folder" — which was
in the wrong place twice over: it is not a navigation action, and it is only
wanted while looking at the tree. It now sits at the bottom of the tree.

**Fixed: a stalled connection waited forever and said "Syncing…".** A proxy that
accepts the connection but never completes the WebSocket upgrade produced no
open, no error and no close, so the client sat in "connecting" indefinitely,
every page showed "Opening…", and nothing on screen suggested why. There is now
a ten-second handshake timeout, and the status line names the cause — "Cannot
reach the sync server", with the likely fix on hover.

**A right-hand panel with tabs.** Outline and properties, toggled from the top
bar. The outline lists the page's headings and scrolls to one when clicked; it
is derived from the document through the same tree walk the server uses, so it
cannot disagree about where a heading is. Properties shows kind, timestamps,
your access and sync state. A column on wide screens, a drawer on narrow ones,
and it remembers whether it was open and which tab you were on.

**Fixed: the server restarted in a loop and served nothing.** The folders
migration applied its changes but never recorded itself, so every start retried
it and failed on a column that already existed. The migration is now idempotent
and recovers an affected instance on the next start, with nothing to do by
hand. The migration runner records a version itself when a file omits it, so
this class of failure can no longer stop an instance booting, and a check now
rejects such a file before it can be deployed.

**Multiple workspaces.** Click the workspace name to switch between them or
create a new one. Everything in the data model already allowed several — the
session has always returned a list — but nothing could create a second, so an
instance was effectively single-workspace. A new workspace starts with a folder
and its creator as owner. No workspace limit and no tier that unlocks a second
one (ADR-0007).

**Appearance settings** under Settings → Appearance: theme, and separate text
sizes for the interface and for the editor. Two scales rather than one, because
a denser sidebar and smaller prose are different wishes. Stored per browser: a
size that suits a phone is wrong on a large monitor. Instance-wide defaults
belong in an admin area and are not built yet.

**Fixed: the app told the workspace owner they had read-only access.** The
notice was derived from "can I edit", which is false whenever the role is not
yet known — including while a document opens and while a reconnect is in
flight, since the role is cleared when a connection drops. It now says
"Opening…" for that state and claims read-only only when the role is known and
actually read-only.

**Rename and delete for folders and pages**, from an unobtrusive ⋯ menu on each
row. Renaming is inline. Deleting a folder says how many items it will take
with it, in the menu and again in the confirmation.

**Line icons throughout**, replacing the emoji folder. A small inline SVG set
rather than an icon library: shipping hundreds of icons to draw a dozen, and
adopting somebody else's drawing conventions, are both decisions worth
deferring. This is also the basis for choosing icons per entry.

**A new workspace starts with a folder**, and pages can only be created inside
folders — the workspace root holds folders only. Without a starting folder a
fresh instance showed a "new page" button that refused.

**Real folders.** A folder organises; a page holds writing. A folder can contain
folders and pages, and a page contains nothing — which is the whole point, since
a tree where anything can hold anything gives "where does this go" no answer.
Folders sort before pages, clicking a folder expands it rather than opening an
empty document, and only folders offer "new inside this".

Existing pages are unaffected: an entry with no recorded kind reads as a page.
See [ADR-0019](docs/adr/0019-folders.md), including why a folder is a document
rather than a row in a `folders` table — one authorisation path instead of two,
and a projection that can still be rebuilt from the CRDT log.

**Fixed: opening the sidebar on a wide screen destroyed the layout.** The
backdrop behind the mobile drawer was only styled inside the narrow-screen
media query, so on a desktop it was an unstyled button sitting in the page
grid — it took the first column and pushed the sidebar and content out of
place. It is now positioned and hidden regardless of width, and the drawer
button is hidden where the sidebar is always visible.

**The page tree collapses.** Disclosure triangles on pages with subpages, with
the state remembered per browser. A collapsed branch still opens itself to
reveal the page you navigate to.

**Fixed: indenting a block detached its children.** Indenting shifted only the
selected block, so blocks nested beneath it became its siblings — quietly, with
nothing throwing and nothing looking wrong. Every operation on a block now
takes its indented children with it.

**Block actions.** A ⋮⋮ button beside every block: move up and down, indent and
outdent, duplicate, delete, and turn into another type. Keyboard shortcuts too —
`Alt-Shift-Up`/`Down` to move, `Mod-D` to duplicate. When a block has nested
children the menu says how many it will affect, because acting on blocks the
person did not see selected is the surprise worth avoiding.

**Fixed: the server refused to start after switching from the release candidate
to a development build.** Development builds were versioned `0.1.0-dev.<commit>`,
which sorts *before* `0.1.0-rc.1` because pre-release identifiers compare
alphabetically — so the version fence read it as a downgrade and refused. The
container exited, nothing answered, and the symptom was a blank page with no
explanation. Development builds are now versioned from `git describe`
(`0.1.0-rc.1-7-g8ff137f`), which sorts after the tag it follows.

`SONE_ALLOW_DOWNGRADE=true` now exists to recover an instance stuck in that
state. It warns on every start and does not bypass the document-format check.

**A white page now explains itself.** If the application bundle fails to load or
throws before React starts, the page says so, names the error, offers a reload,
and states plainly that pages are stored on the server and unaffected. React's
error boundary cannot help in those cases because it never mounts.

**The running version is visible in the app.** Settings → About shows the
server's version and the version of the client bundle in your browser
separately, and says so when they disagree — a browser holding a cached bundle
from an earlier deployment otherwise reports the server's version about code
that is not running. The version also appears at the bottom of the sidebar.

**Fixed: every page rendered blank.** Opening any page threw during editor
construction, React unmounted the tree, and the result was a white screen with
nothing to report. Reported from the first real deployment; nothing in 361
automated tests had touched the path.

**Added: crashes now show something.** An error boundary around the app and
another around the editor, so a future failure leaves the sidebar and
navigation working and shows the error where the person who hit it can copy it.

**A slash menu.** Type `/` at the start of a block or after a space to insert
any block type, filtered as you type — `/h1`, `/todo`, `/ul`, `/hr` all land
where you would expect. Arrow keys, Enter, Tab and Escape do what they should,
and a slash inside a word or inside code does not interrupt you.

**Container images are published automatically.** Built with buildah rather
than Docker, so the CI runner needs no daemon socket — which also means no
workflow gets root-equivalent access to the host's daemon. Images land at
`forgejo.thiel.tools/thiel/sone`.

Known issue: the image carries about 26 MB of build tooling it does not need,
because neither `pnpm prune --prod` nor `pnpm install --prod` removes the
devDependencies of workspace packages. Not a correctness problem; the fix
changes the runtime layout and is scheduled before 1.0.

## 0.1.0-rc.1

**No operator action required.** First tagged release, so there is nothing to
upgrade from.

A pre-release, deliberately. The bar for 0.1.0 in
[ADR-0013](docs/adr/0013-versioning-and-releases.md) includes two things nobody
has actually confirmed yet: that a fresh `docker compose up` reaches a working
instance on someone else's machine, and that two browsers editing the same page
behave. Both are covered by automated tests as far as they can be without a
browser, and neither has been seen by a person. Calling this 0.1.0 would claim
otherwise.

What the tag is for: deploying a fixed, reproducible commit instead of a moving
branch. A Portainer repository stack pointed at `refs/tags/v0.1.0-rc.1` with
compose path `docker-compose.build.yml` builds exactly this code, with no
container image and no CI runner needed.

**The server runs.** `docker compose up -d` starts an instance that applies its
migrations, serves `/api/health`, `/api/ready` and `/api/version`, accepts
WebSocket sync connections, and shuts down cleanly on SIGTERM without losing
unflushed edits.

Working so far:

- Documents as Yjs CRDTs with a rebuildable Postgres projection
- Real-time collaborative editing over a multiplexed WebSocket, with presence
- Accounts, sessions, invitations (single-use and multi-use links)
- Share links with view/comment/edit rights, subtree scope, optional password,
  and anonymous editing
- Revocation that takes effect on live connections, not just on reconnect
- Full-text search, indexed under both the workspace's language and a
  language-neutral configuration
- A maintenance job that prunes expired sessions, compacts document histories
  and revalidates open connections
- Backup and restore, verified end to end: dump, destroy the database, restore,
  and the documents still open
- Automatic upgrades — document formats migrate lazily when a page is opened,
  and the server refuses a downgrade instead of corrupting data

The document format was corrected before any data existed: the block tree now
lives in one ProseMirror fragment per page rather than one per block, which is
what makes multi-block selection possible at all
([ADR-0015](docs/adr/0015-one-fragment-per-page.md)).

The client library is in: sync connection with jittered reconnect, a
refcounted document store that survives disconnection, presence, and offline
edits that reconcile on reconnect without an explicit queue. Proven by an
end-to-end suite running a real client against a real server against a real
Postgres.

A web client exists. Setup, sign-in, invitations, a page tree, live-synced page
titles, presence, search and share links all work in the browser. Two windows
on the same page see each other's changes and each other's cursors.

**Pages are editable.** Paragraphs, headings, bullet and numbered lists, todos,
quotes, callouts, code blocks and dividers, with markdown shortcuts (`# `, `- `,
`1. `, `[] `, `> `, ``` ), bold and italic, Tab and Shift-Tab to indent, and
remote cursors showing where other people are typing.

Not working yet: a slash menu, drag handles, images, and database views — the
last of these renders a placeholder rather than pretending to work. Everything above is reachable only
over the API and the sync protocol.

**Upgrades.** The intended experience for every release, major or not, is
`docker compose pull && docker compose up -d`. Database migrations and document
format migrations both run automatically; see
[ADR-0014](docs/adr/0014-automatic-upgrades.md) for what remains manual and why
it should be rare.

**Pre-1.0 warning.** Until 1.0, the persisted document format may change in a
minor release and a document migration may be required. Do not put anything you
care about into a pre-1.0 instance without a backup you have tested restoring.
