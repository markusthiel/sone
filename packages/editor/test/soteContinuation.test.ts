import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EditorState } from 'prosemirror-state';
import { schema } from '../src/schema.js';
import { continueAfterSote } from '../src/soteContinuation.js';
import { blockLock } from '../src/blockLock.js';

const task = () => schema.nodes['soteTasks']!.create({ id: 'task-block', indent: 1 });
const paragraph = (text = '', props: string | null = null) => schema.nodes['paragraph']!.create(
  { props }, text ? schema.text(text) : undefined,
);

for (const following of [undefined, paragraph(), paragraph('Keep this'), task(), paragraph('', '{"locked":true}')]) {
  test('continue after an existing task preserves following content: ' + (following?.toString() ?? 'end'), () => {
    let state = EditorState.create({ schema, doc: schema.nodes['doc']!.create(null, [task(), ...(following ? [following] : [])]), plugins: [blockLock()] });
    const original = state.doc;
    const tr = state.tr;
    assert.equal(continueAfterSote(tr, 0), true);
    state = state.apply(tr);
    assert.equal(state.selection.$from.parent.type.name, 'paragraph');
    assert.equal(state.selection.$from.index(0), 1);
    assert.equal(state.doc.child(1).textContent, '');
    assert.deepEqual(state.doc.firstChild!.toJSON(), original.firstChild!.toJSON());
    if (following && (following.content.size > 0 || following.type.name !== 'paragraph' || following.attrs['props'])) {
      assert.deepEqual(state.doc.child(2).toJSON(), following.toJSON());
    }
    const size = state.doc.childCount;
    const again = state.tr;
    continueAfterSote(again, 0);
    state = state.apply(again);
    assert.equal(state.doc.childCount, size, 'repeated clicks reuse the blank line');
    state = state.apply(state.tr.insertText('New content'));
    assert.equal(state.doc.child(1).textContent, 'New content');
  });
}
