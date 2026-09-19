/**
 * Sidebar helpers.
 *
 * This module used to own the collapse/expand feature — the stored preference, the Ctrl+B
 * shortcut matcher and the badge placement that differed between the full and rail layouts.
 * The operator removed that feature: the sidebar is a fixed 240px column like the reference
 * product, so there is no collapsed state to reason about and nothing to persist.
 */

export function computeRunningCount(profiles: Array<{ status?: string | null }> | null | undefined): number {
  if (!Array.isArray(profiles)) return 0;
  return profiles.reduce((acc, p) => (p?.status === 'running' ? acc + 1 : acc), 0);
}
