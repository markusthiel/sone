# ADR-0066: What the import accepts

## Status

Accepted and built.

## Context

The import took a ZIP and nothing else. That was never decided — `planImport`
has always taken a list of entries, and an archive was simply the only thing
anything ever handed it. An operator asked to select a Markdown file instead,
which is the moment a habit has to become a decision.

Two other things came out of the same session and belong here, because they are
answers to the same question: **what is somebody allowed to drop on this, and
what happens to each kind.**

## Decisions

### The kind comes from the content, not the name or the content type

A ZIP begins `PK`. A file name is whatever the browser sent, and a content type
is a claim the browser makes — the client sends `application/zip` for everything
here, deliberately, so there is one place that decides and it is the one holding
the bytes.

### Text is imported; binary is refused

A Markdown file becomes one page. Anything that is neither an archive nor text
is refused.

The first version read everything-but-a-ZIP as Markdown, and a test written for
the old behaviour caught it: **a JPEG dropped on the import would have become a
page of binary nonsense with a plausible title, which is worse than a refusal
because it looks like it worked.**

A NUL byte in the first kilobyte is the line. It appears in every common binary
format and in no text file, and checking a prefix is enough — a megabyte of
Markdown is text by its first kilobyte. Deliberately *not* a UTF-8 validation: a
note written in Latin-1 is still a note, and refusing it would be stricter than
the editor that will hold it.

### Several files are packed in the browser, into one archive

So the dialog keeps showing **one plan**. Four files become one upload, and the
plan somebody confirms is the plan for all of them — rather than four plans to
approve one after another, which is a confirmation nobody reads by the third.

The alternative was a multipart parser on the server. The import's own comment
had argued against one when a request carried exactly one thing; that reasoning
expires when it carries several, but a parser is still more surface than a
hundred lines of header writing that both sides have to agree about anyway.

Packing is **stored, not deflated**: a handful of notes is kilobytes, and
compressing would mean `CompressionStream` in the browser and `zlib` on the
server — two implementations of one archive. The server keeps its deflating
writer for exports, where sizes matter.

A ZIP among several selected files is refused rather than nested. An archive
inside an archive is not something the import unpacks, and dropping it silently
would be worse than saying so.

### A refusal names the reason it actually is

Two were wrong before this:

`too_many_entries` had **no message at all**, so the interface showed the code.
It now says how many entries were found and how many are read — "too many"
cannot tell somebody whether they are over by one file or four thousand.

And a **Zip64** archive was reported as holding too many entries, because the
count in a ZIP's end record is sixteen bits and an archive needing more sets it
to `0xFFFF` — 65535, larger than any limit. That refusal sent people looking
for files to delete that were never the problem. Zip64 is named as itself now,
and unsupported rather than misread.

## Consequences

The import accepts an archive, a Markdown file, or several Markdown files. The
server gained no parser; the browser gained a stored-zip writer in core, whose
test is that the *server's* unzip reads what it writes.

Zip64 remains unread. Supporting it is a bigger reader and nobody has asked; the
refusal now says which format it is, so the answer is available to whoever hits
it.

## What is deliberately not decided

**Other formats.** No `.docx`, no HTML, no Notion or Obsidian archive with its
own conventions about links and front matter. Each is a mapping decision about
somebody else's model, not a file-reading one.

**Folders by drag and drop.** A directory dropped on the dialog would be the
natural extension of "several files", and it needs a decision about what the
folder's own name means — a page, a nesting level, or nothing.

**Compression when packing.** Only worth it if somebody selects enough Markdown
for it to matter, which would be a strange amount of Markdown to select.
