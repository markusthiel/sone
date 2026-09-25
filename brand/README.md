# SONE — Markendateien

Alle Dateien in diesem Paket stammen aus **einer** Geometrie- und **einer**
Farbdefinition: dem Signet aus `packages/web/src/components/Logo.tsx` und den
Tokens aus `packages/web/src/styles.css`. Nichts hier ist nachgezeichnet, und
nichts hier weicht vom Code ab. Wenn sich das Signet im Code ändert, wird dieses
Paket neu erzeugt, nicht nachgepflegt.

Die Wortmarke ist Archivo (Gewicht 600, Laufweite +7,5 %), **in Pfade
umgewandelt**. Keine gelieferte Datei braucht eine installierte Schrift.

---

## Was wo liegt

```
logo/svg/      Master. Skalieren verlustfrei, überall zuerst greifen.
logo/png/      Raster, 400–2400 px, transparent.
icons/         Favicon, App- und PWA-Icons, manifest.
social/        OG-Karten, Repo-Banner, Header, Avatar.
print/         PDF und SVG für Druck und Fremdlayouts.
office/        Briefbogen (docx), Folien (pptx), E-Mail-Signatur (html).
fonts/         Archivo und JetBrains Mono — Web (woff2) und Desktop (ttf), OFL.
guideline/     Konstruktionsblatt: Schutzraum, Mindestgrößen, Farben.
```

## Vier Farbfassungen, nach Untergrund benannt

| Endung   | Wofür                                   | Balken    | Akzent    |
| -------- | --------------------------------------- | --------- | --------- |
| `-light` | heller Untergrund (Papier, `#faf8f4`)   | `#161615` | `#2f7d6f` |
| `-dark`  | dunkler Untergrund (`#161615`, `#0e0e0d`) | `#f7f5f0` | `#6fc0b0` |
| `-black` | einfarbig: Fax, Stempel, Gravur, Prägung | `#161615` | `#161615` |
| `-white` | einfarbig auf Foto oder Volltonfläche    | `#f7f5f0` | `#f7f5f0` |

Der Akzent **wechselt mit dem Untergrund**, weil `#2f7d6f` auf Schwarz zu
dunkel und `#6fc0b0` auf Papier zu hell steht. Das ist dieselbe Regel wie im
Code, wo das Signet `var(--accent)` tintet und im Dunkelmodus `--accent-300`
bekommt.

`sone-signet-adaptive.svg` ist die Ausnahme: es benutzt `currentColor` und
`var(--accent)` und gehört nur in die Anwendung, nicht in fremde Dokumente.

## Vier Balken

Das Signet hat **vier** Balken, in jeder Größe und in jeder Datei. Es gab eine
dreibalkige Notfassung für kleine Flächen — sie steckte im Favicon und in den
Icons bis 64 px, und sie ist ersatzlos weg.

Drei gestapelte Linien sind ein Burger-Menü. Der vierte Balken, der wieder
heraustritt, ist der Grund, dass die Marke ein Baum ist und kein Menü. Genau
deshalb war die Ausnahme dort am teuersten, wo sie galt: im Tab, im Dock und auf
dem Startbildschirm sieht man nur das kleine Bild, und das war dann nicht die
Marke.

## Schutzraum und Mindestgrößen

Siehe `guideline/sone-konstruktion.pdf`.

- **Schutzraum**: mindestens ¼ der Signethöhe auf allen vier Seiten. Nichts
  hinein — kein Text, keine Kante, kein zweites Logo.
- **Signet**: ab 24 px bzw. 8 mm Höhe. Darunter wird es nicht ersetzt, sondern
  weggelassen — ein Icon-Kachel mit hellem Grund trägt es bis 16 px.
- **Lockup**: ab 96 px bzw. 30 mm Breite.

## Nicht

- Balken neu anordnen, einfärben, verrunden oder mit Verlauf füllen.
- Mehr als einen Balken in der Akzentfarbe. Es ist immer der dritte.
- Das Signet drehen, spiegeln oder verzerren. Nur proportional skalieren.
- Wortmarke aus einer anderen Schrift setzen oder die Laufweite ändern —
  dafür sind die Pfaddateien da.
