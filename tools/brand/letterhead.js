const fs = require('fs');
const {
  Document, Packer, Paragraph, TextRun, ImageRun, AlignmentType, HeadingLevel,
  Header, Footer, TabStopType, BorderStyle, convertMillimetersToTwip,
} = require('docx');

const path = require('path');
const ROOT = path.resolve(__dirname, '..', '..');
const OUT = process.env.SONE_BRAND_OUT || path.join(ROOT, 'brand');
const logo = fs.readFileSync(`${OUT}/logo/png/sone-logo-horizontal-light-800.png`);

const INK = '161615';
const MUTED = '6A675F';
const ACCENT = '2F7D6F';
const RULE = 'DDD9D0';

const SANS = 'Archivo';
const MONO = 'JetBrains Mono';

const small = (text, opts = {}) => new TextRun({
  text, font: MONO, size: 15, color: MUTED, characterSpacing: 12, ...opts,
});

const body = (text, opts = {}) => new Paragraph({
  spacing: { after: 160, line: 276 },
  children: [new TextRun({ text, font: SANS, size: 21, color: INK, ...opts })],
});

const doc = new Document({
  creator: 'SONE',
  title: 'SONE — Briefbogen',
  description: 'Briefbogen-Vorlage im SONE Markensystem',
  styles: {
    default: {
      document: { run: { font: SANS, size: 21, color: INK } },
    },
  },
  sections: [{
    properties: {
      page: {
        margin: {
          top: convertMillimetersToTwip(38),
          right: convertMillimetersToTwip(22),
          bottom: convertMillimetersToTwip(24),
          left: convertMillimetersToTwip(25),
          header: convertMillimetersToTwip(14),
          footer: convertMillimetersToTwip(12),
        },
      },
    },
    headers: {
      default: new Header({
        children: [
          new Paragraph({
            children: [new ImageRun({
              type: 'png', data: logo,
              transformation: { width: 162, height: 37 },
            })],
          }),
        ],
      }),
    },
    footers: {
      default: new Footer({
        children: [
          new Paragraph({
            border: { top: { style: BorderStyle.SINGLE, size: 4, color: RULE, space: 6 } },
            tabStops: [
              { type: TabStopType.CENTER, position: convertMillimetersToTwip(81) },
              { type: TabStopType.RIGHT, position: convertMillimetersToTwip(163) },
            ],
            children: [
              small('«Absender»'),
              small('\t«Kontakt»'),
              small('\t«Server»'),
            ],
          }),
        ],
      }),
    },
    children: [
      new Paragraph({
        spacing: { after: 40 },
        children: [small('EMPFÄNGER')],
      }),
      body('«Name»'),
      new Paragraph({ spacing: { after: 0 }, children: [new TextRun({ text: '«Straße und Hausnummer»', font: SANS, size: 21 })] }),
      new Paragraph({ spacing: { after: 520 }, children: [new TextRun({ text: '«PLZ und Ort»', font: SANS, size: 21 })] }),

      new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { after: 360 },
        children: [small('«Ort», «Datum»')],
      }),

      new Paragraph({
        spacing: { after: 260 },
        children: [new TextRun({ text: '«Betreff»', font: SANS, size: 26, bold: true, color: INK })],
      }),

      body('«Anrede»,'),
      body('«Text». Dieser Absatz zeigt den Lauftext: Archivo, 10,5 pt, Zeilenabstand 1,15. '
        + 'Der Briefbogen trägt oben das Logo, unten die Absenderzeile in JetBrains Mono — '
        + 'die gleiche Rollenverteilung wie in der Anwendung: Text in Archivo, alles '
        + 'Technische und alle Kleinlabels in Mono.'),
      body('«Weiterer Text».'),

      new Paragraph({
        spacing: { before: 320, after: 60 },
        children: [new TextRun({ text: '«Grußformel»', font: SANS, size: 21, color: INK })],
      }),
      new Paragraph({ spacing: { after: 40 }, children: [new TextRun({ text: '' })] }),
      new Paragraph({
        children: [new TextRun({ text: '«Name»', font: SANS, size: 21, color: INK })],
      }),
      new Paragraph({
        children: [small('«Funktion»')],
      }),
    ],
  }],
});

Packer.toBuffer(doc).then((b) => {
  fs.mkdirSync(`${OUT}/office`, { recursive: true });
  fs.writeFileSync(`${OUT}/office/sone-briefbogen.docx`, b);
  console.log('written');
});
