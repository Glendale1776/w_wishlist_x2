# Codex Working Agreement

## Scope
- This file defines source-of-truth order, routing, and workflow for Codex in this repo.
- Keep changes scoped to active planning docs and active slice files only.

## Slice Storage Model
- Pending slices live in `docs/slices/pending/`.
- Done slices live in `docs/slices/done/`.
- Slice filenames MUST be: `S-<NN>__<topicToken>.md` (example: `S-07__brief3.md`).
- `topicToken` = Active brief basename (`brief3.md` -> `brief3`; `brief.md` -> `brief`).

## Active Topic Routing
- Active brief = highest `docs/briefN.md` else `docs/brief.md`.
- Active topic id = Active brief filename (example: `brief3.md`).
- Active topic token = basename without `.md` (example: `brief3`).
- Active slice selection (no scanning):
- List `docs/slices/pending/` filenames.
- Consider ONLY files matching `S-XX__<activeTopicToken>.md`.
- Active slice = lowest numeric `XX` among those matches.
- Do not open done slices; do not open other-topic pending slices.

## Source Of Truth Order
- Active brief > `docs/technical.md` > `docs/design.md` > active slice > `docs/{scope,routes,ui_ux,acceptance,data_model}.md`.
- Open questions = `docs/open_questions.md` (proposed answers) and `docs/questions.md` (open index).
- Refs index = `docs/refs.md`; open referenced files only when Active brief lists their Ref IDs.

## What To Ignore
- Do not scan `docs/locks` history; read latest lock only (if needed).
- Do not scan `docs/_archive/**` unless explicitly referenced by Ref ID.
- Do not open done slices unless explicitly referenced by the Active slice or Active brief.

## Workflow
- `plain_brief.md` usage:
- First run creates global `docs/brief.md`.
- After that, `plain_brief.md` is feature-delta only.
- Never put process notes in `plain_brief.md`.
- Planning:
- Run Prompt 2 to write active-topic specs + create new slices for the active brief (in pending/).
- Implementation:
- Run Prompt 3; implement exactly one slice (active slice) then stop; move slice file pending -> done.
- Git:
- `main` only; no branches.
- Drift fix:
- Commit code -> write lock -> amend commit (`lock sha == HEAD`).
- Expected manual edits (never block):
- After Prompt 1, user may update Active brief `Decisions` and may empty `docs/open_questions.md`.
- After Prompt 2, user may answer `docs/questions.md` and may update Active brief `Decisions`.
- Treat current on-disk planning docs as source of truth; do not ask to restore prior versions.
- Repo hygiene (noise must never block):
- Ensure `.gitignore` covers: `.DS_Store`, `**/.DS_Store`, `docs/drift/`.
- These are never staged/committed.
- If any are tracked in git, remove from index and delete locally.

## Checks
- `npm run typecheck`
- `npm run build`
