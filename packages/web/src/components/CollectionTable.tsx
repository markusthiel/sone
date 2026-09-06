/**
 * SONE web — a collection as a table.
 *
 * The placeholder this replaces was the last visible "not built yet" in the
 * application.
 *
 * Two decisions shape it.
 *
 * **A row is a page.** The first column is its title, and a control at the end of
 * that cell opens the page — because that is what a row is. Clicking the cell
 * itself edits the title, which is the inversion ADR-0034 argues for: filling a
 * table means working down the first column, and when the cell was a link every
 * attempt to do so left the table.
 *
 * **A paste of a grid becomes entries**, appended after whatever is there rather
 * than overwriting it, in one request, up to fifty at a time. Pasting twice adds
 * to the first fifty, which is what makes the cap a limit on an operation rather
 * than on a table.
 *
 * **Only column types that can be filled are offered.** The model knows about
 * select, relation, formula and rollup; this offers text, number, date,
 * checkbox and the three text-like ones, because those are the ones a cell here
 * can actually edit. A select column with no way to manage its options is a
 * column nobody can fill, and offering one is worse than leaving it out.
 */

import { type ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';

// The first import from core in this file: what a formula may name is the
// parser's business, and a second list here would be a second answer to it
// (ADR-0056).
import { applyCompletion, completions } from '@sone/core';

import {
  type DerivedCellValue,
  ApiError,
  api,
  type CollectionData,
  type CollectionField,
  type CollectionFile,
  type StoredCellValue,
} from '../api/client.ts';
import { paths } from '../routes/paths.ts';
import { usePageLink } from '../routes/pageLink.tsx';
import {
  Cell,
  SAVE_DELAY_MS,
  optionsOf,
  valueFromText,
} from './CollectionCell.tsx';
import { messageFor } from './Auth.tsx';
import {
  FormulaIcon,
  SigmaIcon,
  RelationIcon,
  ArrowDownIcon,
  ArrowUpIcon,
  CalendarIcon,
  CheckSquareIcon,
  ChevronRightIcon,
  ColumnsIcon,
  FilterIcon,
  HashIcon,
  LinkIcon,
  ListIcon,
  MailIcon,
  PhoneIcon,
  PaperclipIcon,
  PlusIcon,
  SelectIcon,
  TableIcon,
  TextIcon,
  TrashIcon,
  type IconProps,
} from './icons.tsx';
import { CollectionBoard } from './CollectionBoard.tsx';
import { MAX_PASTE_ROWS, looksLikeGrid, parsePastedGrid } from './pastedGrid.ts';
import { useTableHistory } from '../hooks/useTableHistory.ts';
import { CollectionGallery } from './CollectionGallery.tsx';
import { exportFilename, rowsAsCsv, rowsAsTabbed } from './rowsAsText.ts';
import type { MessageKey } from '../i18n/messages.en.ts';
import { useT } from '../i18n/useT.tsx';
import { readDensity, ViewRules } from './ViewRules.tsx';
import { OptionEditor, type EditableOption } from './OptionEditor.tsx';

interface CollectionTableProps {
  /** A collection is addressed by its own id: a page may hold several. */
  collectionId: string;
}

/**
 * What the rules button says.
 *
 * The count rather than "Filter": a view with rules on it looks the same as one
 * without until you open it, and a table showing fewer rows than somebody
 * expects is the kind of thing they blame on the software.
 */
/**
 * "2 filters, sorted", or the plain label when a view has no rules.
 *
 * Takes the translator rather than reaching for it: this is a helper outside any
 * component, and the count and the sort are two plural-and-select decisions the
 * German has to make differently (ADR-0041).
 */
function ruleSummary(
  view: { definition: Record<string, unknown> },
  t: (key: MessageKey, values?: Record<string, string | number>) => string,
): string {
  const filters = Array.isArray(view.definition['filters'])
    ? (view.definition['filters'] as unknown[]).length
    : 0;
  const sorted = Array.isArray(view.definition['sort'])
    ? (view.definition['sort'] as unknown[]).length > 0
    : false;

  if (filters === 0 && !sorted) return t('table.filterAndSort');
  return t('table.rules', { filters, sorted: sorted ? 'yes' : 'no' });
}

/**
 * Column types this table can edit, with an icon each. See the note above.
 *
 * A type is recognised faster as a shape than as a word, and this menu is nine
 * of them. The icons are the interface's own set rather than the entry icons,
 * which are chosen per entry and could be anything — these are fixed parts of
 * the interface and must not change when somebody picks a new folder icon.
 */
const ADDABLE: ReadonlyArray<{
  type: string;
  /** A message key, keyed by the type — the menu translates it (ADR-0041). */
  label: MessageKey;
  Icon: (props: IconProps) => ReactElement;
}> = [
  { type: 'text', label: 'field.text', Icon: TextIcon },
  // Offered now that its options can be managed. It was held back precisely
  // because a column whose options nobody can edit is one nobody can fill.
  { type: 'select', label: 'field.select', Icon: SelectIcon },
  { type: 'multiSelect', label: 'field.multiSelect', Icon: ListIcon },
  { type: 'number', label: 'field.number', Icon: HashIcon },
  { type: 'date', label: 'field.date', Icon: CalendarIcon },
  { type: 'checkbox', label: 'field.checkbox', Icon: CheckSquareIcon },
  { type: 'url', label: 'field.url', Icon: LinkIcon },
  { type: 'email', label: 'field.email', Icon: MailIcon },
  { type: 'phone', label: 'field.phone', Icon: PhoneIcon },
  // One type for every kind of file (ADR-0035): an image, a PDF and a
  // spreadsheet are the same decision — attach a thing — and differ in how they
  // are drawn, not in what column they belong in.
  { type: 'files', label: 'field.files', Icon: PaperclipIcon },
  // Pointing at rows in another collection (ADR-0054). Chosen like any other
  // type; the collection it points at is asked for immediately afterwards,
  // because a relation cannot be created without one.
  { type: 'relation', label: 'field.relation', Icon: RelationIcon },
  // The derived other side (ADR-0054). Like a relation, it asks a question
  // immediately afterwards: which relation points here, and what to do with it.
  { type: 'rollup', label: 'field.rollup', Icon: SigmaIcon },
  // An expression over the row's own values (ADR-0056). Like the two above it,
  // it asks a question straight afterwards — here, which expression.
  { type: 'formula', label: 'field.formula', Icon: FormulaIcon },
];

/** Which aggregates need a field to aggregate (ADR-0054). */
const needsField = (aggregate: string): boolean =>
  aggregate === 'lookup' || aggregate === 'sum' || aggregate === 'min' || aggregate === 'max';

/** How long after the last keystroke a text cell is saved. */


export function CollectionTable({ collectionId }: CollectionTableProps): ReactElement {
  const pageLink = usePageLink();
  const { t } = useT();
  const [data, setData] = useState<CollectionData | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * Where the column-type menu is, or null when it is closed.
   *
   * A position rather than a boolean, because the menu is positioned against the
   * viewport: it used to be absolute inside the table's scroll container, which
   * clips — `overflow-x: auto` clips both axes — so the list of column types was
   * cut off at the edge of the table and the types below the fold could not be
   * read or chosen. Anchored to the button's rectangle instead, and rendered
   * outside the scroller.
   */
  const [addingColumn, setAddingColumn] = useState<{ x: number; y: number } | null>(null);
  /** Whether the "empty the table" confirmation is showing. */
  const [clearing, setClearing] = useState(false);
  /**
   * Something worth saying that is not a failure.
   *
   * Separate from `error` because the two read differently and are dismissed
   * differently: an error stays until the thing that failed works, and a notice
   * is about what just happened.
   */
  const [notice, setNotice] = useState<string | null>(null);
  // Which view is showing. Local rather than stored: which view somebody is
  // looking at is not a property of the collection, and persisting it would
  // change what a colleague sees.
  const [viewId, setViewId] = useState<string | null>(null);
  const [editingRules, setEditingRules] = useState(false);
  /**
   * What is typed in the search box, and what has been asked for.
   *
   * Two values, because the request is debounced: sending one per keystroke
   * would put a query per character through the database, and the box has to
   * stay responsive while that settles.
   */
  const [query, setQuery] = useState('');
  const [asked, setAsked] = useState('');

  // Read inside `load` without making it depend on the view: changing views
  // triggers its own reload, and a dependency here would make every render that
  // touched the view refetch.
  const viewRef = useRef<string | null>(null);
  viewRef.current = viewId;
  const askedRef = useRef('');
  askedRef.current = asked;

  const load = useCallback(async () => {
    try {
      // The chosen view, so its filters and sorting are applied by the
      // database rather than after the rows arrive.
      setData(
        await api.collection(collectionId, viewRef.current ?? undefined, askedRef.current),
      );
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    }
  }, [collectionId]);

  /**
   * The next page, appended (ADR-0055).
   *
   * Appended rather than replacing, and only ever forwards: a table that
   * scrolls is one list somebody is reading, not a sequence of pages they
   * navigate. There is no "previous" because scrolling up is already that.
   */
  const [loadingMore, setLoadingMore] = useState(false);
  const loadMore = useCallback(async () => {
    const cursor = data?.nextCursor;
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const next = await api.collection(
        collectionId,
        viewRef.current ?? undefined,
        askedRef.current,
        cursor,
      );
      setData((current) =>
        current
          ? {
              ...next,
              // The rows accumulate; everything else is the newer answer —
              // including `nextCursor`, which is what ends the scroll.
              rows: [...current.rows, ...next.rows],
              // `files` is optional in the response, so both sides are
              // defaulted rather than spread blindly.
              files: [...(current.files ?? []), ...(next.files ?? [])],
            }
          : next,
      );
      setError(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    } finally {
      setLoadingMore(false);
    }
  }, [collectionId, data?.nextCursor, loadingMore]);

  useEffect(() => {
    void load();
  }, [load, viewId, asked]);

  // Settle before asking. 250ms is short enough not to feel laggy and long
  // enough that a typed word is one request rather than five.
  useEffect(() => {
    const timer = setTimeout(() => setAsked(query), 250);
    return () => clearTimeout(timer);
  }, [query]);

  /**
   * Apply a value locally, then save it.
   *
   * Local first, because a cell that only updates after a round trip feels
   * broken while typing. The reload afterwards is what makes a rejected write
   * visible rather than silently kept on screen.
   */
  const write = useCallback(
    async (rowId: string, fieldId: string, value: StoredCellValue | null) => {
      setData((current) =>
        current
          ? {
              ...current,
              rows: current.rows.map((row) =>
                row.id === rowId
                  ? {
                      ...row,
                      values: { ...row.values, [fieldId]: value ?? undefined },
                    }
                  : row,
              ),
            }
          : current,
      );

      try {
        await api.setCellValue(rowId, fieldId, value);
        setError(null);
      } catch (err) {
        setError(err instanceof ApiError ? err.code : 'network_error');
        // Reloaded so the screen shows what was stored rather than what was
        // typed. A refused value left in place is a lie about saved work.
        await load();
      }
    },
    [load],
  );

  /** A relation column waiting for the collection it points at (ADR-0054). */
  const [choosingRelation, setChoosingRelation] = useState(false);
  /** A rollup waiting for the relation it reads, and what to do with it. */
  const [choosingRollup, setChoosingRollup] = useState(false);
  /** A formula being written, and what the server said about the last attempt. */
  /**
   * The formula being written: `new` for a column that does not exist yet, or
   * the id of one being edited (ADR-0056).
   *
   * One dialog for both, because they are the same decision typed into the same
   * field — and two would drift the moment one of them gained the column list.
   */
  const [writingFormula, setWritingFormula] = useState<'new' | string | null>(null);
  const [formulaText, setFormulaText] = useState('');
  const [formulaError, setFormulaError] = useState<string | null>(null);
  /** Where the caret is, which is what decides what a completion replaces. */
  const [caret, setCaret] = useState(0);
  /** Which suggestion is chosen; -1 means the list is closed. */
  const [suggestion, setSuggestion] = useState(-1);
  const formulaField = useRef<HTMLInputElement | null>(null);

  /*
   * What could complete the word at the caret (ADR-0056).
   *
   * From this collection's own stored columns, so a suggestion cannot be a
   * column the server would refuse — a formula may not read another formula,
   * and offering one would be teaching somebody a mistake.
   */
  const formulaSuggestions = useMemo(
    () =>
      completions(
        formulaText,
        caret,
        (data?.fields ?? [])
          .filter((one) => one.fieldType !== 'formula')
          .map((one) => one.name),
      ),
    [formulaText, caret, data?.fields],
  );
  const [incoming, setIncoming] = useState<
    Array<{
      fieldId: string;
      fieldName: string;
      fromCollection: string;
      aggregatable: Array<{ id: string; name: string }>;
    }> | null
  >(null);

  /*
   * The incoming relations, also when a rollup column already exists.
   *
   * The header's aggregate select needs them: choosing "their total" without
   * offering a field would send a config the server refuses, and a control that
   * produces a 422 reads as broken rather than as unfinished.
   */
  const hasRollup = (data?.fields ?? []).some((field) => field.fieldType === 'rollup');

  useEffect(() => {
    if (!choosingRollup && !hasRollup) return;
    let cancelled = false;
    void api
      .incomingRelations(collectionId)
      .then((result) => {
        if (!cancelled) setIncoming(result.relations);
      })
      .catch(() => {
        if (!cancelled) setIncoming([]);
      });
    return () => {
      cancelled = true;
    };
  }, [choosingRollup, hasRollup, collectionId]);
  const [collections, setCollections] = useState<
    Array<{ id: string; title: string }> | null
  >(null);

  useEffect(() => {
    if (!choosingRelation) return;
    let cancelled = false;
    void api
      .relationTargets(collectionId)
      .then((result) => {
        // The server has already excluded this collection: the question it
        // answers is "what could a relation from here point at".
        if (!cancelled) setCollections(result.collections);
      })
      .catch(() => {
        if (!cancelled) setCollections([]);
      });
    return () => {
      cancelled = true;
    };
  }, [choosingRelation, collectionId]);

  const addColumn = async (fieldType: string, target?: string): Promise<void> => {
    setAddingColumn(null);
    /*
     * A relation asks where it points before it exists.
     *
     * The server refuses one without a target, and it is right to: a column
     * that can point anywhere gives a picker over the workspace and a rollup
     * with nothing to aggregate. So the menu hands off to a second step rather
     * than creating something the server would reject.
     */
    if (fieldType === 'relation' && !target) {
      setChoosingRelation(true);
      return;
    }
    /*
     * A rollup asks which relation points here, and what to do with it.
     *
     * The server refuses one without a valid pair, so the menu hands off rather
     * than creating something that would be rejected — the same shape as the
     * relation step beside it.
     */
    if (fieldType === 'rollup') {
      setChoosingRollup(true);
      return;
    }
    if (fieldType === 'formula' && !target) {
      setWritingFormula('new');
      return;
    }
    try {
      await api.addCollectionField(collectionId, {
        name: 'Untitled',
        fieldType,
        ...(target ? { config: { collectionId: target } } : {}),
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    }
  };

  /**
   * Create a formula column, keeping the dialog open if it will not do.
   *
   * The server validates: it parses the expression, resolves the column names
   * to ids and refuses a formula that reads another formula (ADR-0056). So the
   * dialog does not pre-validate — one validator, on the side that stores it,
   * rather than two that can disagree about what is allowed.
   */
  const addFormula = async (text: string): Promise<void> => {
    try {
      if (writingFormula && writingFormula !== 'new') {
        // Editing: the same validation runs on the way in, which is what keeps
        // an edited formula from pointing at another formula.
        await api.updateCollectionField(collectionId, writingFormula, {
          config: { formula: text },
        });
      } else {
        await api.addCollectionField(collectionId, {
          name: 'Untitled',
          fieldType: 'formula',
          config: { formula: text },
        });
      }
      setWritingFormula(null);
      setFormulaText('');
      setFormulaError(null);
      await load();
    } catch (err) {
      // Kept open with the reason: a dialog that closes on a rejected formula
      // loses what somebody typed, and they will retype it wrong the same way.
      setFormulaError(err instanceof ApiError ? err.code : 'network_error');
    }
  };

  /** Create a rollup that counts what points here through one relation. */
  const addRollup = async (viaFieldId: string): Promise<void> => {
    try {
      await api.addCollectionField(collectionId, {
        name: 'Untitled',
        fieldType: 'rollup',
        config: { viaFieldId, aggregate: 'count' },
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    }
  };

  const removeColumn = async (fieldId: string): Promise<void> => {
    try {
      await api.removeCollectionField(collectionId, fieldId);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    }
  };

  const saveOptions = async (
    fieldId: string,
    options: Array<{ id: string; name: string; color: string }>,
  ): Promise<void> => {
    try {
      await api.setFieldOptions(collectionId, fieldId, options);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    }
  };

  /**
   * Change a rollup's aggregate.
   *
   * The whole config is sent, not a patch of it: `viaFieldId` is what the
   * rollup is *built on*, and a config write that omitted it would clear the
   * relation the column reads — the server replaces the object rather than
   * merging into it.
   */
  const setAggregate = async (
    fieldId: string,
    aggregate: string,
    aggregateField?: string,
  ): Promise<void> => {
    const field = data?.fields.find((one) => one.id === fieldId);
    const via = field?.config?.['viaFieldId'];
    if (typeof via !== 'string') return;
    /*
     * An aggregate that needs no field drops the one it had.
     *
     * Otherwise switching from "their total" back to "how many" would leave a
     * `fieldId` behind, and switching forward again would silently reuse a
     * field somebody chose for a different question.
     */
    const keepField = needsField(aggregate);
    const chosen = aggregateField ?? (keepField ? field?.config?.['fieldId'] : undefined);
    if (keepField && typeof chosen !== 'string') {
      // Nothing to send yet: the field select is showing and is the next thing
      // to answer. Sending now would earn a 422 for a half-made decision.
      setError(null);
      return;
    }
    try {
      await api.updateCollectionField(collectionId, fieldId, {
        config: {
          ...field?.config,
          viaFieldId: via,
          aggregate,
          ...(keepField && typeof chosen === 'string' ? { fieldId: chosen } : { fieldId: null }),
        },
      });
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    }
  };

  const renameColumn = async (fieldId: string, name: string): Promise<void> => {
    try {
      await api.renameCollectionField(collectionId, fieldId, name);
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    }
  };

  /* The value columns, which `pasteGrid` needs — so computed before the guard
     and tolerant of there being no data yet, rather than after it where a hook
     could not reach it. */
  const columns = (data?.fields ?? []).filter((field) => field.id !== data?.titleFieldId);

  /* Everything below is a hook, so all of it sits above the early return for
   * a table that has not loaded yet. React counts hooks per render: a hook
   * after a conditional return runs on the renders that get past it and not
   * on the ones that do not, which is a different number each time — and the
   * component throws rather than rendering. That is what "the table vanished
   * and a new one would not appear" was: on the first render `data` is null,
   * the guard returned, and the hooks after it were skipped; the moment the
   * data arrived there were five more than before.
   */
  /**
   * Which rows are selected (ADR-0040).
   *
   * Local, like the undo stack: a selection is about what somebody is doing this
   * minute, and persisting it would mean explaining a highlighted row to whoever
   * opens the page next. Cleared whenever the rows change, because a selection of
   * ids that are no longer there is a count that lies.
   */
  const [selected, setSelected] = useState<Set<string>>(new Set());

  /**
   * The files any cell refers to, by id (ADR-0035).
   *
   * From the collection response, plus anything uploaded since the last reload —
   * an upload has to name its chip immediately, and waiting for a round trip to
   * learn the name of a file this browser just chose would be absurd.
   */
  const [uploaded, setUploaded] = useState<CollectionFile[]>([]);
  const rememberFile = useCallback((file: CollectionFile) => {
    setUploaded((current) => [...current, file]);
  }, []);
  const fileIndex = useMemo(
    () =>
      new Map<string, CollectionFile>(
        [...(data?.files ?? []), ...uploaded].map((file) => [file.id, file]),
      ),
    [data?.files, uploaded],
  );

  /**
   * Undo and redo for this table's own operations (ADR-0034).
   *
   * Declared here because every operation below records itself on it, and the
   * two buttons that drive it live in the toolbar.
   */
  const history = useTableHistory(setError);

  /** Rename a row, which is writing its page's title. */
  const writeTitle = useCallback(
    async (rowId: string, title: string, previous: string) => {
      setData((current) =>
        current
          ? {
              ...current,
              rows: current.rows.map((row) => (row.id === rowId ? { ...row, title } : row)),
            }
          : current,
      );
      try {
        await api.renameEntry(rowId, title);
        setError(null);
      } catch (err) {
        setError(err instanceof ApiError ? err.code : 'network_error');
        await load();
        return;
      }
      history.push({
        label: 'undo.rename',
        forward: () => api.renameEntry(rowId, title).then(() => load()),
        backward: () => api.renameEntry(rowId, previous).then(() => load()),
      });
    },
    [history, load],
  );

  /**
   * Take a pasted grid and make entries of it.
   *
   * `anchorRowId` is the row the paste landed in, and `columnFrom` the column it
   * landed on — cells to the left of it are not touched, so pasting into the
   * second column fills the second onwards.
   *
   * An *empty* anchor row is filled with the first line rather than left behind:
   * that is the row somebody just made in order to paste into it, and an empty
   * entry sitting above the result is a page nobody wanted. A row with anything
   * in it is never overwritten — the rest is appended, which is the whole point.
   */
  const pasteGrid = useCallback(
    async (text: string, anchorRowId: string | null, columnFrom: number) => {
      setNotice(null);
      const grid = parsePastedGrid(text);
      if (grid.rows.length === 0) return;

      // `columnFrom` counts the title as 0, so column 1 is the first value
      // column. Slicing by it directly skipped one — a paste starting in the
      // first value column would have filled the second onwards.
      const targets = columnFrom === 0 ? columns : columns.slice(columnFrom - 1);
      const anchor = anchorRowId
        ? (data?.rows.find((row) => row.id === anchorRowId) ?? null)
        : null;
      const anchorEmpty =
        anchor !== null &&
        anchor.title.trim() === '' &&
        Object.values(anchor.values).every((value) => value === null || value === undefined);

      const lines = [...grid.rows];
      let filledAnchor: { rowId: string; title: string; previous: string } | null = null;

      if (anchorEmpty && anchor) {
        const first = lines.shift()!;
        // The first column of a paste is the entry's name only when the paste
        // starts at the title column; otherwise the name is left alone and the
        // values fill from where it started.
        const title = columnFrom === 0 ? (first[0] ?? '') : anchor.title;
        const offset = columnFrom === 0 ? 1 : 0;
        for (const [at, field] of targets.entries()) {
          const cell = first[at + offset];
          if (cell === undefined) continue;
          await api.setCellValue(anchor.id, field.id, valueFromText(field, cell));
        }
        if (columnFrom === 0) await api.renameEntry(anchor.id, title);
        filledAnchor = { rowId: anchor.id, title, previous: anchor.title };
      }

      let created: string[] = [];
      if (lines.length > 0) {
        const rows = lines.map((cells) => {
          const values: Record<string, StoredCellValue | null> = {};
          const offset = columnFrom === 0 ? 1 : 0;
          for (const [at, field] of targets.entries()) {
            const cell = cells[at + offset];
            if (cell !== undefined) values[field.id] = valueFromText(field, cell);
          }
          return { title: columnFrom === 0 ? (cells[0] ?? '') : '', values };
        });

        try {
          const result = await api.addCollectionRows(collectionId, rows);
          created = result.created;
        } catch (err) {
          setError(err instanceof ApiError ? err.code : 'network_error');
          await load();
          return;
        }
      }

      await load();

      // One entry on the stack for the whole paste, including the anchor row it
      // filled: undoing half a paste would be worse than not offering it.
      history.push({
        label: 'undo.paste',
        labelValues: { count: created.length + (filledAnchor ? 1 : 0) },
        forward: async () => {
          for (const rowId of created) await api.restoreEntry(rowId);
          if (filledAnchor) await api.renameEntry(filledAnchor.rowId, filledAnchor.title);
          await load();
        },
        backward: async () => {
          // Archived rather than deleted, which is what makes it reversible:
          // restoring is the exact inverse and needs no ids that do not exist yet.
          for (const rowId of created) await api.archivePage(rowId);
          if (filledAnchor) await api.renameEntry(filledAnchor.rowId, filledAnchor.previous);
          await load();
        },
      });

      if (grid.ignored > 0) {
        // Said with the number, and not as an error.
        //
        // It went through the error channel, which was wrong twice over: nothing
        // failed — fifty entries were added — and the message could not carry a
        // count, because the catalogue maps a code to a fixed sentence. What
        // somebody needs to know here is how many are left, so they know whether
        // one more paste finishes the job.
        setNotice(
          grid.ignored === 1
            ? `Fifty entries at a time. One more was not added — paste it again and it will go below these.`
            : `Fifty entries at a time. ${grid.ignored} more were not added — paste them again and they will go below these.`,
        );
      }
    },
    [collectionId, columns, data, history, load],
  );

  /** Empty the table: every row archived, and every row restorable. */
  const clearRows = useCallback(async () => {
    try {
      const result = await api.clearCollectionRows(collectionId);
      await load();
      history.push({
        label: 'undo.empty',
        labelValues: { count: result.archived.length },
        forward: async () => {
          for (const rowId of result.archived) await api.archivePage(rowId);
          await load();
        },
        backward: async () => {
          for (const rowId of result.archived) await api.restoreEntry(rowId);
          await load();
        },
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    }
  }, [collectionId, history, load]);

  if (error && !data) return <p className="error">{messageFor(error)}</p>;
  if (!data) return <p className="muted">{t('table.loading')}</p>;

  const titleField = data.fields.find((field) => field.id === data.titleFieldId);

  const view = data.views.find((entry) => entry.id === viewId) ?? data.views[0];

  // --- acting on a selection (ADR-0040) ------------------------------------

  // "Undo: paste 3 entries", or what to say when there is nothing to undo. Built
  // here because the label is a key and its plural needs the count with it
  // (ADR-0041).
  const undoTitle =
    history.undoLabel === null
      ? t('table.nothingToUndo')
      : t('table.undo', {
          action: t(history.undoLabel as MessageKey, history.undoValues),
        });
  const redoTitle =
    history.redoLabel === null
      ? t('table.nothingToRedo')
      : t('table.redo', {
          action: t(history.redoLabel as MessageKey, history.redoValues),
        });

  const chosen = data.rows.filter((row) => selected.has(row.id));
  const titleHeading = titleField?.name ?? 'Name';

  const copySelection = async (): Promise<void> => {
    const text = rowsAsTabbed(chosen, columns, fileIndex, titleHeading);
    try {
      await navigator.clipboard.writeText(text);
      setNotice(
        `${chosen.length} ${chosen.length === 1 ? 'entry' : 'entries'} copied. Paste appends them, here or anywhere else.`,
      );
    } catch {
      // Refused, which happens without a secure context or a user gesture the
      // browser recognises. Said rather than swallowed, because nothing else
      // would have changed on screen.
      setError('clipboard_refused');
    }
  };

  const exportSelection = (): void => {
    const csv = rowsAsCsv(chosen, columns, fileIndex, titleHeading);
    // A blob and a link, so the file is named and lands in the downloads folder.
    // No route: an export means "what is on screen", and a route would have to
    // re-run the view's query to mean the same thing.
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    // Named after the view, which is what somebody sees above the table. The
    // page's own title is not in this response, and asking for it to name a file
    // would be a request for a file name.
    link.download = exportFilename(view?.name ?? 'table');
    link.click();
    URL.revokeObjectURL(url);
  };

  const archiveSelection = async (): Promise<void> => {
    const ids = [...selected];
    try {
      await api.archiveCollectionRows(collectionId, ids);
      setSelected(new Set());
      setNotice(
        `${ids.length} ${ids.length === 1 ? 'entry' : 'entries'} moved to the trash, where they can be brought back.`,
      );
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    }
  };
  // How tall a row is, from the view being drawn rather than from the table: the
  // same entries can be a list in one view and an overview in another.
  const density = view ? readDensity(view) : 'normal';
  const selectColumns = columns.filter(
    (field) => field.fieldType === 'select' && optionsOf(field).length > 0,
  );

  const groupBy =
    view?.viewType === 'board'
      ? (columns.find(
          (field) => field.id === view.definition['groupByFieldId'],
        ) ?? selectColumns[0])
      : undefined;

  const addGallery = async (): Promise<void> => {
    try {
      const created = await api.addCollectionView(collectionId, { viewType: 'gallery' });
      await load();
      setViewId(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    }
  };

  const addBoard = async (fieldId: string): Promise<void> => {
    try {
      const created = await api.addCollectionView(collectionId, {
        viewType: 'board',
        definition: { groupByFieldId: fieldId },
      });
      await load();
      setViewId(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'network_error');
    }
  };


  return (
    <div className="collection">
      {error && <p className="error">{messageFor(error)}</p>}
      {notice && <p className="muted collection-notice">{notice}</p>}

      {/* Views. Shown only when there is a choice to make, so a collection with
          one table does not carry a tab bar with one tab in it. */}
      {/* Always shown now: it carries the search box, which every collection
          needs, not only one with a choice of views. */}
      <div className="collection-views" role="tablist" aria-label={t('table.views')}>
          {data.views.map((entry) => (
            <button
              key={entry.id}
              type="button"
              role="tab"
              aria-selected={entry.id === view?.id}
              className={entry.id === view?.id ? 'view-tab current' : 'view-tab'}
              onClick={() => setViewId(entry.id)}
            >
              {entry.viewType === 'board' ? <ColumnsIcon /> : <TableIcon />}
              {entry.name}
            </button>
          ))}

          <input
            className="collection-search"
            type="search"
            value={query}
            placeholder={t('table.searchPlaceholder')}
            aria-label={t('table.search')}
            onChange={(event) => setQuery(event.target.value)}
          />

          {data.canEdit && view && (
            <button
              type="button"
              className="view-tab"
              onClick={() => setEditingRules((open) => !open)}
              title={t('table.filterAndSort.title')}
            >
              <FilterIcon /> {ruleSummary(view, t)}
            </button>
          )}

          {data.canEdit && (
            <>
              {/* Undo and redo, drawn always rather than only when there is
                  something to reverse: a control that appears and disappears in
                  a toolbar is one people stop looking for. Disabled says the
                  same thing and stays in place. */}
              <button
                type="button"
                className="view-tab"
                disabled={history.undoLabel === null || history.busy}
                title={undoTitle}
                aria-label={undoTitle}
                onClick={() => void history.undo()}
              >
                <ArrowUpIcon />
              </button>
              <button
                type="button"
                className="view-tab"
                disabled={history.redoLabel === null || history.busy}
                title={redoTitle}
                aria-label={redoTitle}
                onClick={() => void history.redo()}
              >
                <ArrowDownIcon />
              </button>

              {/* Last, and only where there is something to empty. It archives
                  rather than deletes — a row is a page, so this fills the trash
                  and can be undone (ADR-0034) — and it says so rather than
                  asking "are you sure", which is dismissed by the same reflex
                  that opened it. */}
              {data.rows.length > 0 && (
                <button
                  type="button"
                  className="view-tab collection-clear"
                  disabled={history.busy}
                  title={t('table.emptyTitle')}
                  onClick={() => setClearing(true)}
                >
                  <TrashIcon /> {t('table.empty')}
                </button>
              )}
            </>
          )}

          {data.canEdit && selectColumns.length > 0 && (
            <button
              type="button"
              className="view-tab add"
              onClick={() => void addBoard(selectColumns[0]!.id)}
              title={`Group by ${selectColumns[0]!.name}`}
            >
              <PlusIcon /> {t('table.addBoard')}
            </button>
          )}
      </div>

      {/* The offer to add a gallery, where the board's offer is and on the same
          rule: only when the collection has something to draw it with (ADR-0039).
          A gallery of blank panels is not a view. */}
      {data.canEdit &&
        !data.views.some((entry) => entry.viewType === 'gallery') &&
        columns.some((field) => field.fieldType === 'files') && (
          <button
            type="button"
            className="view-tab add"
            onClick={() => void addGallery()}
            title={t('table.addGallery.title')}
          >
            <PlusIcon /> {t('table.addGallery')}
          </button>
        )}

      {editingRules && view && (
        <ViewRules
          view={view}
          fields={columns}
          onClose={() => setEditingRules(false)}
          onSave={(definition) => {
            setEditingRules(false);
            void api
              .updateCollectionView(collectionId, view.id, definition)
              .then(() => load())
              .catch((err: unknown) =>
                setError(err instanceof ApiError ? err.code : 'network_error'),
              );
          }}
        />
      )}

      {view?.viewType === 'gallery' && (
        <CollectionGallery
          rows={data.rows}
          fields={columns}
          coverFieldId={
            typeof view.definition['coverFieldId'] === 'string'
              ? view.definition['coverFieldId']
              : null
          }
          files={fileIndex}
        />
      )}

      {view?.viewType === 'board' && groupBy && (
        <CollectionBoard
          rows={data.rows}
          // Whether these are all of them: a board column counting a page is a
          // count that understates without saying so (ADR-0055).
          complete={!data.nextCursor}
          groupBy={groupBy}
          canEdit={data.canEdit}
          onSetValue={(rowId, value) => void write(rowId, groupBy.id, value)}
        />
      )}

      {view?.viewType === 'board' && !groupBy && (
        <p className="muted">
          {t('table.boardNeedsSelect')}
        </p>
      )}

      {/* What can be done with what is selected (ADR-0040).
        *
        * Above the table rather than floating over it: a bar that covers a row
        * hides the thing somebody is deciding about. It appears only when
        * something is selected, so the toolbar does not grow four buttons that
        * are usually disabled. */}
      {selected.size > 0 && (
        <div className="collection-selection" role="group" aria-label={t('table.selectedLabel')}>
          <span className="collection-selection-count">
            {t('table.selected', { count: selected.size })}
          </span>
          <button type="button" className="btn subtle" onClick={() => void copySelection()}>
            {t('table.copy')}
          </button>
          <button type="button" className="btn subtle" onClick={exportSelection}>
            {t('table.exportCsv')}
          </button>
          {data.canEdit && (
            <button
              type="button"
              className="btn subtle destructive"
              onClick={() => void archiveSelection()}
            >
              <TrashIcon /> {t('table.toTrash')}
            </button>
          )}
          <button
            type="button"
            className="btn subtle collection-selection-clear"
            onClick={() => setSelected(new Set())}
          >
            {t('table.clearSelection')}
          </button>
        </div>
      )}

      <div
        className="collection-scroll"
        hidden={
          view?.viewType === 'gallery' ||
          (view?.viewType === 'board' && groupBy !== undefined)
        }
      >
        <table className="collection-table" data-density={density}>
          <thead>
            <tr>
              {/* The title column, which cannot be removed or renamed away: it
                  is the row's own title, and a table whose entries have no name
                  is a table of anonymous records.

                  Said with a word rather than by the absence of a bin icon.
                  Every other column has one and this one does not, which reads
                  as a bug — somebody looks for the control, does not find it,
                  and concludes the interface is inconsistent rather than that
                  the column is special. */}
              {/* Selecting, always present rather than on hover: hover does not
                  exist on a touch device, and reading a table is exactly when
                  somebody wants a copy of it — so this is here for a reader
                  too. */}
              <th className="collection-select-column">
                <input
                  type="checkbox"
                  aria-label={
                    selected.size === data.rows.length && data.rows.length > 0
                      ? 'Clear the selection'
                      : 'Select every entry shown'
                  }
                  checked={selected.size > 0 && selected.size === data.rows.length}
                  // Some but not all: the box shows neither state, because
                  // neither is true.
                  ref={(box) => {
                    if (box) {
                      box.indeterminate =
                        selected.size > 0 && selected.size < data.rows.length;
                    }
                  }}
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? new Set(data.rows.map((row) => row.id))
                        : new Set(),
                    )
                  }
                />
              </th>

              <th className="collection-title-column">
                {titleField?.name ?? 'Name'}
                <span className="collection-column-fixed" title={t('table.titleColumn')}>
                  {t('table.always')}
                </span>
              </th>
              {columns.map((field) => (
                <th key={field.id}>
                  <ColumnHeader
                    field={field}
                    canEdit={data.canEdit}
                    onRename={(name) => void renameColumn(field.id, name)}
                    onRemove={() => void removeColumn(field.id)}
                    onSaveOptions={(options) => void saveOptions(field.id, options)}
                    onEditFormula={(text) => {
                      setFormulaText(text);
                      setFormulaError(null);
                      setWritingFormula(field.id);
                    }}
                    onSetAggregate={(aggregate, fieldId) =>
                      void setAggregate(field.id, aggregate, fieldId)
                    }
                    aggregatable={
                      incoming?.find(
                        (relation) => relation.fieldId === field.config?.['viaFieldId'],
                      )?.aggregatable ?? []
                    }
                  />
                </th>
              ))}
              {data.canEdit && (
                <th className="collection-add-column">
                  <button
                    type="button"
                    className="collection-add"
                    aria-label={t('table.addColumn')}
                    aria-expanded={addingColumn !== null}
                    onClick={(event) => {
                      if (addingColumn) {
                        setAddingColumn(null);
                        return;
                      }
                      // Measured from the button, because the menu is drawn
                      // against the viewport rather than inside the scroller
                      // that would clip it.
                      const box = event.currentTarget.getBoundingClientRect();
                      setAddingColumn({ x: box.left, y: box.bottom + 4 });
                    }}
                  >
                    <PlusIcon />
                  </button>
                </th>
              )}
            </tr>
          </thead>

          <tbody
            // One handler for the whole body rather than one per cell: the paste
            // has to know which cell it landed in, and that comes from the event
            // either way — while a listener per cell is a listener per row.
            onPaste={(event) => {
              if (!data.canEdit) return;
              const text = event.clipboardData.getData('text/plain');
              // A single value is left to the browser: it goes into the field
              // somebody is typing in, which is what they meant.
              if (!text || !looksLikeGrid(text)) return;

              const cell = (event.target as HTMLElement).closest<HTMLElement>('[data-column]');
              const rowElement = (event.target as HTMLElement).closest<HTMLElement>('[data-row]');
              event.preventDefault();
              void pasteGrid(
                text,
                rowElement?.dataset['row'] ?? null,
                Number(cell?.dataset['column'] ?? '0'),
              );
            }}
          >
            {data.rows.map((row) => (
              <tr
                key={row.id}
                data-row={row.id}
                data-selected={selected.has(row.id) ? 'true' : undefined}
              >
                <td className="collection-select-column">
                  <input
                    type="checkbox"
                    checked={selected.has(row.id)}
                    aria-label={`Select ${row.title || 'this entry'}`}
                    onChange={(event) =>
                      setSelected((current) => {
                        // A new set each time rather than a mutation: React
                        // compares by identity, and mutating this one would
                        // change the count without redrawing the row.
                        const next = new Set(current);
                        if (event.target.checked) next.add(row.id);
                        else next.delete(row.id);
                        return next;
                      })
                    }
                  />
                </td>

                <td className="collection-title-column" data-column="0">
                  {/* The name, edited here (ADR-0034).
                    *
                    * It was a link, and clicking it left the table — which is
                    * exactly the gesture somebody makes while filling the first
                    * column. The page is one control to the right, which is
                    * where the rarer want belongs. */}
                  <TitleCell
                    key={row.id}
                    title={row.title}
                    canEdit={data.canEdit}
                    onChange={(title) => void writeTitle(row.id, title, row.title)}
                  />
                  <a
                    className="collection-open-row"
                    href={pageLink(row.id, row.title)}
                    title={`Open ${row.title || 'this entry'}`}
                    aria-label={`Open ${row.title || 'this entry'}`}
                  >
                    <ChevronRightIcon />
                  </a>
                </td>
                {columns.map((field, at) => (
                  <td key={field.id} data-column={at + 1}>
                    <Cell
                      field={field}
                      value={row.values[field.id] ?? null}
                      derived={row.derived?.[field.id] ?? null}
                      canEdit={data.canEdit}
                      files={fileIndex}
                      pageId={row.id}
                      onChange={(value) => void write(row.id, field.id, value)}
                      onUploaded={rememberFile}
                    />
                  </td>
                ))}
                {data.canEdit && <td />}
              </tr>
            ))}

            {data.rows.length === 0 && (
              <tr>
                <td colSpan={columns.length + 3} className="muted">
                  {t('table.noEntries')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* How many rows there are, and how many are showing (ADR-0055).
        *
        * Beside the button rather than in the header: it is the answer to "is
        * there more", asked where somebody runs out of rows. Vague above ten
        * thousand, because the count is bounded in the query — a number that
        * costs a scan to be precise about is worth being vague about. */}
      {typeof data.total === 'number' && data.total > data.rows.length && (
        <p className="collection-count">
          {data.totalIsExact === false
            ? t('table.countMany', { shown: data.rows.length })
            : t('table.countOf', { shown: data.rows.length, total: data.total })}
        </p>
      )}

      {/* More rows, on a button rather than on a scroll observer (ADR-0055).
        *
        * A button, first, because it is the version that cannot go wrong: an
        * observer inside a horizontally scrolling table fires on the wrong axis
        * and loads pages nobody asked for. This says how the table behaves and
        * can grow an observer later without changing what it means. */}
      {data.nextCursor && (
        <button
          type="button"
          className="btn subtle collection-more"
          disabled={loadingMore}
          onClick={() => void loadMore()}
        >
          {loadingMore ? t('panel.loading') : t('table.more')}
        </button>
      )}

      {/* Why this view is slower than the others (ADR-0055): sorting by a
          computed column needs every row's value before the first row can be
          placed, so this one fetches the collection. Said rather than felt. */}
      {data.sortedInMemory && <p className="settings-note">{t('table.sortedWhole')}</p>}

      {/* Outside the scroller, and positioned against the viewport.
        *
        * Inside it the menu was clipped: `overflow-x: auto` clips both axes, so
        * the list of column types was cut off at the table's edge and the types
        * below the fold could neither be read nor chosen. Its own place in the
        * markup is therefore after the table rather than inside the header cell
        * it belongs to.
        *
        * Clamped so it cannot open off the right edge of the window, which is
        * the same failure in a different direction. */}
      {/* Which collection a relation points at (ADR-0054).
        *
        * A second step rather than a submenu inside the type list: the list is
        * one decision per row, and a type that quietly needs another answer
        * would be the one entry behaving differently from the other ten. */}
      {/* `dialog-scrim` and a stopped click, which is how every other dialog
          here is built. I wrote `dialog-backdrop` first — a class that exists
          nowhere, and the same invented name that once opened the export window
          at the foot of a menu. */}
      {choosingRelation && (
        <div
          className="dialog-scrim"
          role="presentation"
          onClick={() => setChoosingRelation(false)}
        >
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t('relation.chooseTarget')}
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="dialog-title">{t('relation.chooseTarget')}</h2>
            {collections === null && <p className="muted">{t('panel.loading')}</p>}
            {collections?.length === 0 && (
              <p className="muted">{t('relation.noCollections')}</p>
            )}
            <ul className="dialog-list">
              {(collections ?? []).map((one) => (
                <li key={one.id}>
                  <button
                    type="button"
                    className="dialog-item"
                    onClick={() => {
                      setChoosingRelation(false);
                      void addColumn('relation', one.id);
                    }}
                  >
                    {one.title || t('page.untitled')}
                  </button>
                </li>
              ))}
            </ul>
            <div className="dialog-actions">
              <button
                type="button"
                className="btn subtle"
                onClick={() => setChoosingRelation(false)}
              >
                {t('action.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {writingFormula !== null && (
        <div
          className="dialog-scrim"
          role="presentation"
          onClick={() => setWritingFormula(null)}
        >
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t('formula.write')}
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="dialog-title">
              {writingFormula === 'new' ? t('formula.write') : t('formula.edit')}
            </h2>
            {/* The columns by name, because a formula names them and somebody
                has to know what to type. */}
            <p className="settings-note">
              {t('formula.columns', {
                names: (data?.fields ?? [])
                  .filter((one) => one.fieldType !== 'formula')
                  .map((one) => one.name)
                  .join(', '),
              })}
            </p>
            {/* Completion, from what this collection actually has (ADR-0056).
              *
              * No syntax highlighting: this is an `input`, and colouring text
              * inside one is not possible without replacing it with a
              * contenteditable and reimplementing selection, undo and mobile
              * keyboards. A formula is one line and its errors are named in the
              * cell — the honest trade is completion, which prevents mistakes,
              * over colour, which only shows them. */}
            <input
              className="formula-input"
              autoFocus
              ref={formulaField}
              value={formulaText}
              // A key, not a literal: the guard is right that an attribute
              // somebody reads belongs in the catalogue, and an example formula
              // names columns whose names differ per workspace anyway.
              placeholder={t('formula.example')}
              aria-label={t('formula.write')}
              onChange={(event) => {
                setFormulaText(event.target.value);
                setSuggestion(0);
                setCaret(event.target.selectionStart ?? event.target.value.length);
              }}
              onKeyUp={(event) =>
                setCaret(event.currentTarget.selectionStart ?? formulaText.length)
              }
              onKeyDown={(event) => {
                const list = formulaSuggestions;

                if (list.length > 0) {
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault();
                    setSuggestion(
                      (at) =>
                        (at + (event.key === 'ArrowDown' ? 1 : list.length - 1)) % list.length,
                    );
                    return;
                  }
                  if (event.key === 'Tab' || (event.key === 'Enter' && suggestion > -1)) {
                    // Enter accepts the suggestion rather than submitting, but
                    // only while the list is open — otherwise the key that
                    // finishes a formula would depend on whether a list
                    // happened to be showing.
                    event.preventDefault();
                    const pick = list[suggestion] ?? list[0]!;
                    const next = applyCompletion(formulaText, caret, pick.value, pick.kind);
                    setFormulaText(next.text);
                    setCaret(next.caret);
                    setSuggestion(-1);
                    requestAnimationFrame(() => {
                      formulaField.current?.setSelectionRange(next.caret, next.caret);
                    });
                    return;
                  }
                  if (event.key === 'Escape') {
                    // The list first, the dialog second: one Escape that closed
                    // both would lose a formula somebody had typed because a
                    // suggestion happened to be open.
                    event.preventDefault();
                    setSuggestion(-1);
                    return;
                  }
                }

                if (event.key === 'Enter' && formulaText.trim() !== '') {
                  void addFormula(formulaText.trim());
                }
              }}
            />

            {formulaSuggestions.length > 0 && suggestion > -1 && (
              <ul className="formula-suggestions" role="listbox">
                {formulaSuggestions.map((one, at) => (
                  <li key={`${one.kind}-${one.value}`}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={at === suggestion}
                      data-active={at === suggestion ? 'true' : undefined}
                      onMouseDown={(event) => {
                        // Mouse *down*, because the field would lose focus on
                        // a click and the list would be gone before it fired.
                        event.preventDefault();
                        const next = applyCompletion(formulaText, caret, one.value, one.kind);
                        setFormulaText(next.text);
                        setCaret(next.caret);
                        setSuggestion(-1);
                        formulaField.current?.focus();
                      }}
                    >
                      {one.value}
                      {one.kind === 'function' && <span className="muted">()</span>}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {formulaError && <p className="error">{messageFor(formulaError)}</p>}
            <div className="dialog-actions">
              <button
                type="button"
                className="btn primary"
                disabled={formulaText.trim() === ''}
                onClick={() => void addFormula(formulaText.trim())}
              >
                {writingFormula === 'new' ? t('action.create') : t('action.save')}
              </button>
              <button
                type="button"
                className="btn subtle"
                onClick={() => setWritingFormula(null)}
              >
                {t('action.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {choosingRollup && (
        <div
          className="dialog-scrim"
          role="presentation"
          onClick={() => setChoosingRollup(false)}
        >
          <div
            className="dialog"
            role="dialog"
            aria-modal="true"
            aria-label={t('rollup.choose')}
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="dialog-title">{t('rollup.choose')}</h2>
            {incoming === null && <p className="muted">{t('panel.loading')}</p>}
            {/* Said plainly: a rollup cannot exist before something points here,
                and "no relations" is a more useful answer than an empty list. */}
            {incoming?.length === 0 && <p className="muted">{t('rollup.nothingPointsHere')}</p>}
            <ul className="dialog-list">
              {(incoming ?? []).map((relation) => (
                <li key={relation.fieldId}>
                  <button
                    type="button"
                    className="dialog-item"
                    onClick={() => {
                      setChoosingRollup(false);
                      // Count, because it is the one aggregate that needs no
                      // second question — the rest can be changed on the column
                      // once it exists.
                      void addRollup(relation.fieldId);
                    }}
                  >
                    {relation.fromCollection} · {relation.fieldName}
                  </button>
                </li>
              ))}
            </ul>
            <div className="dialog-actions">
              <button
                type="button"
                className="btn subtle"
                onClick={() => setChoosingRollup(false)}
              >
                {t('action.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      {addingColumn && (
        <div
          className="collection-type-menu"
          role="menu"
          style={{
            left: Math.min(addingColumn.x, Math.max(8, window.innerWidth - 180)),
            top: addingColumn.y,
          }}
        >
          {ADDABLE.map((entry) => (
            <button
              key={entry.type}
              type="button"
              role="menuitem"
              // The same item treatment every other menu here uses, rather than
              // one of its own: this menu had its own type scale and inherited
              // the page's font once it moved out of the table, so it read as
              // belonging to a different application.
              className="entry-menu-item"
              onClick={() => void addColumn(entry.type)}
            >
              <entry.Icon /> {t(entry.label)}
            </button>
          ))}
        </div>
      )}

      {clearing && (
        <div className="collection-confirm" role="alert">
          {/* No number, and that is the fix (ADR-0055).
            *
            * It said "move all {loaded} entries" while the button clears the
            * whole collection — so with paging it promised fifty and did twelve
            * thousand. The count is not known here without a second scan, so
            * the sentence names the scope instead, and the notice afterwards
            * carries the true number from the server.
            *
            * Also translated now: it was English in the JSX, which the i18n
            * guard misses because the text node has an expression in it — the
            * same hole the share dialog's heading fell through. */}
          <p>{t('table.confirmEmpty')}</p>
          <div className="settings-actions">
            <button
              type="button"
              className="btn danger"
              onClick={() => {
                setClearing(false);
                void clearRows();
              }}
            >
              {t('table.emptyConfirm')}
            </button>
            <button type="button" className="btn" onClick={() => setClearing(false)}>
              {t('table.emptyKeep')}
            </button>
          </div>
        </div>
      )}

      {data.canEdit && (
        <button
          type="button"
          className="collection-add-row"
          onClick={() => {
            // A row is created through the collection, not through the page
            // routes: it needs the collection it belongs to, and a page created
            // the ordinary way must never accidentally become one (ADR-0021).
            void api
              .addCollectionRow(collectionId)
              .then(() => load())
              .catch((err: unknown) =>
                setError(err instanceof ApiError ? err.code : 'network_error'),
              );
          }}
        >
          <PlusIcon /> {t('table.newEntry')}
        </button>
      )}
    </div>
  );
}

/**
 * A row's name, edited in place (ADR-0034).
 *
 * Committed on blur or Enter rather than as it is typed. A title is a page's
 * title — the sidebar, search and every link to it read the same value — and a
 * request per keystroke would be a rename per keystroke in all of them. Escape
 * puts back what was there, which is the only way out of a half-typed change that
 * does not require remembering the old value.
 *
 * Uncontrolled, keyed on the row by the caller, so a reload that brings back the
 * same value does not fight the caret.
 */
function TitleCell({
  title,
  canEdit,
  onChange,
}: {
  title: string;
  canEdit: boolean;
  onChange: (title: string) => void;
}): ReactElement {
  const { t } = useT();
  return (
    <input
      className="collection-title-input"
      defaultValue={title}
      readOnly={!canEdit}
      placeholder={t('table.untitled')}
      aria-label={t('table.name')}
      onBlur={(event) => {
        const next = event.currentTarget.value.trim();
        if (next !== title) onChange(next);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        else if (event.key === 'Escape') {
          event.currentTarget.value = title;
          event.currentTarget.blur();
        }
      }}
    />
  );
}

/** A column heading: rename in place, or remove. */
function ColumnHeader({
  field,
  canEdit,
  onRename,
  onRemove,
  onSaveOptions,
  onEditFormula,
  onSetAggregate,
  aggregatable,
}: {
  field: CollectionField;
  canEdit: boolean;
  onRename: (name: string) => void;
  onRemove: () => void;
  onSaveOptions: (options: EditableOption[]) => void;
  /** Open the formula editor for this column (ADR-0056). */
  onEditFormula: (text: string) => void;
  /** Change what a rollup does with what it finds (ADR-0054). */
  onSetAggregate: (aggregate: string, fieldId: string | undefined) => void;
  /** The stored fields on the other side, for an aggregate that needs one. */
  aggregatable: Array<{ id: string; name: string }>;
}): ReactElement {
  // The header had no translations of its own until the aggregate select.
  const { t } = useT();
  const [name, setName] = useState(field.name);
  /**
   * Where the option editor sits, or null when it is closed.
   *
   * A point rather than a boolean, because the panel is drawn against the
   * viewport: it was absolute inside the table's scroller, and a container with
   * `overflow-x: auto` clips the other axis too — so the panel was cut off at the
   * edge of the table and "Add option" was the last thing anybody could read.
   * Exactly the report the column menu had, in the second panel that hangs off a
   * column heading.
   */
  const [editingOptions, setEditingOptions] = useState<{ x: number; y: number } | null>(null);
  const hasOptions = field.fieldType === 'select' || field.fieldType === 'multiSelect';

  // Reset when the column changes underneath, which happens when somebody else
  // renames it. Without this the local value would win silently.
  useEffect(() => setName(field.name), [field.name]);

  if (!canEdit) {
    return (
      <span className="collection-column-name">
        {field.name}
        <span className="collection-column-type">{field.fieldType}</span>
      </span>
    );
  }

  return (
    <span className="collection-column">
      <input
        className="collection-column-input"
        value={name}
        aria-label={`Rename the ${field.name} column`}
        onChange={(event) => setName(event.target.value)}
        onBlur={() => {
          const trimmed = name.trim();
          if (trimmed && trimmed !== field.name) onRename(trimmed);
          else setName(field.name);
        }}
      />
      {/* What a rollup does with what it finds (ADR-0054).
        *
        * A select in the header rather than a dialog: the aggregate is one
        * choice from five, and the column is where somebody is looking when
        * they want to change it. The server has been able to sum, min and max
        * since the derived side was built — this is the control that reaches
        * it, and shipping the capability without one would have been a feature
        * only its author could use. */}
      {/* Editing the formula, from the column it belongs to (ADR-0056). Until
          this the column had to be removed and made again. */}
      {field.fieldType === 'formula' && canEdit && (
        <button
          type="button"
          className="collection-column-options"
          aria-label={t('formula.edit')}
          title={String(field.config?.['formula'] ?? '')}
          onClick={() => onEditFormula(String(field.config?.['formula'] ?? ''))}
        >
          <FormulaIcon />
        </button>
      )}

      {field.fieldType === 'rollup' && canEdit && (
        <>
          <select
            className="collection-column-aggregate"
            aria-label={t('rollup.aggregate')}
            value={String(field.config?.['aggregate'] ?? 'count')}
            onChange={(event) => onSetAggregate(event.target.value, undefined)}
          >
            {(['rows', 'count', 'lookup', 'sum', 'min', 'max'] as const).map((one) => (
              <option key={one} value={one}>
                {t(`rollup.${one}` as MessageKey)}
              </option>
            ))}
          </select>
          {/* Which field, for the aggregates that need one. Beside the
              aggregate rather than in a dialog: the two are one decision, and
              the server refuses the half of it that names no field. */}
          {needsField(String(field.config?.['aggregate'] ?? 'count')) && (
            <select
              className="collection-column-aggregate"
              aria-label={t('rollup.field')}
              value={String(field.config?.['fieldId'] ?? '')}
              onChange={(event) =>
                onSetAggregate(
                  String(field.config?.['aggregate'] ?? 'count'),
                  event.target.value,
                )
              }
            >
              <option value="">{t('rollup.pickField')}</option>
              {aggregatable.map((one) => (
                <option key={one.id} value={one.id}>
                  {one.name}
                </option>
              ))}
            </select>
          )}
        </>
      )}
      {hasOptions && (
        <button
          type="button"
          className="collection-column-options"
          aria-label={`Edit the options of ${field.name}`}
          onClick={(event) => {
            if (editingOptions) {
              setEditingOptions(null);
              return;
            }
            const box = event.currentTarget.getBoundingClientRect();
            setEditingOptions({ x: box.left, y: box.bottom + 4 });
          }}
        >
          <ListIcon />
        </button>
      )}
      <button
        type="button"
        className="collection-column-remove"
        aria-label={`Remove the ${field.name} column`}
        onClick={onRemove}
      >
        <TrashIcon />
      </button>

      {editingOptions && (
        <OptionEditor
          options={optionsOf(field)}
          at={editingOptions}
          onClose={() => setEditingOptions(null)}
          onSave={(options) => {
            setEditingOptions(null);
            onSaveOptions(options);
          }}
        />
      )}
    </span>
  );
}

/**
 * A field's options, defensively.
 *
 * `config` is whatever the document held, so it is checked rather than cast.
 * A malformed entry here would become an option with no id, and a cell pointing
 * at it could never be read back.
 */

/**
 * One cell.
 *
 * Each type gets the input a browser already knows how to present: a date
 * picker for dates, a checkbox for booleans, `type="url"` for links. That is
 * not only less code — a native date input is the thing people already know how
 * to use, and on a phone it brings up the right keyboard.
 */
/**
 * A cell holding files (ADR-0035).
 *
 * One column type for every kind of file, not one each for images and PDFs. The
 * file already says what it is — the server classifies every upload — so a column
 * that also declared it would be a second answer to the same question, and the
 * only thing it could add is refusing a PDF in an "image" column.
 *
 * What differs by kind is the drawing, which is where it belongs: an image is a
 * thumbnail, because that is how an image is recognised; everything else is an
 * icon and a name, because that is how a document is.
 *
 * The cell stores ids. The names and sizes come from the collection, resolved
 * once for the whole table — a file's name is the file's own fact, and a copy of
 * it in every cell is how a renamed file keeps its old name in three places.
 */
