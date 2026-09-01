/**
 * SONE web — line icons.
 *
 * Inline SVG, no dependency. An icon library is a dependency that ships
 * hundreds of icons to render a dozen, and picking one now would fix the visual
 * language of the app to somebody else's drawing conventions before there is a
 * reason to.
 *
 * Every icon here follows the same construction so they sit together: a 24×24
 * box, 1.5 stroke, `currentColor`, round caps and joins, no fills. That is what
 * makes a set look like a set — mixing a filled icon into a line set is visible
 * immediately even to someone who could not say why.
 *
 * `currentColor` rather than a colour prop: an icon inherits the colour of the
 * text it sits beside, so it stays right in dark mode, when disabled, and when
 * a folder gets a colour of its own — without any of those cases being handled
 * here.
 *
 * This is also the beginning of the icon picker. Entries will choose from
 * `ENTRY_ICONS`, so the names in it are a stored value and renaming one is a
 * migration, not a refactor.
 */

import type { ReactElement, SVGProps } from 'react';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'children'> {
  /** Rendered size in pixels. Defaults to 1em so icons scale with text. */
  size?: number | string;
  /** Accessible label. Omit for a decorative icon beside a text label. */
  label?: string;
}

/** Shared attributes. Kept in one place so the set cannot drift apart. */
function base({ size, label, ...rest }: IconProps): SVGProps<SVGSVGElement> {
  return {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: '0 0 24 24',
    width: size ?? '1em',
    height: size ?? '1em',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    // A decorative icon beside a label must be hidden from assistive
    // technology, or every entry is read out twice.
    ...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true }),
    ...rest,
  };
}

export function FolderIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7.5A1.5 1.5 0 0 1 17.5 19h-13A1.5 1.5 0 0 1 3 17.5Z" />
    </svg>
  );
}

export function FolderOpenIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v1H6.8a1.5 1.5 0 0 0-1.45 1.1L3 19Z" />
      <path d="M3 19h14.2a1.5 1.5 0 0 0 1.45-1.1L20.5 11H6.8a1.5 1.5 0 0 0-1.45 1.1Z" />
    </svg>
  );
}

export function PageIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M6 3.75h7.5L18 8.25v12H6Z" />
      <path d="M13.5 3.75v4.5H18" />
      <path d="M9 12.75h6M9 16h4" />
    </svg>
  );
}

export function SearchIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <circle cx="10.5" cy="10.5" r="6" />
      <path d="m15 15 4.5 4.5" />
    </svg>
  );
}

export function PlusIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

export function FolderPlusIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7.5A1.5 1.5 0 0 1 17.5 19h-13A1.5 1.5 0 0 1 3 17.5Z" />
      <path d="M11 13.5h4M13 11.5v4" />
    </svg>
  );
}

export function ChevronRightIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="m9.5 6 6 6-6 6" />
    </svg>
  );
}

/** A panel beside a content area, for showing and hiding a sidebar. */
export function SidebarIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M9.5 4.5v15" />
    </svg>
  );
}

/**
 * The same panel, on the other side.
 *
 * The right toggle was a chevron, which means "go" — and it was the only chevron
 * in this interface that did not go anywhere (ADR-0042). Two toggles that do the
 * same thing should be the same shape, mirrored, so the pair reads as one idea.
 */
export function PanelRightIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <path d="M14.5 4.5v15" />
    </svg>
  );
}

/*
 * Alignment, as three arrangements of lines.
 *
 * Words for these were four German labels in a row — "Automatisch", "Links",
 * "Mittig", "Rechts" — which overflowed the menu and gave it a horizontal
 * scrollbar. The shapes say the same thing in a quarter of the width, and
 * alignment is one of the few settings a picture genuinely states better than a
 * word: the icon *is* the result.
 */
export function AlignAutoIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

export function AlignLeftIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M4 7h16M4 12h9M4 17h13" />
    </svg>
  );
}

export function AlignCentreIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M4 7h16M7.5 12h9M5.5 17h13" />
    </svg>
  );
}

export function AlignRightIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M4 7h16M11 12h9M7 17h13" />
    </svg>
  );
}

