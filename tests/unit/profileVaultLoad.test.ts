// A credentials list that never loads looks exactly like a profile with no credentials.
//
// The reported defect: the vault's entries were fetched only by `openVaultTab`, and nothing in
// the codebase ever called it — the Edit modal had no tab switcher, so the handler sat unused
// while the table rendered its "No saved credentials yet" row for every profile. The data was on
// disk the whole time; the panel said otherwise, and an operator reading that has no reason to
// doubt it.
//
// The component that now owns the panel must fetch on its own, keyed on the profile it is shown
// for. There is no DOM renderer in this suite (no jsdom), which is why the check reads the
// component's source: the omission lives in the wiring, not in any rendered output. The
// neighbouring guards (`rendererComponentMounting.test.ts`, `profileLanguage.test.ts`) exist for
// the same class of failure — a control that is present and inert.
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const VAULT_TSX = path.resolve(__dirname, '../../src/renderer/src/components/ProfileVault.tsx');
const PROFILES_TSX = path.resolve(__dirname, '../../src/renderer/src/pages/Profiles.tsx');

describe('ProfileVault actually loads the credentials it displays', () => {
  const source = fs.readFileSync(VAULT_TSX, 'utf8');

  it('calls loadVault from an effect, so entries arrive without a caller asking', () => {
    const effect = /useEffect\(\s*\(\)\s*=>\s*\{([\s\S]*?)\}\s*,\s*\[([^\]]*)\]/.exec(source);
    expect(
      effect,
      'ProfileVault has no useEffect. Without one, nothing fetches the entries and the panel ' +
        'renders its empty state for every profile — the bug this component was extracted to fix.',
    ).not.toBeNull();
    expect(
      /loadVault\s*\(/.test(effect![1]),
      'the mount effect does not call `loadVault`, so the list stays empty.',
    ).toBe(true);
    expect(
      effect![2],
      'the effect must depend on `profileId`: the modal is reused for different profiles, and ' +
        'without the dependency it would show the previously opened profile\'s entries.',
    ).toContain('profileId');
  });

  it('is rendered by the page that owns it', () => {
    // Importing a component is not the same as using it — the same silent failure the App.tsx
    // mounting guard was written for. `ProfileVault` provides the whole credentials half of the
    // Note modal, so an unused import here means the operator silently loses it.
    const page = fs.readFileSync(PROFILES_TSX, 'utf8');
    expect(
      /<ProfileVault[\s/>]/.test(page),
      'Profiles.tsx imports ProfileVault but never renders it.',
    ).toBe(true);
  });
});
