# Evidence: Pankosmia serves TW + TWL as ONE combined burrito (OPEN-QUESTIONS #29)

**Date:** 2026-07-31 · **Method:** shallow read-only clones of `github.com/pankosmia`
repos + live DCS API. Owner reported the combination 2026-07-31; this record verifies it.

## The verified chain

1. **The consumer** — `pankosmia/uw-client-checks` (cloned at HEAD, 2026-07-31):
   - `src/js/CreateBookProject/RessourcesPicker.jsx` offers ONE slot per flavor;
     `translationWords` selects a single `parascriptural/x-bcvarticles` burrito.
   - `src/js/creatProject.jsx` (`generateHelperForTool`, ~line 907): derives the tW check
     list from `<BOOK>.tsv` **in that one burrito** — columns are the TWL schema
     (Reference, ID, Tags, OrigWords, Occurrence, TWLink).
   - `src/js/checkerUtils.jsx` (`getglTwData`, ~line 193): reads the tW article markdown
     from `payload/kt|names|other/*.md` **in the same repo**, then reads the same
     `<BOOK>.tsv` to filter articles. One repo supplies both halves.
2. **The source org** — `pankosmia/desktop-app-tc4`
   `globalBuildResources/product_resources/core-client-remote-repos/organizations/organization.json`
   points the remote-repos client at `git.door43.org/uw` (plus `unfoldingword`, `shower`).
3. **The artifact** — `git.door43.org/uw/en_tw` [VERIFIED — DCS API 2026-07-31]:
   - Description: "unfoldingWord Translation Words **and** Translation Word Links in
     Scripture Burrito format".
   - Flavor `parascriptural/x-bcvarticles`. 1008 ingredients = **45 per-book TWL TSVs**
     (`ingredients/<BOOK>.tsv`) + **963 tw articles**
     (`ingredients/payload/kt|names|other/<slug>.md`).
   - **0 releases, 0 tags**; default branch `master`; last updated 2026-06-18.
4. **Contrast — the plain RC export**: the DCS sb-zip of `unfoldingWord/en_twl` v86
   contains ONLY `ingredients/<BOOK>.tsv` (no articles), and `unfoldingWord/en_tw` is
   articles-only. The combination exists only in the `uw` org's prepared burritos.

## What this means (recorded, not decided)

- The owner's statement is **[VERIFIED]**: Pankosmia's content channel (`git.door43.org/uw`)
  serves TW+TWL as one `x-bcvarticles` burrito, and the Pankosmia checking client is built
  against exactly that shape.
- The §5.3 two-slot pin (`translationWords` + `translationWordsLinks`) can represent the
  combined form: both slots MAY name the same repo at the same version. The slots record
  which data each tool input came from; they do not require two repos.
- **New wrinkle for Increment-2 fetch code:** `uw/*` repos carry **no tags and no releases**,
  so the D23(b) pin form (repoPath + release tag + SHA from the sb-zip export) cannot target
  them today. Options to raise upstream (owner-routed): pin a commit SHA on `uw/*`, ask for tagged
  releases there, or keep fetching from the `unfoldingWord/*` RC repos via sb-zip and accept
  the two-repo form. Caution (memory: prototype-code-is-not-platform-surface):
  `uw-client-checks` is companion-prototype code — treat its consumption shape as evidence
  of the content channel's layout, not as a constraint tC4 must copy.
