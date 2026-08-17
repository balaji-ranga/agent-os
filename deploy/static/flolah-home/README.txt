FLOLAH MARKETING HOMEPAGE

Served at https://flolah.cloud (apex) via deploy/nginx configs.
App / login SPA is served at https://login.flolah.cloud.

Source pack: flolah-existing-design-updated.zip

Pages:
  / or /index.html  — marketing homepage
  /vision or /vision.html — vision subpage
  /docs/            — public Docusaurus user guide (open access; built from docs-site/)
  /legal/           — Terms, Privacy, Cookies, Open source

"Start with Flolah" CTA → https://login.flolah.cloud
"Docs" nav → /docs/
"Vision" nav / "Our vision" → vision.html

"Start with Flolah" CTA → https://login.flolah.cloud
"Vision" nav / "Our vision" → vision.html

Files live under deploy/static/flolah-home and are mounted into the
nginx container at /usr/share/nginx/flolah-home.
