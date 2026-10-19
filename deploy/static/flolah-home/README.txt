FLOLAH MARKETING HOMEPAGE

Served at https://flolah.cloud (apex) via deploy/nginx configs.
App / login SPA is served at https://login.flolah.cloud.

Source pack: flolah-existing-design-updated.zip

Pages:
  / or /index.html  — marketing homepage
  /vision or /vision.html — vision subpage
  /docs/            — public Docusaurus user guide (open access; built from docs-site/)
  /blog/            — public blog (docs-site/blog/)
  /blog/forum/      — discussion forum hub → GitHub Discussions
  /legal/           — Terms, Privacy, Cookies, Open source

"Start with Flolah" CTA → https://login.flolah.cloud
"Docs" nav → /docs/
"Blog" nav → /blog/
"Vision" nav / "Our vision" → vision.html

"Start with Flolah" CTA → https://login.flolah.cloud
"Vision" nav / "Our vision" → vision.html

Files live under deploy/static/flolah-home and are mounted into the
nginx container at /usr/share/nginx/flolah-home.

Mobile navigation:
  Home and Vision use a native Menu disclosure at widths up to 1100px.
  Docs, Vision and Free Tools remain available, with 44px touch targets.
  assets/site-navigation.css shares the responsive layout; site-navigation.js
  adds Escape/outside-click/link dismissal and clears the menu on desktop resize.
  Opening and following menu links also works with JavaScript disabled.

Browser regression (with Playwright installed, or STATIC_NAV_PLAYWRIGHT_PATH set
to an existing Playwright index.mjs):
  node scripts/test-static-mobile-navigation.mjs
  Covers Home/Vision, 320–1440px, keyboard, navigation and no-JavaScript use.
