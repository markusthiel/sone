/**
 * SONE web — one mark per kind of block.
 *
 * The `/` menu had this table and the gutter's "Turn into" list had none, so the
 * same ten blocks were pictures in one menu and a wall of words in the other. One
 * subject, one symbol — the argument the account menu already made against
 * learning two marks for one thing.
 *
 * Keyed by the `/` menu's item id, because that is what both lists have: the
 * gutter's ids are the schema's node names and they line up, except for
 * `heading`, which the gutter offers at any level while the menu offers three.
 */

import type { ReactElement } from 'react';

import {
  CalloutIcon,
  CheckSquareIcon,
  CodeIcon,
  DividerIcon,
  HashIcon,
  ImageIcon,
  ListIcon,
  LockIcon,
  OrderedListIcon,
  PaperclipIcon,
  QuoteIcon,
  TableIcon,
  TextIcon,
  ToggleIcon,
  VideoIcon,
} from './icons.tsx';

export const BLOCK_MARKS: Record<string, (props: { size?: number }) => ReactElement> = {
  paragraph: TextIcon,
  heading: HashIcon,
  'heading-1': HashIcon,
  'heading-2': HashIcon,
  'heading-3': HashIcon,
  bulletList: ListIcon,
  numberedList: OrderedListIcon,
  todo: CheckSquareIcon,
  toggle: ToggleIcon,
  quote: QuoteIcon,
  callout: CalloutIcon,
  code: CodeIcon,
  image: ImageIcon,
  video: VideoIcon,
  table: TableIcon,
  file: PaperclipIcon,
  protected: LockIcon,
  collection: TableIcon,
  divider: DividerIcon,
};
