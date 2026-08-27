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
