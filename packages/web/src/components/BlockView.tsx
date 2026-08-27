/**
 * SONE web — block renderer.
 *
 * Read-only for now. The editable surface is the next piece of work and needs
 * the vendored ProseMirror (ADR-0004, ADR-0015); this renders the same tree so
 * the sync path is visible and testable before the editor exists.
 *
 * Reads through `readBlockTree` from @sone/core rather than walking the
 * document here, so the client, the server's materialiser and this renderer
 * cannot disagree about where a block boundary is.
 */

import { readBlockTree, type TreeBlock } from '@sone/core';
import { useEffect, useState , type ReactElement } from 'react';
import type * as Y from 'yjs';

interface BlockViewProps {
  doc: Y.Doc;
}

/**
 * Re-render on document change.
 *
 * Subscribes to the whole document rather than to individual blocks. Correct
 * but coarse: every keystroke anywhere re-reads the tree. Acceptable for a
 * read-only view of a page-sized document, and the editor will not work this
 * way — ProseMirror maintains its own incremental view.
 */
function useBlockTree(doc: Y.Doc): { blocks: TreeBlock[]; warnings: string[] } {
  const [result, setResult] = useState(() => readBlockTree(doc));

  useEffect(() => {
    const update = (): void => setResult(readBlockTree(doc));
    update();
    doc.on('update', update);
    return () => doc.off('update', update);
  }, [doc]);

  return result;
}

export function BlockView({ doc }: BlockViewProps): ReactElement {
  const { blocks } = useBlockTree(doc);

  if (blocks.length === 0) {
    return <p className="muted">This page is empty.</p>;
  }

  // Rendered flat with indentation from depth rather than as nested elements.
  // The read-only view gains nothing from real nesting, and a flat list keeps
  // the renderer simple until ProseMirror owns the DOM.
  return (
    <>
      {blocks.map((block) => (
        <Block key={block.id} block={block} />
      ))}
    </>
  );
}

function Block({ block }: { block: TreeBlock }): ReactElement {
  const indent = block.depth * 20;
  const level = typeof block.props['level'] === 'number' ? block.props['level'] : undefined;

  const common = {
    className: 'block',
    'data-type': block.type,
    ...(level ? { 'data-level': String(level) } : {}),
    // Logical property: indentation follows text direction (ADR-0016).
    style: indent > 0 ? { marginInlineStart: `${indent}px` } : undefined,
  };

  switch (block.type) {
    case 'heading': {
      // Clamped: a stored level of 9 must not produce an invalid element.
      const tag = `h${Math.min(6, Math.max(1, level ?? 2))}` as 'h1';
      const Tag = tag;
      return <Tag {...common}>{block.text}</Tag>;
    }

    case 'code':
      return (
        <pre {...common}>
          <code>{typeof block.props['source'] === 'string' ? block.props['source'] : block.text}</code>
        </pre>
      );

    case 'bulletList':
    case 'numberedList':
      // A single item, not a list container: the tree is already flattened, so
      // wrapping each item in <ul> would produce one list per item. Correct
      // list semantics arrive with the editor.
      return (
        <div {...common}>
          <span aria-hidden="true">• </span>
          {block.text}
        </div>
      );

    case 'todo': {
      const checked = block.props['checked'] === true;
      return (
        <div {...common}>
          {/* Disabled rather than omitted: the state is meaningful even when
              this view cannot change it. */}
          <input type="checkbox" checked={checked} disabled readOnly style={{ width: 'auto', minHeight: 0 }} />{' '}
          {block.text}
        </div>
      );
    }

    case 'divider':
      return <hr {...common} />;

    case 'quote':
      return <blockquote {...common}>{block.text}</blockquote>;

    case 'callout':
      return (
        <div {...common} style={{ ...common.style, background: 'var(--sone-bg-subtle)', padding: '10px 12px', borderRadius: 'var(--sone-radius)' }}>
          {typeof block.props['emoji'] === 'string' ? `${block.props['emoji']} ` : ''}
          {block.text}
        </div>
      );

    case 'image': {
      const url = typeof block.props['url'] === 'string' ? block.props['url'] : null;
      const alt = typeof block.props['alt'] === 'string' ? block.props['alt'] : '';
      // An image block without a URL is not an error — an upload may still be
      // in flight — so it renders as a placeholder rather than a broken image.
      return url ? (
        <img {...common} src={url} alt={alt} style={{ ...common.style, maxWidth: '100%' }} />
      ) : (
        <div {...common} className="block muted">
          (image)
        </div>
      );
    }

    case 'collectionView':
      // Databases are node views mounting their own renderer (ADR-0015). Until
      // that exists, say so rather than render nothing and look broken.
      return (
        <div {...common} className="block muted">
          (database view — not yet implemented)
        </div>
      );

    default:
      return <p {...common}>{block.text}</p>;
  }
}
