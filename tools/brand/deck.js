const fs = require('fs');
const pptxgen = require('pptxgenjs');

const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = process.env.SONE_BRAND_OUT || path.join(ROOT, 'brand');
const b64 = (p) => 'image/png;base64,' + fs.readFileSync(p).toString('base64');
const LOGO_DARK = b64(`${OUT}/logo/png/sone-logo-horizontal-dark-1600.png`);
const LOGO_LIGHT = b64(`${OUT}/logo/png/sone-logo-horizontal-light-1600.png`);
const SIGNET_DARK = b64(`${OUT}/logo/png/sone-signet-dark-512.png`);

const INK = '161615';
const INK_DEEP = '0E0E0D';
const PAPER = 'F7F5F0';
const PAGE = 'FAF8F4';
const ACC_D = '6FC0B0';
const ACC_L = '2F7D6F';
const MUTED_D = 'A9A79F';
const MUTED_L = '6A675F';
const RULE_D = '302F2C';
const RULE_L = 'DDD9D0';

const SANS = 'Archivo';
const MONO = 'JetBrains Mono';

const pres = new pptxgen();
pres.layout = 'LAYOUT_16x9'; // 10 x 5.625 in
pres.author = 'SONE';
pres.title = 'SONE — Foliensatz';

const M = 0.62; // margin

function kicker(s, text, dark) {
  s.addShape(pres.ShapeType.line, {
    x: M, y: 0.5, w: 10 - 2 * M, h: 0,
    line: { color: dark ? RULE_D : RULE_L, width: 0.75 },
  });
  s.addText(text, {
    x: M, y: 0.58, w: 6, h: 0.26, isTextBox: true, margin: 0,
    fontFace: MONO, fontSize: 9, charSpacing: 2.2,
    color: dark ? MUTED_D : MUTED_L, valign: 'top',
  });
}

// ---------------------------------------------------------------- title
{
  const s = pres.addSlide();
  s.background = { color: INK };
  kicker(s, 'NOTIZEN · SEITEN · SAMMLUNGEN', true);
  s.addImage({ data: LOGO_DARK, x: M, y: 1.62, w: 3.9, h: 0.902 });
  s.addText('«Titel der Präsentation»', {
    x: M, y: 2.95, w: 8.4, h: 0.9, isTextBox: true, margin: 0,
    fontFace: SANS, fontSize: 32, color: PAPER, bold: false, valign: 'top',
  });
  s.addText('Wissen strukturieren. Auf deinem Server.', {
    x: M, y: 4.55, w: 6, h: 0.32, isTextBox: true, margin: 0,
    fontFace: SANS, fontSize: 14, color: MUTED_D,
  });
  s.addText('«Anlass», «Datum»', {
    x: 6.4, y: 4.58, w: 3, h: 0.28, isTextBox: true, margin: 0, align: 'right',
    fontFace: MONO, fontSize: 9.5, color: MUTED_D, charSpacing: 1.4,
  });
  s.addNotes('Titelfolie. Kicker, Logo, Titel, Claim — nichts sonst.');
}

// ---------------------------------------------------------------- section
{
  const s = pres.addSlide();
  s.background = { color: INK_DEEP };
  kicker(s, 'ABSCHNITT «N»', true);
  s.addText('«Abschnittstitel»', {
    x: M, y: 2.2, w: 8.6, h: 1.1, isTextBox: true, margin: 0,
    fontFace: SANS, fontSize: 40, color: PAPER, valign: 'middle',
  });
  s.addText('«Ein Satz, der sagt, worum es in diesem Abschnitt geht.»', {
    x: M, y: 3.4, w: 6.6, h: 0.5, isTextBox: true, margin: 0,
    fontFace: SANS, fontSize: 14, color: MUTED_D,
  });
  s.addImage({ data: SIGNET_DARK, x: 8.62, y: 4.42, w: 0.76, h: 0.72 });
  s.addNotes('Abschnittstrenner. Das Signet unten rechts als stille Signatur.');
}

// ---------------------------------------------------------------- content
{
  const s = pres.addSlide();
  s.background = { color: PAGE };
  kicker(s, '«ABSCHNITT» · «THEMA»', false);
  s.addText('«Folientitel»', {
    x: M, y: 1.05, w: 8.6, h: 0.6, isTextBox: true, margin: 0,
    fontFace: SANS, fontSize: 26, color: INK,
  });
  s.addText(
    [
      { text: '«Erster Punkt in einem vollständigen Satz.»', options: { bullet: true, breakLine: true } },
      { text: '«Zweiter Punkt, gleiche Länge, gleicher Ton.»', options: { bullet: true, breakLine: true } },
      { text: '«Dritter Punkt. Beschreibend statt bewerbend.»', options: { bullet: true } },
    ],
    {
      x: M, y: 1.95, w: 4.6, h: 2.4, isTextBox: true, margin: 0,
      fontFace: SANS, fontSize: 14, color: INK, paraSpaceAfter: 10, lineSpacingMultiple: 1.2,
    },
  );
  // a quiet card, tint rather than a stripe
  s.addShape(pres.ShapeType.rect, {
    x: 5.62, y: 1.95, w: 3.76, h: 2.4,
    fill: { color: 'F0EEE8' }, line: { color: RULE_L, width: 0.75 },
  });
  s.addText('«ZAHL»', {
    x: 5.92, y: 2.25, w: 3.16, h: 0.9, isTextBox: true, margin: 0,
    fontFace: SANS, fontSize: 48, color: ACC_L, valign: 'middle',
  });
  s.addText('«Was die Zahl bedeutet, in einer Zeile.»', {
    x: 5.92, y: 3.28, w: 3.16, h: 0.8, isTextBox: true, margin: 0,
    fontFace: SANS, fontSize: 12.5, color: MUTED_L,
  });
  s.addText('«Quelle»', {
    x: M, y: 4.85, w: 4, h: 0.26, isTextBox: true, margin: 0,
    fontFace: MONO, fontSize: 8.5, color: MUTED_L, charSpacing: 1.2,
  });
  s.addImage({ data: LOGO_LIGHT, x: 8.5, y: 4.83, w: 0.88, h: 0.204 });
  s.addNotes('Inhaltsfolie: Text links, eine Zahl rechts. Akzentfarbe genau einmal.');
}

// ---------------------------------------------------------------- closing
{
  const s = pres.addSlide();
  s.background = { color: INK };
  kicker(s, 'DANKE', true);
  s.addImage({ data: LOGO_DARK, x: M, y: 2.1, w: 3.4, h: 0.786 });
  s.addText('«Kontakt» · «Server»', {
    x: M, y: 3.25, w: 6, h: 0.3, isTextBox: true, margin: 0,
    fontFace: MONO, fontSize: 11, color: MUTED_D, charSpacing: 1.4,
  });
  s.addNotes('Schlussfolie.');
}

pres.writeFile({ fileName: `${OUT}/office/sone-folien.pptx` }).then(() => console.log('written'));
