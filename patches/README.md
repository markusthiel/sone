# y-prosemirror 1.3.7: remotely deleted node selection

When a selected atom is deleted in another editor, its relative selection can
resolve to the end of the new document (or no position). The upstream code
unconditionally constructs a NodeSelection there and throws because nodeAfter is
null. The incoming Yjs document has changed, but the ProseMirror view remains
stale and a later local change can write the old block back.

This patch keeps a node selection only where a selectable node remains; otherwise
it finds a nearby text cursor in the incoming document. Both ESM and CommonJS
entry points are patched. pnpm applies the patch using the committed lockfile;
the Docker dependency stage copies patches before installing.

Regression: packages/web/test/soteNodeView.test.tsx connects two real editor
views with separate Y.Docs, selects the task block in both and deletes it in one.
The test throws in restoreRelativeSelection without this patch.

## Deployment compatibility

Document compatibility version 6 excludes schema 5 clients at the existing sync
handshake. Applying the library fix only to newly loaded tabs is insufficient:
an older connected tab can still rewrite its stale document and remove the
replacement paragraph. The 5-to-6 migration changes only metadata, preserving
all block contents. Reload all SONE tabs after deploying the new server and web
bundle; previous clients receive the existing schema-mismatch reload message.
