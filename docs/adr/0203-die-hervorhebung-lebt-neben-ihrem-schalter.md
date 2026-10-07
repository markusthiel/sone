# ADR-0203: Die Hervorhebung lebt neben ihrem Schalter

## Status

Accepted. Built. Ergänzt ADR-0091, das die Autoren-Hervorhebung überhaupt erst
zum Zeichnen gebracht hat, und ADR-0116, das festlegt, wen die Leute-Leiste
listet.

## Context

> Ich habe einen Text verfasst, geteilt per Link und den Link wieder gelöscht.
> Auf einem Gerät ist er jetzt komplett farbig hinterlegt, obwohl nur ich selbst
> daran gearbeitet habe. ich kann es auch nicht abschalten.

Der Freigabelink war unbeteiligt. Eingefärbt war `.sone-authored` — die
Hervorhebung aus der Leute-Leiste, die das Geschriebene einer Person markiert.
Ein Dokument, das von einer Person stammt, wird dabei vollständig eingefärbt;
das ist richtig und sah nur deshalb nach einem Fehler aus, weil niemand es
bestellt zu haben schien und niemand es abbestellen konnte.

Zwei Hälften, beide dieselbe Ursache: **die Auswahl lag an einem anderen Ort als
die Dekorationen, die sie bewirkt.**

Die Auswahl lag in `Contributors`, in einem `useState`. Die Leiste hat neun
Reiter, und React hängt die acht nicht sichtbaren aus — ein Wechsel auf die
Gliederung warf die Auswahl weg. Die Dekorationen liegen im Editor und blieben.
Die Leiste ist außerdem beim Schließen nicht weg, sondern `inert`: der einzige
Schalter, der die Markierung wieder ausmacht, stand also hinter einer
geschlossenen Schublade, während die Seite durchgehend farbig war.

Und der Versuch, es doch abzustellen, bestätigte den Eindruck: nach der Rückkehr
in den Reiter stand die Leiste wieder auf „niemand gewählt". Der erste Klick
wählte damit **dieselbe** Person erneut aus — sichtbar änderte sich nichts. Erst
ein zweiter Klick schaltete ab. Ein Schalter, der beim ersten Drücken nichts tut,
ist für den Bedienenden ein kaputter Schalter, und genau so wurde er gemeldet.

Nachgestellt in der laufenden Instanz: Person wählen → 76 markierte Stellen; auf
einen anderen Reiter wechseln → weiterhin 76, Leiste meldet `aria-pressed=false`.

## Decision

**Die gewählte Person liegt dort, wo auch der Befehl liegt, der sie markiert** —
in `authorHighlightBridge`, neben dem registrierten Highlighter. Die Leiste
*liest* sie über `useSyncExternalStore`, statt eine zweite Kopie zu halten. Damit
überlebt die Auswahl den Reiterwechsel, die Leiste zeigt nach der Rückkehr
wahrheitsgemäß an, dass markiert ist, und ein Klick genügt zum Abschalten.

**Gelöscht wird, wo der Schalter den Bildschirm verlässt**, und nur dort:

- Die Leiste schließt → `clearChosenAuthor()` in `RightSidebar`. Eine
  geschlossene Leiste markiert niemanden; die Hervorhebung ist eine Art, die
  Seite durch diese Leiste anzusehen, und endet mit ihr.
- Der Editor geht → `registerHighlighter()` setzt die Auswahl zurück, beim
  Abbau wie beim Aufbau. Eine neue Seite zeichnet nichts, bis sie gefragt wird;
  eine mitgereiste Auswahl wäre eine Behauptung über eine unmarkierte Seite.

**Nicht gelöscht wird im Effekt von `Contributors`.** Das war der erste Versuch
und ist falsch: der Effekt hängt am Handle, und das Handle-Objekt wird bei jeder
Benachrichtigung neu gebaut — die Hervorhebung hätte sich beim Lesen *einer*
Seite zu unvorhersehbaren Zeitpunkten selbst abgeschaltet. Der Test hat das
sofort gezeigt.

`onHighlight` als Prop entfällt damit; die Leiste ruft `chooseAuthor` direkt.
Das bleibt im Sinne des ursprünglichen Entwurfs: die Leiste greift weiterhin
nicht in den Editor, sie kennt weiterhin genau einen Befehl — dieser Befehl
merkt sich jetzt nur, dass er erteilt wurde.

## Consequences

Die Hervorhebung ist nicht mehr abschaltbar-nur-mit-Neuladen. Wer sie mit
geschlossener Leiste anlassen will, kann das nicht mehr — das ist Absicht: ein
Zustand ohne sichtbaren Schalter ist genau der Fehler, der gemeldet wurde.

Die Tests der Leute-Leiste beobachten jetzt die echte Brücke statt eines
eingehängten Callbacks. Eine Zusicherung, dass eine Leitung existiert, hat hier
schon einmal am härtesten bestanden, als die Leitung ins Falsche führte
(ADR-0116); der mitlaufende Zustand gehört mitgeprüft.

Bereits laufende Browser mit festsitzender Hervorhebung brauchen ein Neuladen —
danach ist der Zustand ohnehin leer.
