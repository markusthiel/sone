# ADR-0204: Editor-Menüs im sichtbaren Bereich und sichere Linkziele

## Status

Accepted. Built.

## Context

Die [Editorprüfung](../reviews/editor-2026-11-04.md) reproduzierte abgeschnittene
Blockmenüs, eine außerhalb des Bildschirms liegende Formatierungsleiste und
nicht erreichbare Blockaktionen bei langen Absätzen. Scroll-Listener waren
bereits vorhanden; es fehlte die Begrenzung auf den sichtbaren Bereich.

Der Linkfilter prüfte Schemata mit einer Regex. Bei `java\tscript:` fand sie
kein Schema und erlaubte den Link, während der Browser `javascript:` erkannte.
Einfügen und Synchronisieren waren nachweisbar, Skriptausführung über die
normale Bedienung nicht.

## Decision

`editorOverlayBounds` bestimmt den sichtbaren Bereich aus VisualViewport,
Editor-Spalte und überdeckender Navigation. `placeEditorOverlay` platziert
Block-, Slash- und Formatierungsmenüs darin, wechselt bei Bedarf die Seite und
begrenzt Größe und Position. Eigene Größenänderungen der Popups werden ebenfalls
beobachtet. Ein teilweise sichtbarer Block behält erreichbare Aktionen; ein
vollständig außerhalb liegender Block bekommt keine schwebenden Aktionen.

Auf Touchgeräten stehen die beiden 44-Pixel-Blockaktionen untereinander in der
vorhandenen Randspalte. Unsichtbare, überlappende Trefferflächen entfallen.

`isFollowable` prüft das Protokoll nach Verarbeitung durch den URL-Parser.
Die bestehenden Verbote für `javascript:`, `data:` und `vbscript:` bleiben
erhalten; relative und gewöhnliche externe Links bleiben erlaubt. Ungültige
URLs werden abgewiesen. Der Schema-Serializer gibt bestehende unsichere
Link-Markierungen als Text aus, weil das Laden aus Yjs den HTML-Parser umgeht.
Der Click-Handler unterbindet für abgewiesene Links auch die native Navigation.

## Validation

337 Editor-Tests und 1.212 Webtests bestanden, einschließlich neuer Fälle für
HTML-Zeichenreferenzen, bereits gespeicherte gefährliche Links und die gemessenen
Menüpositionen. Layoutregressionen laufen mit tatsächlichem Editor und CSS in
Chromium sowie WebKit in iPhone- und iPad-Größen. Die Browserfixture benötigt
weder Serverkonto noch Datenbank und verändert keine Notizen.

Die Browserprüfungen ergänzen die bisherigen jsdom- und Quelltexttests. Beim
Ausführen unter Windows wurden außerdem Tests auf LF/CRLF und beide
Pfadtrenner vorbereitet; ihre inhaltlichen Zusicherungen bleiben erhalten.

Physische iOS-Geräte, native Auswahlgriffe und die echte Bildschirmtastatur
bleiben Bestandteil der manuellen Abnahme. Die bestehende Autorenfarben-
Korrektur aus ADR-0203 gehört bereits zum Ausgangsstand dieses Changesets.
