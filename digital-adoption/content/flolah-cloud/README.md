# FloAssist website-copilot context

These are Flolah website content assets, not rules in the generic copilot.

- `floassist-onboarding.txt`: approved public onboarding knowledge, including app connections, preferences, autonomy, WhatsApp linking and support boundaries.
- `floassist-map.json`: one page, three forms and 17 eligible field descriptions. `reviewed` stays false in the downloadable artifact so an authenticated owner must review it during import. Codes, legal consent, QR data and visitor values are excluded. Native time controls require manual website entry where unsupported by the generic inspector.

## Publish or update

1. Sign in to Digital Adoption website management and select the installation used by **https://flolah.cloud**. Same hostname registrations can have separate indexes: select the registration used by the deployed snippet. Do not upload to the loopback fixture or another domain.
2. Knowledge → Upload documents & recordings: upload the text file with title **FloAssist — onboarding, connected apps and WhatsApp setup** and acknowledge website-wide sharing. Wait for **Ready**. When replacing this version, publish and verify the new source before removing the previous one; avoid duplicate uploads.
3. Website map → Optional reviewed source hints: export/back up any existing source hints first. Merge the FloAssist page by exact path while preserving unrelated source pages and owner descriptions. Import the reviewed result. Observed maps remain separate. On 25 October the active isolated Flolah registration had no existing source hints, so the standalone map could be imported safely.
4. Ship the FloAssist `index.html` and `app.js` through the normal static-site deployment. The page reuses the existing opt-in website installation and expiry; it does not issue a token, enable new permissions or change Action Policies. For a scoped live update, bundle these two assets under `assets/`, their reviewed preimage SHA-256 values in `preimages.json`, and run `deploy/publish-floassist-context.py BUNDLE STATIC_FLOASSIST_DIRECTORY`. The publisher rejects concurrent changes and retains rollback files.
5. Visit `/free-tools/floassist/?digitalAdoptionPreview=1` with a currently authorized installation. Ask what FloAssist is, why it needs two WhatsApp numbers, and how to connect apps. In Guide / Prepare, supply synthetic contact values and request review without submitting. Authenticate on the website personally to expose later stages. Never put verification codes in the copilot or shared sources.

The imported map is advisory; only fresh DOM observations supply executable field references. Forms hidden behind verification are described, not made executable by the map. OAuth consent, authentication, QR scanning and real activation require user-controlled acceptance and separate outcomes. No onboarding Save/action binding is added by this bundle.

## Verification

`node --test test/floassist-content.test.mjs test/source-map.test.mjs test/source-map-context.test.mjs` checks import validation, domain/audience isolation and propagation of field/form meanings into the planner request. The planner transport in this suite is synthetic, not a real-model quality measurement.

`npm run test:floassist:browser` from `backend/` covers real Chrome/HTTP onboarding with synthetic providers and the actual generic DOM inspector. Its production loader request is stubbed; it does not enroll a real user, accept real terms, grant OAuth access or link WhatsApp.

The existing website remains domain agnostic. Future FloAssist field/catalog changes should update this content and the browser coverage check together. Public preview renewal is independent from knowledge publication.
