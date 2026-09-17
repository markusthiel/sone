# Importing and exporting

Everything SONE holds can be taken out and put back in an open format. This page
says exactly what that means, what it does not cover, and what an archive has to
look like.

The reasoning behind these choices is in
[ADR-0044](adr/0044-import-export.md).

---

## Exporting

There are two exports, and they are different sizes of the same thing.

### One page and everything under it

Open the **⋮** menu on any entry in the sidebar — a folder or a page — and choose
**Export…**. You get one `.zip` straight away.

- Every page under the one you picked comes too. Exporting a folder exports its
  whole subtree.
- **Include the files and pictures** is a choice in the window. Without them the
  archive is small enough to email, and the links inside it point at files that
  are not there.
- Only pages you are allowed to read are included. If a folder contains a page
  restricted to somebody else, it is not in your archive — a file on a laptop
  outlives every permission change.
- Up to 200 pages. More than that, use the workspace export below.

### A whole workspace

**Your face → This workspace → Export this workspace**.

This one is packed in the background, because it reads every page: you can close
the window and come back. The list on that screen shows what is being prepared,
what is ready, and how long each archive stays available (a day by default).

An archive holds what **you** can read at the moment it is packed. If your access
changes between asking and packing, it holds less — never more.

### What is in the archive

```
Buchhaltung/
  index.md              ← the folder itself: its name and any text on it
  Übersicht.md          ← a page inside it
  2025/
    index.md
    DATEV Abgleich.md
attachments/
  4f2a…                 ← the files, named by id
```

- One `.md` file per page, named after the page's title. Umlauts and spaces are
  kept: an export is for reading, so `Übersicht 2026.md` beats
  `ubersicht-2026.md`.
- A **folder** becomes a directory with an `index.md` in it, because a folder has
  a name and an icon of its own that would otherwise be lost.
- An entry's **symbol and colours** — the icon, its colour, the title's colour —
  are written as an HTML comment right under the title, `<!-- sone-entry … -->`.
  Other readers do not show it; SONE reads it back on import. An entry with the
  default look has no such line. A divider's line and symbol travel the same way,
  as `<!-- sone-divider … -->` under its `---`.
- Pictures and files land in `attachments/`, named by id, and the Markdown links
  to them. Two pictures both called `screenshot.png` would be one file in a flat
  directory; the id avoids that.
- Anything Markdown has no spelling for — a collection, a table, a canvas, an
  embedded video — is written as a fenced block carrying its own data:

  ````
  ```sone-collectionView
  {"viewType":"table","columns":["Name","Status"]}
  ```
  ````

  Another tool shows that as a code block. SONE reads it back as the collection
  it was.

### What an export does not carry

| Not included | Why |
| --- | --- |
| Comments | They are *about* a page rather than part of it, and Markdown has nowhere to put them. |
| Page history | An archive is one moment. The versions are in SONE. |
| Who wrote what | Attribution is per character in the document; a Markdown file has no place for it. |
| Permissions | Who may read a page is a fact about SONE, not about the text. |
| A canvas's drawing | A canvas arrives as an empty page. Its pictures are in `attachments/`, the arrangement is not. |
| Cover, width, template flag, lock | Not yet. The icon and colours are; these would go in the same line. |
| Bold and italic **inside** a re-import | They export correctly. See the note under importing. |

---

## Importing

Open the **⋮** menu on the folder **or the page** you want the contents to land
under, and choose **Import…**. Yes — importing into a page works, and the
imported pages become children of it. Importing into a folder is the usual case.

Choosing the file does not import anything. SONE reads the archive and shows you
**what would happen**: the pages and folders it would create, which names are
already taken, and what will not come. Nothing is written until you press
**Import**.

### What an archive has to look like

**A `.zip` file.** That is the only format for now — not a `.tar.gz`, not a
folder, not a single loose `.md` file. If you have one Markdown file, put it in a
zip.

Inside it, the structure is the structure:

```
Notizen/
  index.md         → a folder called "Notizen"
  Montag.md        → a page inside it
  Projekte/
    Plan.md        → a page inside a folder called "Projekte"
attachments/
  logo.png         → referenced from a page as ![Logo](attachments/logo.png)
```

- **Directories become folders.** A directory with no `index.md` still becomes a
  folder, named after the directory.
