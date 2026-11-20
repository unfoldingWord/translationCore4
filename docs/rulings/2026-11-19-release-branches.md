# Ruling: a release goes out from its release branch

- Asked: 2026-11-19, in #1039. The first patch release (v4.1.1, #1055) needs a branch that takes
  fixes while `main` moves on. The JavaScript tC4 had the owner's branch rules since 2026-10-13
  (`git show 24188928:docs/PACKAGING.md`, "Branch rules", marked "[decided 2026-10-13 — owner]").
  No document here recorded them, and a pull request to a release branch could not merge.
- Answered:
  - Rules 1 to 5 are the owner's rules of 2026-10-13. #1039 records that the owner applied them
    to this repository on 2026-11-13.
  - The owner chose rules 6 to 8 on 2026-11-19, in the session that worked #1039. Each was put
    as a choice; the choice taken is named under the rule.

## The rules

1. **One branch for each minor release**, named `release/<major>.<minor>`. A release branch
   gets fixes only, never a feature.
2. **`main` first.** All work merges to `main` through the merge queue. `main` does not wait
   for a release. To put a fix in a release, merge it to `main`. Then open a pull request to the
   release branch that holds `git cherry-pick -x <commit>`. If a fix cannot apply to `main`,
   write it on the release branch and give the reason in the pull request.
3. **The tag goes on the release branch.** Each `vX.Y.Z` is tagged on its release branch. The
   installers are built from that tag.
4. **A ruleset protects every `release/*` branch:** a pull request with one approval and the
   required checks, no force push, no delete. A release branch has no merge queue.
5. **Picks to a release branch stop** when the next minor release ships.
6. **The cut.** At the cut date of an `X.Y.0` release, `release/X.Y` is cut from a commit of
   `main` whose checks are green. `vX.Y.0` is tagged on the branch, as every patch is. From the
   cut on, `main` takes the next minor's work.
   - The choice: "Branch first", not "Tag on main first" (the tag on `main`, then the branch cut
     from that tag, as #1039 first described it).
   - One exception: `v4.1.0` was tagged on `main` (df81beca) on 2026-11-16, before `release/4.1`
     existed.
7. **Who cuts.** Only the release managers may create a `release/*` branch. They are the people
   whom the `release tags` ruleset lets push `v*` tags.
   - The choice: "Release managers", not the owner alone, the repository admins, or anyone with
     write access.
8. **Signing.** The `windows-signing` environment allows the default branch, `release/*`
   branches and `v*` tags. Each signed build waits until one release manager approves it. That
   person can be the one who started the build. A manual signed run of `release` works on a
   release branch as on the default branch, so signing can be tried there before the tag.
   - The choice: "One click", not "No approval step".
   - The owner, on a list of several reviewers: "We don't have the personel to have multiple
     reviewers for a release." So one approval by one person is all that a signed build needs.

## What follows from the rules

The session that worked #1039 read these from the rules and showed them to the owner on
2026-11-19. They are that session's decisions, not the owner's words. One came later:
`release-base` answers a gap that an independent review of the change found, and the owner
agreed to its ruleset change on 2026-11-20.

- **The required checks** of rule 4 are the checks that `main` requires (`AGENTS.md` "How work
  lands"), reported by GitHub Actions. A pull request to a release branch runs them itself. It
  must be up to date with the release branch before it merges, because no merge queue tests it
  on the branch's tip.
- **A push to a release branch** (the cut, or a merged fix) runs the same checks again, so the
  commit to tag has runs of its own.
- **One more required check, `release-base`.** On a pull request to `main` the full checks are
  skipped, and GitHub counts a skipped job as passed. GitHub runs nothing when the base of a
  pull request changes. So a pull request opened against `main` and then pointed at a release
  branch would pass with no test run. `release-base` is reported only by a run that started for
  a `release/*` base, so that pull request cannot merge until its checks run again. A new
  branch's first commit cannot carry the check, so the ruleset does not ask for the checks when
  a branch is created.
- **Rule 7 is a ruleset of its own** ("release branch creation": one rule, restrict creation,
  with the release managers as its bypass). A bypass covers every rule of its ruleset, so on the
  "release branches" ruleset it would also let them skip the pull request and the checks.
- **The version of a patch** is the rule 2 case "cannot apply to `main`": its pull request goes
  to the release branch. When `release/X.Y` is cut, a pull request sets `main` to the next
  minor's version, so a build of `main` never carries the number of a version that shipped.
- **`release/4.0` is closed** (rule 5): 4.1.0 shipped on 2026-11-16.

## Effect for translators

None directly. A fix reaches translators in a patch release while work on the next version goes
on. A patch holds only its fixes, never unfinished work from `main`.

## Unblocks and changes

- **Unblocks:** #1055 (Release v4.1.1).
- **Documents:** `docs/RELEASE.md` ("Release branches", "Cutting a release", "Signing"),
  `.github/ISSUE_TEMPLATE/release.md`, `AGENTS.md` ("How work lands"), `CONTRIBUTING.md`
  (step 8) and `docs/GLOSSARY.md` ("Pull request", "Required checks").
- **Not decided:** where a `-preview` tag goes when it is wanted before the cut. Rule 3 as
  written puts every tag on the release branch.
- **Workflows:** `ci`, `app-e2e` and `shell` run their full jobs for a pull request to
  `release/*` and for a push to it. `release-base` is new. `release` signs a manual run on a
  `release/*` branch. `scripts/tools/gates-sync.test.mjs` holds
  INV-RELEASE-BRANCH-RUNS-THE-FULL-CHECKS and
  INV-RELEASE-BASE-IS-REPORTED-ONLY-FOR-A-RELEASE-BASE.
- **Repository settings:** the "release branches" ruleset names the checks of `main` and
  `release-base` in place of `verify`, which no workflow here reports. The "release branch
  creation" ruleset is new. The `windows-signing` environment gets its required reviewers.