/**
 * Out of a level, and into one.
 *
 * An arrow at a wall: the bar is the level's edge and the arrow is the block
 * crossing it. Distinct from the alignment marks above, which are lines of text
 * rather than an arrow — two families of icon in one menu need to be told apart
 * at a glance.
 */
export function OutdentIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M20 5.5H10M20 12H13M20 18.5H10" />
      <path d="M7 9l-3 3 3 3" />
    </svg>
  );
}

export function IndentIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M20 5.5H10M20 12H13M20 18.5H10" />
      <path d="M4 9l3 3-3 3" />
    </svg>
  );
}

/** Two of the same thing, one behind the other. */
export function DuplicateIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 4.5h-9a2 2 0 0 0-2 2v9" />
    </svg>
  );
}

/** A drag grip: two columns of dots, the conventional handle affordance. */
export function GripIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <circle cx="9.5" cy="6" r="1" />
      <circle cx="9.5" cy="12" r="1" />
      <circle cx="9.5" cy="18" r="1" />
      <circle cx="14.5" cy="6" r="1" />
      <circle cx="14.5" cy="12" r="1" />
      <circle cx="14.5" cy="18" r="1" />
    </svg>
  );
}

export function MoreIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="5.5" r="1" />
      <circle cx="12" cy="12" r="1" />
      <circle cx="12" cy="18.5" r="1" />
    </svg>
  );
}

/** An arrow into a container, for moving something somewhere else. */
export function MoveIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h7A1.5 1.5 0 0 1 19 10v7.5A1.5 1.5 0 0 1 17.5 19h-13A1.5 1.5 0 0 1 3 17.5Z" />
      <path d="M11 15.5h5M14 13l2.5 2.5L14 18" />
    </svg>
  );
}

/** Three connected nodes: the conventional share mark. */
export function ShareIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <circle cx="18" cy="5" r="2.5" />
      <circle cx="6" cy="12" r="2.5" />
      <circle cx="18" cy="19" r="2.5" />
      <path d="M8.2 10.8 15.8 6.7M8.2 13.2l7.6 4.1" />
    </svg>
  );
}

export function ArrowUpIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </svg>
  );
}

export function ArrowDownIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M12 5v14M6 13l6 6 6-6" />
    </svg>
  );
}

/** A grid, for a collection's table view. */
export function TableIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 10h18M9 10v9M15 10v9" />
    </svg>
  );
}

/** A short list, for editing a select column's options. */
export function ListIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01" />
    </svg>
  );
}

/** Vertical lanes, for a board view. */
export function ColumnsIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <rect x="3" y="4" width="5" height="16" rx="1" />
      <rect x="10" y="4" width="5" height="11" rx="1" />
      <rect x="17" y="4" width="4" height="14" rx="1" />
    </svg>
  );
}

/** A funnel, for a view's filters and sorting. */
export function FilterIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M3 5h18l-7 8v6l-4 2v-8z" />
    </svg>
  );
}

export function TrashIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M4.5 7h15M9.5 7V4.75h5V7" />
      <path d="M6.5 7v12.25h11V7" />
      <path d="M10 10.5v6M14 10.5v6" />
    </svg>
  );
}

export function PencilIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M4.5 19.5h4L20 8a2.12 2.12 0 0 0-3-3L5.5 16.5Z" />
      <path d="m15.5 6.5 3 3" />
    </svg>
  );
}

export function StarIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="m12 4.5 2.35 4.9 5.15.72-3.75 3.7.9 5.18L12 16.6l-4.6 2.4.9-5.18-3.75-3.7 5.15-.72Z" />
    </svg>
  );
}

export function TagIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M4.5 11.3V5.5a1 1 0 0 1 1-1h5.8a1 1 0 0 1 .7.3l7 7a1 1 0 0 1 0 1.4l-5.5 5.5a1 1 0 0 1-1.4 0l-7-7a1 1 0 0 1-.3-.7Z" />
      <circle cx="8.5" cy="8.5" r="1.1" />
    </svg>
  );
}

/* --- column types, for the menu that adds one ---
 *
 * A type is easier to recognise as a shape than as a word, and the menu was a
 * column of nine words in the page's own font. Same construction as the rest of
 * the set: a 24×24 box, 1.5 stroke, no fills.
 */

