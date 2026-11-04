import React from 'react';
import { createRoot } from 'react-dom/client';
import * as Y from 'yjs';
import { pageContent } from '@sone/core';
import { EditorSurface } from '../../src/components/EditorSurface.tsx';
import '../../src/styles.css';

// Real editor, stylesheet and document. No server or user account is involved.
const doc = new Y.Doc();
const paragraphs = Array.from({ length: 18 }, (_, i) => {
  const p = new Y.XmlElement('paragraph');
  p.insert(0, [new Y.XmlText(`Paragraph ${i + 1}: ${'Long mobile text wraps across several lines. '.repeat(8)}`)]);
  return p;
});
pageContent(doc).insert(0, paragraphs);
const handle = {
  doc,
  status: 'synced',
  role: 'admin',
  canEdit: true,
  canComment: true,
  // Presence is not needed for geometry tests. EditorSurface passes this
  // through to createEditor, where awareness is optional.
  awareness: undefined,
};

createRoot(document.getElementById('root')!).render(
  <>
    <div className="main" style={{ height: '100dvh', width: '100%', overflow: 'auto' }}>
      <div className="topbar">Editor regression</div>
      <div className="page-body">
        <EditorSurface handle={handle as never} pageId="fixture" pageTitle="Fixture"
          linkablePages={[]} threads={[]} members={[]} onComment={() => {}} />
      </div>
    </div>
    <nav className="mode-bar" style={{ display: 'flex', position: 'fixed', left: 0, right: 0, bottom: 0, height: 55 }}>Navigation</nav>
  </>,
);
