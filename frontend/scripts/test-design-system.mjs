import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync(new URL('../src/App.jsx', import.meta.url), 'utf8');
const main = readFileSync(new URL('../src/main.jsx', import.meta.url), 'utf8');
const profile = readFileSync(new URL('../src/pages/UserProfile.jsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../src/index.css', import.meta.url), 'utf8');
const immersiveNavigation = readFileSync(
  new URL('../src/components/ImmersiveNavigation.jsx', import.meta.url),
  'utf8'
);

assert.match(main, /<DesignSystemProvider>/, 'design system must follow authenticated profile state');
assert.match(profile, /<DesignSystemPicker\s*\/>/, 'profile must expose the design switch');
assert.match(app, /design-\$\{designSystem\}/, 'the shared shell must select the profile design');
assert.match(styles, /\.design-immersive\s/, 'immersive styling must be explicitly scoped');
assert.match(
  styles,
  /html\[data-design-system="immersive"\]/,
  'immersive must own its dark spatial palette instead of inheriting Classic theme geometry'
);
assert.match(
  immersiveNavigation,
  /PRIMARY_ORDER = \['home', 'this-week', 'work', 'objectives', 'agent-actions', 'company-reviews'\]/,
  'immersive must preserve the approved six-space primary rail order'
);
assert.match(
  immersiveNavigation,
  /Search all capabilities/,
  'all non-primary features must remain available through the searchable capability launcher'
);
assert.match(
  app,
  /isImmersive \? \([\s\S]*?<ImmersivePrimaryNavigation/,
  'the new rail must be selected only for Immersive profiles'
);
assert.match(
  app,
  /<CeoNavMenu collapsed=\{menuCollapsed\} \/>/,
  'Classic must retain the existing full navigation component'
);
assert.match(
  app,
  /immersive-top-actions[\s\S]*?<ProfileMenu user=\{user\} logout=\{logout\} \/>/,
  'Immersive must retain direct access to the account and profile menu'
);
assert.match(
  styles,
  /@media \(max-width: 900px\)[\s\S]*?\.design-immersive:not\(\.shell-focus-mode\) > \.app-nav\s*\{[\s\S]*?position:\s*fixed;[\s\S]*?height:\s*100dvh;/,
  'the immersive mobile rail must stay out of the shell flex flow'
);
assert.match(
  styles,
  /@media \(max-width: 640px\)[\s\S]*?\.design-immersive \.app-mobile-topbar \.global-search-compact\s*\{\s*display:\s*none;/,
  'narrow immersive headers must preserve direct access to the account menu'
);
assert.doesNotMatch(
  styles,
  /\.design-classic\s[^,{]*[{,]/,
  'Classic must remain the existing unmodified design rather than a replacement stylesheet'
);

console.log('design-system checks passed.');
