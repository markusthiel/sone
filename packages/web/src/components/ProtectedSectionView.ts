/**
 * SONE web — a protected section in a page.
 *
 * The block holds an id and nothing else. What is inside is a separate document
 * that the server serves only to people who may read it, which is the only way
 * a permission on part of a page can be enforced (ADR-0026).
 *
 * So this view has two states, and they are not "open" and "closed": either the
 * content arrived or it did not. A section somebody cannot read draws as a
 * closed door with no title and no preview — the fact that something is here is
 * the most it says.
 */

import type { EditorView, NodeView } from 'prosemirror-view';

interface PMNodeLike {
  type: { name: string };
  attrs: Record<string, unknown>;
}

export class ProtectedSectionView implements NodeView {
  readonly dom: HTMLElement;
  private attrs: Record<string, unknown>;

  constructor(
    node: PMNodeLike,
    private readonly onOpen: (containerId: string) => void,
  ) {
    this.attrs = node.attrs;
    this.dom = document.createElement('div');
    this.dom.className = 'protected-section';
    this.dom.contentEditable = 'false';
    this.render();
  }

  private render(): void {
    this.dom.textContent = '';
    const containerId = String(this.attrs['containerId'] ?? '');

    const label = document.createElement('span');
    label.className = 'protected-label';
    label.textContent = 'Protected section';

    const note = document.createElement('span');
    note.className = 'protected-note';
    // Said plainly, because the alternative is somebody assuming this is a
    // rendering fault and reloading the page to fix it.
    note.textContent = 'Only people you add can open this.';

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'btn';
    open.textContent = 'Open';
    open.addEventListener('click', (event) => {
      event.preventDefault();
      if (containerId) this.onOpen(containerId);
    });

    this.dom.append(label, note, open);
  }

  update(node: PMNodeLike): boolean {
    if (node.type.name !== 'protectedSection') return false;
    this.attrs = node.attrs;
    this.render();
    return true;
  }

  /**
   * Nothing inside reaches ProseMirror.
   *
   * The same reason a collection view stops events: what happens in there
   * belongs to another document, and letting a click through would move this
   * document's selection for a reason nobody could see.
   */
  stopEvent(): boolean {
    return true;
  }

  ignoreMutation(): boolean {
    return true;
  }
}

export function protectedSectionView(
  onOpen: (containerId: string) => void,
): NonNullable<EditorView['props']['nodeViews']>[string] {
  return (node) => new ProtectedSectionView(node as unknown as PMNodeLike, onOpen);
}
