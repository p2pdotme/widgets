# Widgets release pipeline - design spec

- Repo: github.com/p2pdotme/widgets (public)
- Package: `@p2pdotme/widgets` (npm, public scope)
- Date: 2026-06-09
- Branch: `ci/release-on-tag`
- Status: design approved, pending spec review (revised from the earlier manual tag-driven draft)

## 1. Goal

Make a release a single deliberate act: merge release-please's "release PR". That one merge bumps
the version, writes the changelog, tags the commit, creates the GitHub Release, and publishes to npm,
keyless via OIDC with provenance. No manual `npm publish`, no manual tagging, no long-lived npm token.

## 2. Current state and the gap this closes

The version channels have drifted because publishing is manual (observed 2026-06-09, `main` @ `225c2a7`):

| Channel         | State                                                          |
|-----------------|---------------------------------------------------------------|
| npm versions    | 1.0.0, 1.1.0, 1.1.1-bridge, 1.1.2, 1.1.3, 1.2.0, 1.2.1        |
| git tags        | v1.0.0, v1.1.0, v1.1.1-bridge, v1.1.2, v1.2.1                  |
| CHANGELOG       | 1.2.1, 1.2.0, 1.1.2, 1.1.0, 1.0.0, 0.1.0                       |
| GitHub Releases | none                                                          |

- `1.1.3` and `1.2.0` were published with no git tag.
- `1.1.3` was never written into `CHANGELOG.md`.
- Zero GitHub Releases despite five tags and seven npm versions.

release-please removes the drift by making one tool own version, changelog, tag, and release together.
The commit history already uses Conventional Commits (`feat(checkout): ...`, `fix(support-widget): ...`,
`chore(release): ...`), so release-please works with no change to how the team commits.

The existing `.github/workflows/ci.yml` (verify on push/PR to `main`) stays as the PR gate, untouched.

## 3. Decisions (locked)

| #  | Decision | Rationale |
|----|----------|-----------|
| D1 | npm auth = **OIDC trusted publishing** (keyless) | No stored secret, automatic provenance, npm's best practice for public repos. Nothing to rotate. |
| D2 | One-time trust registration via the **`npm trust` CLI**, email OTP supplied by user | Scriptable path; account 2FA is email-based, so the single interactive step is easy. |
| D3 | **release-please** drives version bump + `CHANGELOG.md` + tag + GitHub Release | Commits are already conventional; one tool does bump, changelog, and release. Chosen over changesets (which needs per-PR changeset files, a new habit with no payoff for a single package). |
| D4 | Publish wired as a **gated job in the same workflow** (`if: release_created`), not a literal `on: release` trigger | A literal release trigger would need a bot PAT to fire from release-please's bot-created release. Gating inside one workflow keeps the OIDC no-secrets win. |
| D5 | **No Environment approval gate** | Merging the release PR is the single human gate. Publish stays hands-off afterward. |
| D6 | **No GitHub Packages / second-registry mirror** | npmjs stays the single anonymous public home. GH Packages would force consumers to authenticate to install. |
| D7 | The three guards from the earlier draft are **dropped** | release-please makes their invariants true by construction (the tagged commit is the bumped commit, on `main`), and npm itself rejects a duplicate version. |
| D8 | **Stable releases off `main`**; prerelease channels deferred | Default release-please flow publishes to `latest`. A `bridge`/`rc` channel can be added later via prerelease config if needed. |

## 4. Non-goals (YAGNI)

- changesets (rejected in favor of release-please, D3).
- A GitHub Environment approval gate (removed, D5).
- GitHub Packages or any second-registry mirror (skipped, D6).
- A literal `on: release` trigger / publishing from hand-created releases (would need a PAT, D4).
- Prerelease release channels (deferred, D8). The one-off `1.1.1-bridge` pattern is not reproduced unless configured later.

## 5. Design

The release flow lives in one new workflow plus two small release-please config files. `ci.yml` is unchanged.

### 5.1 New file: `.github/workflows/release.yml`

```yaml
name: Release

on:
  push:
    branches: [main]

permissions: {}            # least privilege; each job opts in to exactly what it needs

concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false

jobs:
  release-please:
    runs-on: ubuntu-latest
    permissions:
      contents: write        # tag + create the GitHub Release
      pull-requests: write    # open / update the release PR
    outputs:
      release_created: ${{ steps.release.outputs.release_created }}
      tag_name: ${{ steps.release.outputs.tag_name }}
    steps:
      - uses: googleapis/release-please-action@v4
        id: release
        with:
          token: ${{ secrets.GITHUB_TOKEN }}
          # config-file (release-please-config.json) and
          # manifest-file (.release-please-manifest.json) use default names

  publish:
    needs: release-please
    if: ${{ needs.release-please.outputs.release_created == 'true' }}
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write          # OIDC token for npm trusted publishing
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '22'                      # >= 22.14.0 covers OIDC + strip-types tests
          registry-url: 'https://registry.npmjs.org'
          cache: npm

      - name: Upgrade npm for OIDC trusted publishing
        run: npm install -g npm@latest             # need >= 11.5.1

      - run: npm ci

      - name: Verify (typecheck, examples typecheck, tests, build)
        run: npm run verify

      - name: Publish to npm (OIDC + provenance)
        run: |
          v=$(node -p "require('./package.json').version")
          if [[ "$v" == *-* ]]; then tag="${v#*-}"; tag="${tag%%.*}"; else tag="latest"; fi
          npm publish --provenance --access public --tag "$tag"
```