/** A capital sitting on a baseline, for a text column. */
export function TextIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M5 6.5h11M10.5 6.5V17" />
      <path d="M15 12.5h4M17 12.5V17" />
    </svg>
  );
}

/** A hash, for a number column. */
export function HashIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M9.5 4 8 20M16 4l-1.5 16M4.5 9h15M3.5 15h15" />
    </svg>
  );
}

/** A month, for a date column. */
export function CalendarIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="5.5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M8 3.5v4M16 3.5v4" />
    </svg>
  );
}

/** A closed box with a chevron: one of a set, chosen. */
export function SelectIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" />
      <path d="m9 10.5 3 3 3-3" />
    </svg>
  );
}

/** An envelope, for an email column. */
export function MailIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <rect x="3" y="5.5" width="18" height="13" rx="2" />
      <path d="m3.6 7 8.4 6 8.4-6" />
    </svg>
  );
}

/** A handset, for a phone column. */
export function PhoneIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M7 3.5h3l1.5 4-2 1.5a10 10 0 0 0 5 5l1.5-2 4 1.5v3a1.5 1.5 0 0 1-1.7 1.5C11.6 17.7 6.3 12.4 5.5 5.2A1.5 1.5 0 0 1 7 3.5Z" />
    </svg>
  );
}

/* --- the right panel's tabs (ADR-0016: a control that matters is drawn, not
   hidden behind hover) ---
 *
 * Seven tabs of text did not fit a 300px column; seven icons do, with the name
 * on each as its title and its accessible label. Same construction as the rest —
 * a 24×24 box, 1.5 stroke, no fills — because a set stops looking like a set the
 * moment one member is drawn differently.
 */

/** A ticked box, for the tasks in a document. */
export function CheckSquareIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="3.5" width="17" height="17" rx="2.5" />
      <path d="m8 12.2 2.8 2.8L16.5 9.3" />
    </svg>
  );
}

/** Two figures, for who has written here. */
export function UsersIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <circle cx="9" cy="8" r="3.2" />
      <path d="M3.5 19.5c0-3 2.5-4.8 5.5-4.8s5.5 1.8 5.5 4.8" />
      <path d="M16 5.2a3.2 3.2 0 0 1 0 5.6M17.5 15.2c2 .6 3 2.2 3 4.3" />
    </svg>
  );
}

/** Sliders, for a page's properties. */
export function SlidersIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M4 7h16M4 12h16M4 17h16" />
      <circle cx="9" cy="7" r="1.8" />
      <circle cx="15" cy="12" r="1.8" />
      <circle cx="8" cy="17" r="1.8" />
    </svg>
  );
}

/** A paperclip, for the files attached in a document. */
export function PaperclipIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M18.5 11.5 12 18a4 4 0 0 1-5.7-5.7l7.2-7.2a2.8 2.8 0 0 1 4 4l-7.2 7.2a1.6 1.6 0 0 1-2.2-2.2l6.4-6.4" />
    </svg>
  );
}

/** A framed picture, for the images in a document. */
export function ImageIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="2" />
      <circle cx="9" cy="9.5" r="1.6" />
      <path d="m4.5 17 4.2-4.2 3.3 3.3 2.6-2.6 4.9 4.4" />
    </svg>
  );
}

/** Two joined rings, for the links in a document. */
export function LinkIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M10.5 13.5a3.5 3.5 0 0 1 0-5l2.5-2.5a3.5 3.5 0 0 1 5 5L16 13" />
      <path d="M13.5 10.5a3.5 3.5 0 0 1 0 5L11 18a3.5 3.5 0 0 1-5-5L8 11" />
    </svg>
  );
}

/** An arrow out of a box, for a destination that is not in this document. */
export function ExternalIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M14 4.5h5.5V10" />
      <path d="M19.5 4.5 11 13" />
      <path d="M18 14.5v4A1.5 1.5 0 0 1 16.5 20h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6h4" />
    </svg>
  );
}

