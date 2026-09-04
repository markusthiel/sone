/**
 * SONE web — the instance everybody shares (ADR-0032).
 *
 * One of three areas, and the only one that is absent rather than disabled for
 * somebody without the right: a menu entry that answers "not found" teaches
 * people to distrust the menu (ADR-0027).
 *
 * Two rights, not one. Instance administration is one; administering every
 * workspace is another, which an instance administrator has implicitly and
 * somebody granted it has without being one. The section list is filtered by
 * both, in one place, so a section cannot be missing from the navigation and
 * still reachable.
 *
 * The right is confirmed by asking the server rather than trusting the session:
 * the server answers 404 to anybody who may not, so a failure means "no". While
 * the answer is unknown nothing is rendered — a section shown speculatively
 * would fail with an error that looks like a bug.
 */

import { useState, type ReactElement } from 'react';

import { api, type SessionInfo, type WorkspaceIcon } from '../api/client.ts';
import { paths } from '../routes/paths.ts';
import {
  InstancePanel,
  MaintenancePanel,
  UsersPanel,
  useIsInstanceAdmin,
  MailPanel,
} from './Admin.tsx';
import { InvitePanel } from './InvitePanel.tsx';
import { OidcPanel } from './OidcPanel.tsx';
import type { MessageKey } from '../i18n/messages.en.ts';
import { useT } from '../i18n/useT.tsx';
import { resolveSection, type ShellSection } from './SectionNav.tsx';

/**
 * A section, before it is translated.
 *
 * `label` and `hint` are message keys rather than sentences, so they are typed as
 * such: the list is module-level — the rights filter needs it before anything
 * renders — and the component translates them where it hands them over
 * (ADR-0041).
 */
interface AdminSection extends Omit<ShellSection, 'label' | 'hint'> {
  label: MessageKey;
  hint: MessageKey;
  /** Instance administration. Absent without it. */
  admin?: true;
  /** The narrower right to administer every workspace (ADR-0027). */
  manager?: true;
}

export const ADMIN_SECTIONS: readonly AdminSection[] = [
  { id: 'instance', label: 'admin.instance', hint: 'admin.instance.hint', admin: true },
  { id: 'accounts', label: 'admin.accounts', hint: 'admin.accounts.hint', admin: true },
  {
    id: 'invite',
    label: 'admin.invitations',
    // Named against the other invitation rather than "Invite people", which is
    // also the name of inviting somebody to a workspace.
    hint: 'admin.invitations.hint',
    admin: true,
  },
  {
    id: 'sso',
    label: 'admin.sso',
    hint: 'admin.sso.hint',
    admin: true,
  },
  {
    /*
     * Its own area, not a heading inside the instance settings (ADR-0058).
     *
     * It had grown to six SMTP fields, four IMAP fields and a test button under
     * a heading about who may sign up. A subject that fills a screen is a
     * section — and an operator looking for "why is mail not working" should
     * find a place called Mail rather than scroll past sign-up policy.
     */
    id: 'mail',
    label: 'admin.mail',
    hint: 'admin.mail.section.hint',
    admin: true,
  },
  { id: 'maintenance', label: 'admin.maintenance', hint: 'admin.maintenance.hint', admin: true },
];

interface AdminScreenProps {
  section: string;
  session: SessionInfo;
  workspaceId: string;
  onClose: () => void;
  /** Signing out, which the account menu at the foot of the column offers. */
  onLogout: () => void;
}

export function AdminScreen({
  section,
  session,
  workspaceId,
  onClose,
  onLogout,
}: AdminScreenProps): ReactElement | null {
  const { t } = useT();
  const { isAdmin } = useIsInstanceAdmin();
  /*
   * Every section here is the instance now (ADR-0067 amendment).
   *
   * The workspaces section is gone, and with it the only one that answered to
   * the workspace-management right rather than to being an instance
   * administrator. Workspaces are not instance settings — they have their own
   * area, which everybody reaches.
   */
  const available = ADMIN_SECTIONS.filter((entry) => {
    if (entry.admin) return isAdmin === true;
    return true;
  });

  // Nothing to administer, or the answer has not arrived yet. Both render
  // nothing rather than an empty frame that would flash a heading and a list
  // with no entries.
  if (available.length === 0) return null;

  const current = resolveSection(available, section);

  return (
    <div className="settings-body">
      <h1 className="page-title">{t(available.find((e) => e.id === current)?.label ?? 'area.instance')}</h1>
      {current === 'instance' && <InstancePanel />}
      {current === 'accounts' && <UsersPanel />}
      {current === 'invite' && <InvitePanel />}
      {current === 'sso' && <OidcPanel />}
      {current === 'mail' && <MailPanel />}
      {current === 'maintenance' && <MaintenancePanel />}
    </div>
  );
}