- **`index.md` describes the directory it sits in**, not a page inside it.
- **A page's title** comes from its first `# Heading`. If a file has none, the
  file name is used. So `2026-09-02.md` starting with `# Kick-off` arrives as
  "Kick-off", and the date keeps doing its job in the file name.
- **`attachments/`** is where files go. A link like
  `![Plan](attachments/plan.png)` is rewritten to the copy SONE stores.
- Up to 12 directory levels deep and 5000 files. Anything deeper is listed as
  skipped rather than silently flattened.

An archive from Obsidian, from a folder of notes, or from SONE's own export all
work — they agree about headings, lists, quotes, code fences and rules, which is
what the reader understands.

### What is read, and what becomes a paragraph

| In the file | Becomes |
| --- | --- |
| `# Title` (first one) | the page's title |
| `## …` `### …` | headings |
| `- item`, `* item`, `1. item` | lists, nested by indentation |
| `- [x] item` | a task, ticked |
| `> text` | a quotation |
| ```` ```ts ```` | a code block, language kept |
| `---` | a divider |
| `![alt](attachments/x)` | a picture, with the file |
| ```` ```sone-… ```` | the block it was, with its settings |
| Anything else | a paragraph, with its text intact |

**Bold, italic and links inside a line are not read.** `**bold**` arrives as
those exact characters, asterisks included. This is the honest limit of the
current importer: marks live inside the document's own formatting, and applying
them means a second parser and decisions about overlapping ranges. A page whose
words are all present is better than one where half of them vanished into a mark
that was read wrongly.

They *do* survive a SONE export in the file — so the text is not lost, only its
emphasis, and only on the way back in.

### Names that already exist

Nothing existing is ever replaced. There is no "overwrite" and there is no
"merge".

- By default a page whose name is already taken in that place is **left alone**,
  and the archive's copy is not imported. It is listed in the result so you know.
- Ticking **Create the … that already exist a second time** imports them
  alongside, so you have both and can compare.

A folder that already exists is used rather than duplicated: pages inside it land
in the folder that is already there.

### When something goes wrong

- **"This is not an archive"** — the file is not a zip, or it is damaged.
- **"Too large uncompressed"** — the archive expands beyond 512 MB.
- **A page fails** — the import carries on and lists it. Twelve pages plus a list
  of three that did not arrive is more use than nothing and one error.
- **A file whose kind cannot be recognised** is left out, and the picture that
  used it shows as missing rather than pointing at nothing.

### What an import does not do

- It does not restore comments, history, attribution or permissions — see the
  table above. Those are not in an archive to begin with.
- It does not put anything at the top level: the root of a workspace holds only
  folders, so an import always goes *into* something you chose.
- It does not run in the background. A large import holds the window open; a
  workspace-sized one is best done in a few pieces.

---

## Frequently asked, briefly

**Can I import into a page rather than a folder?** Yes. The pages become
children of it.

**Does a plain zip of Markdown files work?** Yes — that is the normal case. The
`sone-` fences and `attachments/` are only needed for things Markdown cannot
express.

**Can I export, edit the files on my computer, and import them back?** Yes, and
that is a supported way to work. Bold and italic will arrive as literal
characters — everything else round-trips.

**Is an export a backup?** No, and this matters. An export is your content in a
readable format; a backup is the whole instance including accounts, permissions,
history and comments. Backups belong in the administration area and are a
different thing entirely.

**Where did my export go?** A subtree export downloads immediately. A workspace
export appears under This workspace → Export this workspace and stays for a day.

---

## PDFs

A PDF in a page is drawn by SONE itself: a scrolling column of pages, the same on
a phone as at a desk ([ADR-0048](adr/0048-pdf-viewer.md)). The page count is in
the bar at the top, and **Open the original** beside the file's name opens the
file itself.

It replaced the browser's own embed, which was a real viewer on Chromium and
Firefox and a static picture of page one on iOS and iPadOS — the same document
readable at a desk and unreadable on a phone.

What it does not do yet: selecting or searching text inside a PDF, and
annotating. Reading came first; both are named in the record as the next steps.

The renderer is loaded the first time a PDF is opened and not before, so a
workspace with no PDFs in it never downloads it.