/**
 * Icons an entry may be given.
 *
 * The keys are a **stored value**: an entry records the name, so renaming one
 * here changes what existing entries point at. Adding is free; renaming and
 * removing are migrations.
 *
 * Deliberately small for now. A picker with six hundred icons and no
 * organisation is harder to use than one with twenty, and the set should grow
 * from what people actually reach for rather than from what a library ships.
 */
export const ENTRY_ICONS = {
  folder: FolderIcon,
  page: PageIcon,
  star: StarIcon,
  tag: TagIcon,
} as const;

export type EntryIconName = keyof typeof ENTRY_ICONS;

export const isEntryIconName = (value: unknown): value is EntryIconName =>
  typeof value === 'string' && value in ENTRY_ICONS;

/**
 * Settings and signing out. Fixed parts of the interface, not entry icons —
 * these must not change when somebody picks a new folder icon.
 *
 * Drawn with `base()` like the rest of the set, which they were not: they had a
 * 16-unit box, a 1.3 stroke, and — the part that mattered — **no width or
 * height**, so they filled whatever they were put in. In the sidebar a stylesheet
 * happened to size them; the moment one was used in the settings switcher, where
 * no rule named it, it came out as a sun the width of the column.
 *
 * A member of a set drawn differently from the set is a trap for whoever uses it
 * next, and this one was.
 */
export function SettingsIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.5v2.6M12 18.9v2.6M21.5 12h-2.6M5.1 12H2.5M18.7 5.3l-1.9 1.9M7.2 16.8l-1.9 1.9M18.7 18.7l-1.9-1.9M7.2 7.2 5.3 5.3" />
    </svg>
  );
}

export function SignOutIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M9.3 3.5H5A1.5 1.5 0 0 0 3.5 5v14A1.5 1.5 0 0 0 5 20.5h4.3" />
      <path d="M15.9 7.8 20.1 12l-4.2 4.2M20.1 12H9.6" />
    </svg>
  );
}

/* --- marks for the block menu (the `/` list) ---
 *
 * Drawn here with the rest of the set rather than picked from the entry icons:
 * these name kinds of block, which are fixed, and an entry icon is whatever
 * somebody chose. The two must not be able to drift into each other.
 */

/** A numbered list. The digits are the whole point, so they are drawn. */
export function OrderedListIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M10 6h11M10 12h11M10 18h11" />
      <path d="M4 5.5 5.2 5v3.2M3.4 15.2c0-.7.6-1.2 1.3-1.2.6 0 1.1.4 1.1 1 0 .5-.4.9-.8 1.2L3.4 18h2.6" />
    </svg>
  );
}

/** A quotation: a bar and the text beside it, which is how one is drawn. */
export function QuoteIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M4.5 5v14" />
      <path d="M9 8h11M9 12h11M9 16h7" />
    </svg>
  );
}

/** A callout: something set aside and pointed at. */
export function CalloutIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <rect x="3" y="4" width="18" height="13" rx="2" />
      <path d="M8 21l3-4M12 8v4M12 14.5h.01" />
    </svg>
  );
}

/** Code: the two brackets everybody reads as code. */
export function CodeIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M9 7l-5 5 5 5M15 7l5 5-5 5" />
    </svg>
  );
}

/** A toggle: a disclosure arrow with a line of text. */
export function ToggleIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M5 8l4 4-4 4" />
      <path d="M12 6h9M12 12h9M12 18h9" />
    </svg>
  );
}

/**
 * One person, for "you".
 *
 * Distinct from `UsersIcon`, which is several: "your settings" and "the people in
 * this workspace" are different subjects, and one mark for both would be the
 * interface saying they are the same.
 */
export function PersonIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="8" r="3.6" />
      <path d="M4.8 20.2a7.2 7.2 0 0 1 14.4 0" />
    </svg>
  );
}

/** A video: a screen with a play mark in it. */
export function VideoIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M11 9.5l4 2.5-4 2.5z" />
    </svg>
  );
}

/** A protected section: a page with a lock. */
export function LockIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2" />
    </svg>
  );
}

/** A divider: the rule itself. */
export function DividerIcon(props: IconProps): ReactElement {
  return (
    <svg {...base(props)}>
      <path d="M3 12h18" />
      <path d="M6 7h12M6 17h12" opacity="0.4" />
    </svg>
  );
}