Notes:
- The `publish` job checks out the triggering commit on `main`, which is the release commit release-please
  just made, so `package.json` already carries the new version. No tag parsing needed.
- The dist-tag derivation is defensive: stable versions go to `latest`; if a prerelease version ever flows
  through it lands on a label tag (`bridge`, `rc`) instead of clobbering `latest`.
- `npm run verify` re-runs the full gate before publishing, so a release can never ship a red build.

### 5.2 New file: `release-please-config.json`

```json
{
  "$schema": "https://raw.githubusercontent.com/googleapis/release-please/main/schemas/config.json",
  "packages": {
    ".": {
      "release-type": "node",
      "package-name": "@p2pdotme/widgets",
      "changelog-path": "CHANGELOG.md",
      "include-component-in-tag": false,
      "bump-minor-pre-major": false
    }
  }
}
```

### 5.3 New file: `.release-please-manifest.json`

```json
{
  ".": "1.2.1"
}
```

Seeds release-please at the current published version. Its first PR then proposes only the next bump
(based on commits since `v1.2.1`), not the entire history. Default tag format is `v${version}`, which
matches the existing `v1.2.1` tag.

### 5.4 What each release does

1. A normal `feat:` / `fix:` PR merges to `main`. release-please updates its open release PR (next version + changelog entry).
2. Merging the release PR is the human gate. release-please commits the version bump + changelog, tags `vX.Y.Z`, and creates the GitHub Release with generated notes.
3. In the same run, the `publish` job sees `release_created == 'true'`, verifies, and publishes `X.Y.Z` to npm `latest` with a provenance attestation.
4. Any non-release push to `main` runs `release-please` only; `publish` is skipped.

## 6. One-time setup (two items, done once)

1. **Enable PR creation by Actions.** Repo Settings -> Actions -> General -> "Allow GitHub Actions to
   create and approve pull requests". Without this, release-please cannot open its release PR.
2. **Register the OIDC trusted publisher** (`npm trust` needs npm `>= 11.10.0`; local npm is `10.9.2`,
   so run it via `npx`, no global upgrade):

   ```bash
   # confirm exact flags + intended config first, writing nothing
   npx -y npm@latest trust github @p2pdotme/widgets \
     --repository p2pdotme/widgets \
     --workflow release.yml \
     --allow-publish \
     --dry-run

   # then the same command without --dry-run; supply the email OTP at the prompt
   ```

   `--workflow release.yml` must match the workflow filename exactly (case-sensitive). Auth for this single
   run uses a short-lived granular access token held in macOS Keychain under an always-prompt ACL per the
   secret-handling policy, used only for this command and revoked afterward; the trust operation still
   demands an OTP (a 2FA-bypass token is rejected for trust), which the user reads from email. Exact flag
   names are confirmed by the `--dry-run` first.

## 7. Acceptance criteria (the "tests")

A1. Merging a `feat:` or `fix:` PR to `main` updates release-please's release PR with the correct next
    version and a changelog entry derived from the commit.
A2. Merging the release PR creates tag `vX.Y.Z` and a GitHub Release with generated notes, and publishes
    `X.Y.Z` to npm under `latest` with a verified provenance attestation.
A3. No `NPM_TOKEN` and no PAT secret exists in the repo. Publishing is keyless apart from the one-time OIDC trust.
A4. A non-release push to `main` (e.g. a docs-only merge that yields no version bump) does NOT publish.
A5. release-please's first PR proposes only commits since `v1.2.1` and a sane changelog, not the whole history.

Safe first validation: let release-please open its first PR and inspect the proposed version + changelog
WITHOUT merging (A5). Only merge once it looks right; that merge is the first real `latest` release.

## 8. Open items / risks

- "Allow GitHub Actions to create and approve pull requests" must be enabled, or no release PR appears.
- Anchoring: with zero existing GitHub Releases, confirm the first release-please PR does not over-reach.
  The seeded manifest (`1.2.1`) plus the matching `v1.2.1` tag should anchor it; add `bootstrap-sha` to the
  config only if the first PR pulls in pre-`1.2.1` history.
- `npm trust github` exact flag names confirmed at execution via `--dry-run` / `--help`.
- Email-OTP acceptance for the trust operation confirmed at execution (user reports account 2FA is email).
- Version bumps depend on Conventional Commit discipline on `main` (already the team's habit).
- Local `main` was stale vs `origin/main`; this branch is based on fresh `origin/main` (`225c2a7`).

## 9. Rollout (inside the deploy gate)

1. PR from `ci/release-on-tag` carrying this spec, `release.yml`, `release-please-config.json`, and `.release-please-manifest.json`.
2. Agentic review, then manual review and explicit approval.
3. Merge to `main`.
4. One-time setup (section 6): enable the Actions PR setting, register the OIDC trusted publisher.
5. Inspect release-please's first PR (A5), then merge it for the first real release.