- Das `-light`-Logo auf dunklem Grund benutzen (und umgekehrt). Für alles
  dazwischen — Foto, Muster, unklarer Kontrast — die einfarbige Fassung.
- Den Claim ohne Logo setzen oder das Logo in einen Satz einbauen. Im Text
  heißt es SONE.

---

## Web

`icons/` enthält den vollständigen Satz. In `packages/web/public/` liegen
`favicon.svg`, `favicon.ico`, `apple-touch-icon.png`, `icon-192.png`,
`icon-512.png`, `icon-maskable-192.png`, `icon-maskable-512.png` und
`manifest.webmanifest`.

Die maskierbaren Icons haben 26 % Rand, damit ein runder oder abgerundeter
Zuschnitt auf Android keinen Balken abschneidet. Ohne sie beschneidet Android
das normale Icon selbst — und trifft dabei den obersten Balken.

`social/png/sone-og-image-light.png` ist die OG-Karte (1200 × 630). Sie liegt
im Repo als `packages/web/public/og-image.png`.

## Druck

`print/pdf/` sind Vektor-PDFs, 60 mm breit angelegt und beliebig skalierbar.
Die Werte sind sRGB. Für Vierfarbdruck sollte die Druckerei aus dem SVG heraus
konvertieren; als Näherung:

| Farbe     | sRGB      | CMYK (Näherung)    |
| --------- | --------- | ------------------ |
| Ink 900   | `#161615` | 0 / 0 / 5 / 95     |
| Accent 500| `#2f7d6f` | 78 / 24 / 52 / 12  |
| Ink 050   | `#f7f5f0` | 0 / 1 / 3 / 2      |

Für Sonderfarbe: Accent 500 liegt nahe an **Pantone 3295 U**; das gehört vor
dem Druck angesehen, nicht aus einer Tabelle übernommen.

Auf ungestrichenem Papier läuft die Akzentfarbe zu. Unter 15 mm Signethöhe im
Druck: einfarbig setzen.

## Office

- `office/sone-briefbogen.docx` — A4, Logo im Kopf, Absenderzeile im Fuß.
  Platzhalter stehen in «Guillemets»; Suchen-und-Ersetzen füllt sie.
- `office/sone-folien.pptx` — vier Folien: Titel, Abschnitt, Inhalt, Schluss.
  Die Akzentfarbe kommt pro Folie **einmal** vor.
- `office/sone-email-signatur.html` — Logo als data-URI, also ohne externen
  Abruf. Die Kommentare in der Datei nennen die Variante mit gehostetem Logo.

Beide Office-Dateien verlangen Archivo und JetBrains Mono. Ohne sie ersetzt
Word/PowerPoint die Schrift und das Layout verschiebt sich leicht. Die
installierbaren TTF liegen in `fonts/desktop/` — beide unter der SIL Open Font
License, Lizenztexte in `fonts/`.

## Schrift

| Rolle                                     | Schrift        | Gewicht |
| ----------------------------------------- | -------------- | ------- |
| Wortmarke                                 | Archivo        | 600     |
| Überschrift                               | Archivo        | 300     |
| Lauftext                                  | Archivo        | 400     |
| Label, Zahl, Pfad, Code, Kleinversalien   | JetBrains Mono | 400/500 |

Kleinversalien in Mono laufen mit +12 % Laufweite. Die Anwendung macht das in
`.sidebar-label` und `.settings-heading` genauso.

## Ton

Beschreibend statt bewerbend. Substantive vor Adjektiven. Sagt auch, was SONE
nicht kann. Claim: **Wissen strukturieren. Auf deinem Server.**

## Diese Kopie ist gekürzt

Im Repo liegen die Master und je zwei Rastergrößen pro Fassung — genug für
Web, Repo und Office. Die vollständige Fassung (Raster bis 2400 px, Webfonts,
alle Signetgrößen) erzeugt `tools/brand/all.py` in einem Schritt; sie gehört
nicht in die Versionsverwaltung, weil sie aus dem hier Liegenden folgt.

## Neu erzeugen

Die Skripte liegen unter `tools/brand/`. `python3 tools/brand/all.py` schreibt
das Paket vollständig neu.
