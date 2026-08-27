/**
 * SONE web — the task list for a page.
 *
 * Every todo block in the document, in order, with its state. Derived from the
 * Yjs document through `readBlockTree` — the same walk the server's materialiser
 * uses — so the panel and the projection cannot disagree about what is a task or
 * whether it is done.
 *
 * Toggling writes straight to the CRDT rather than going through the editor.
 * The panel has no ProseMirror view, and it should not need one: a checkbox is a
 * property of a block, and `setBlockProps` is the one place that knows how to
 * change one. The editor picks the change up like any other remote edit.
 */

import { readBlockTree, setBlockProps } from '@sone/core';
import { useCallback, useEffect, useState } from 'react';
import type * as Y from 'yjs';

export interface Task {
  id: string;
  text: string;
  done: boolean;
  /** Nesting depth, so a subtask reads as one. */
  indent: number;
}

const DEBOUNCE_MS = 200;

function buildTasks(doc: Y.Doc): Task[] {
  const { blocks } = readBlockTree(doc);
  const tasks: Task[] = [];

  for (const block of blocks) {
    if (block.type !== 'todo') continue;
    tasks.push({
      id: block.id,
      text: block.text,
      done: block.props['checked'] === true,
      indent: block.depth,
    });
  }

  return tasks;
}

export function useTasks(doc: Y.Doc | null): {
  tasks: Task[];
  toggle: (taskId: string, done: boolean) => void;
} {
  const [tasks, setTasks] = useState<Task[]>([]);

  useEffect(() => {
    if (!doc) {
      setTasks([]);
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    const rebuild = (): void => setTasks(buildTasks(doc));
    const schedule = (): void => {
      if (timer) clearTimeout(timer);
      // Debounced, because a task appears as it is typed and a whole-document
      // walk per keystroke is wasteful on a long page.
      timer = setTimeout(rebuild, DEBOUNCE_MS);
    };

    rebuild();
    doc.on('update', schedule);
    return () => {
      if (timer) clearTimeout(timer);
      doc.off('update', schedule);
    };
  }, [doc]);

  const toggle = useCallback(
    (taskId: string, done: boolean) => {
      if (!doc) return;

      // Applied optimistically as well as written, so the checkbox responds to
      // the tap rather than after the debounce. The rebuild will agree.
      setTasks((previous) =>
        previous.map((task) => (task.id === taskId ? { ...task, done } : task)),
      );

      setBlockProps(doc, taskId, { checked: done });
    },
    [doc],
  );

  return { tasks, toggle };
}
