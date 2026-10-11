# Focused skills catalog release

Normal clean-checkout builds use the existing backend/frontend Dockerfiles;
the backend image includes `skills-catalog/`. For a VPS with accumulated source
overlays, use the focused Skills Dockerfiles rather than copying the whole repo.

1. Capture immutable running backend/frontend image IDs and rollback tags.
   Compare every overlaid backend file with its tested Git baseline. Reconcile
   differences before building; never overwrite unrelated running changes.
2. Prepare a release directory separate from the active checkout. Include only
   the backend overlay explicitly listed in `backend.skills-catalog.Dockerfile`.
   Prepare frontend source from the deployed source without `.env`, `node_modules`
   or `dist`, preserving all unrelated files. Apply only the Skills changes to
   `App.jsx`, `api.js`, navigation, `AgentWorkspace.jsx` and `AdminSkills.jsx`.
   Check shared-file baselines and inspect the final reconciled diff.
3. Build both images with captured immutable `BASE_IMAGE` values and a
   `RELEASE_REVISION` label. Run the backend image with **no production mounts**:
   `REQUIRE_SYMLINK_TEST=1 npm run test:platform-skill-catalog`.
   Run existing agent-skills, slash-command, steering and focused router/planner
   regression gates. The frontend build includes chat rendering regression gates.
4. Take a permission-restricted online SQLite backup on the VPS. Preserve the
   operator's compose files, env and mandatory client-IP/antivirus overlays.
   Use an image-only override and recreate only backend/frontend with `--no-deps`.
   Do not restart OpenClaw, bridges, databases or unrelated company services.
5. Verify container health and public routing, actual Admin/CEO API authorization,
   global published visibility, company-private isolation and draft exclusion.
   Use disposable synthetic fixtures; delete their exact rows/sessions afterward.
   Verify the logged-in employee Skills UI without changing employee assignments.
6. Record release context, image IDs, test evidence and rollback instructions.
   If cutover health fails, restore the captured backend/frontend image IDs using
   the same compose configuration. Additive schema columns are backward compatible;
   do not restore a database backup over ongoing company writes.

Admin publication does not assign a skill, grant a tool, install dependencies,
change trading settings or execute imported instructions. The starter catalog
contains 30 native published procedures and 20 licensed upstream review drafts.
