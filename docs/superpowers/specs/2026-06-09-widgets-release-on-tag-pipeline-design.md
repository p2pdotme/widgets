# Widgets release-on-tag pipeline - design spec

- Repo: github.com/p2pdotme/widgets (public)
- Package: `@p2pdotme/widgets` (npm, public scope)
- Date: 2026-06-09
- Branch: `ci/release-on-tag`
- Status: design approved, pending spec review

## 1. Goal

Pushing an annotated git tag `vX.Y.Z` to `main` triggers a single workflow that:

1. verifies the build (typecheck, tests, build),
2. publishes that exact version to npm, keyless, via OIDC trusted publishing with provenance, and
3. cuts a matching GitHub Release with notes drawn from `CHANGELOG.md`.

No manual `npm publish`. No long-lived npm token to store or rotate. The git tag is the
single trigger and the single source of truth for the version.

## 2. Current state and the gap this closes

The tag -> publish -> release link is currently manual and has drifted in three independent
places (observed 2026-06-09 against `main` @ `225c2a7`):

| Channel        | State                                                              |
|----------------|-------------------------------------------------------------------|
| npm versions   | 1.0.0, 1.1.0, 1.1.1-bridge, 1.1.2, 1.1.3, 1.2.0, 1.2.1            |
| git tags       | v1.0.0, v1.1.0, v1.1.1-bridge, v1.1.2, v1.2.1                      |
| CHANGELOG      | 1.2.1, 1.2.0, 1.1.2, 1.1.0, 1.0.0, 0.1.0                           |
| GitHub Releases| none                                                              |

- `1.1.3` and `1.2.0` were published to npm with **no git tag**.
- `1.1.3` was never written into `CHANGELOG.md`.
- Zero GitHub Releases exist despite five tags and seven npm versions.

`1.2.1` is already both tagged and published, so the first real use of this pipeline is the
next bump (`>= 1.2.2`). A stray re-tag of `v1.2.1` is caught by the "already published" guard.

The existing `.github/workflows/ci.yml` (verify on push/PR to `main`, Node 22.x + 24.x) is the
PR gate and is left untouched. It is branch-scoped, so a tag push does not retrigger it; the
release workflow re-runs `verify` itself.

## 3. Decisions (locked)

| # | Decision | Rationale |
|---|----------|-----------|
| D1 | npm auth = **OIDC trusted publishing** | No stored secret, automatic provenance, npm's current best practice for public repos. Keyless forever after a one-time setup. |
| D2 | Trust registration done via the **`npm trust` CLI**, OTP supplied by user (email) | User opted for the scriptable path over the web UI; account 2FA is email-based, so the one interactive step is easy. |
| D3 | Release model = **tag-driven** (human bumps version + tags; workflow publishes) | Matches "tag = release". Keeps version human-controlled and sits inside the existing PR-to-main gate. Changesets / release-please rejected as heavier than warranted (see Non-goals). |
| D4 | GitHub Release notes = **extract the matching `## [X.Y.Z]` section from CHANGELOG.md**, fall back to `--generate-notes` | The changelog is the curated copy. Auto-notes only when a section is missing. |
| D5 | **Tag-on-main guard on** | A tag whose commit is not an ancestor of `origin/main` fails before publishing. Keeps releases inside the binding deploy gate (no publishing an unmerged branch by tagging it). |
| D6 | Prerelease **dist-tag derived from the label** (`1.4.0-bridge` -> `bridge`, `1.5.0-rc.1` -> `rc`); stable -> `latest` | Preserves the existing `bridge` convention and prevents a prerelease from clobbering `latest`. |

## 4. Non-goals (YAGNI)

- Changesets / release-please automated version bumping and changelog generation.
- Any automatic editing of `package.json` version or `CHANGELOG.md` by CI.
- A GitHub Environment approval gate on the publish (would break the requested autonomy;
  the PR-to-main step is already the human gate). Can be added later if a manual release
  approval is ever wanted.
- Mirroring the publish to GitHub Packages or any second registry.

## 5. Design

### 5.1 New file: `.github/workflows/release.yml`

```yaml
name: Release

on:
  push:
    tags: ['v*']

permissions:
  contents: write   # create the GitHub Release
  id-token: write   # mint the OIDC token for npm trusted publishing

concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false

jobs:
  release:
    name: Publish ${{ github.ref_name }}
    runs-on: ubuntu-latest
    steps:
      - name: Checkout (full history for ancestor check + changelog)
        uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Setup Node 22
        uses: actions/setup-node@v4
        with:
          node-version: '22'                      # >= 22.14.0 satisfies OIDC + strip-types tests
          registry-url: 'https://registry.npmjs.org'
          cache: npm

      - name: Upgrade npm for OIDC trusted publishing
        run: npm install -g npm@latest             # need >= 11.5.1

      - name: Install dependencies
        run: npm ci

      - name: Derive version + dist-tag from tag
        id: meta
        run: |
          tag="${GITHUB_REF_NAME#v}"
          echo "version=$tag" >> "$GITHUB_OUTPUT"
          if [[ "$tag" == *-* ]]; then
            label="${tag#*-}"; label="${label%%.*}"   # 1.5.0-rc.1 -> rc ; 1.4.0-bridge -> bridge
            echo "disttag=$label" >> "$GITHUB_OUTPUT"
            echo "prerelease=true" >> "$GITHUB_OUTPUT"
          else
            echo "disttag=latest" >> "$GITHUB_OUTPUT"
            echo "prerelease=false" >> "$GITHUB_OUTPUT"
          fi

      - name: Guard - tag matches package.json version
        run: |
          pkg=$(node -p "require('./package.json').version")
          if [[ "$pkg" != "${{ steps.meta.outputs.version }}" ]]; then
            echo "::error::tag ${{ steps.meta.outputs.version }} != package.json $pkg"; exit 1
          fi

      - name: Guard - tag commit is on main
        run: |
          git fetch --no-tags origin main
          if ! git merge-base --is-ancestor "$GITHUB_SHA" FETCH_HEAD; then
            echo "::error::tag commit $GITHUB_SHA is not an ancestor of origin/main"; exit 1
          fi

      - name: Guard - version not already on npm
        run: |
          if npm view "@p2pdotme/widgets@${{ steps.meta.outputs.version }}" version >/dev/null 2>&1; then
            echo "::error::@p2pdotme/widgets@${{ steps.meta.outputs.version }} already published"; exit 1
          fi

      - name: Verify (typecheck, examples typecheck, tests, build)
        run: npm run verify

      - name: Publish to npm (OIDC + provenance)
        run: npm publish --provenance --access public --tag "${{ steps.meta.outputs.disttag }}"

      - name: Extract release notes from CHANGELOG
        id: notes
        run: |
          v="${{ steps.meta.outputs.version }}"
          awk -v ver="$v" '
            $0 ~ "^## \\[" ver "\\]" { grab = 1; next }
            grab && /^## \[/ { exit }
            grab { print }
          ' CHANGELOG.md > RELEASE_NOTES.md
          if [[ -s RELEASE_NOTES.md ]]; then
            echo "have_notes=true" >> "$GITHUB_OUTPUT"
          else
            echo "have_notes=false" >> "$GITHUB_OUTPUT"
          fi

      - name: Pack tarball (release asset)
        run: npm pack

      - name: Create GitHub Release
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          args=(--title "${{ github.ref_name }}" --verify-tag)
          if [[ "${{ steps.meta.outputs.prerelease }}" == "true" ]]; then args+=(--prerelease); fi
          if [[ "${{ steps.notes.outputs.have_notes }}" == "true" ]]; then
            args+=(--notes-file RELEASE_NOTES.md)
          else
            args+=(--generate-notes)
          fi
          gh release create "${{ github.ref_name }}" ./*.tgz "${args[@]}"
```

### 5.2 Guards (all fail before any publish)

1. **Tag matches manifest** - `vX.Y.Z` must equal `package.json` version. Stops a mistagged release.
2. **Tag is on main** - the tagged commit must be an ancestor of `origin/main`. Keeps the pipeline inside the deploy gate.
3. **Version not already on npm** - makes re-runs safe and turns the OIDC publish error into a clear message.

### 5.3 dist-tag logic

Stable version -> `latest`. Prerelease (contains `-`) -> the label before any `.` (`bridge`, `rc`, `beta`).
A prerelease never lands on `latest`.

### 5.4 GitHub Release

`gh release create vX.Y.Z`:
- body = extracted `## [X.Y.Z]` block from `CHANGELOG.md`, else `--generate-notes`,
- `--prerelease` when the version has a `-`,
- `--verify-tag` so a missing tag fails loudly,
- the `npm pack` tarball attached as an asset.

### 5.5 Permissions + concurrency

Least privilege: `contents: write` (release) and `id-token: write` (OIDC) only; everything else
stays at the default read. `concurrency: release-${{ github.ref }}` with `cancel-in-progress: false`
so a publish is never interrupted or doubled.

### 5.6 Node / npm versions

Runner Node `22` (`>= 22.14.0`, satisfies both OIDC trusted publishing and the `--experimental-strip-types`
test floor of `>= 22.6`). `npm install -g npm@latest` brings the runner to `>= 11.5.1` for OIDC.

## 6. One-time trust registration (runbook, run once before the first tag)

`npm trust` requires npm `>= 11.10.0`; local npm is `10.9.2`, so it is run via `npx` rather than a
global upgrade.

```bash
# 1. confirm exact flags + intended config without writing anything
npx -y npm@latest trust github @p2pdotme/widgets \
  --repository p2pdotme/widgets \
  --workflow release.yml \
  --allow-publish \
  --dry-run

# 2. same command without --dry-run; supply the email OTP at the prompt
```

Auth for this single run: a short-lived granular access token with write access to the package,
held in macOS Keychain under an always-prompt ACL per the secret-handling policy, used only for
this command and revoked afterward. The trust operation itself still demands an OTP (a 2FA-bypass
token is rejected for trust commands), which the user reads from email at the prompt. Exact flag
names are confirmed by the `--dry-run` in step 1 before the real run.

The `--workflow` value (`release.yml`) is case-sensitive and must match the workflow filename exactly.

## 7. Acceptance criteria (the "tests")

A1. Stable tag `vX.Y.Z` (not on npm, commit on main, matching `package.json`) -> npm shows `X.Y.Z`
    under `latest` with a verified provenance attestation, and GitHub Release `vX.Y.Z` exists with
    CHANGELOG-derived notes and the tarball asset.
A2. Prerelease tag `vX.Y.Z-rc.1` -> published under dist-tag `rc`, NOT `latest`; Release marked prerelease.
A3. Tag whose version != `package.json` -> fails at guard 1, nothing published.
A4. Tag on a commit not reachable from `origin/main` -> fails at guard 2.
A5. Re-tagging an already published version -> fails at guard 3.
A6. No `NPM_TOKEN` (or any npm credential) secret exists in the repo - publishing is keyless.

Safe first live validation: cut a throwaway prerelease tag (e.g. `v1.2.2-rc.0`) so `latest` is never
touched, confirm A2 + provenance + Release, then do the first real stable release.

## 8. Open items / risks

- Exact `npm trust github` flag names confirmed at execution via `--dry-run` / `--help`.
- Email-OTP acceptance for the trust operation confirmed at execution (user reports account 2FA is email).
- CHANGELOG must contain the released version's section for curated notes; otherwise auto-notes (acceptable, A1 still passes structurally).
- First publishable version is `>= 1.2.2` (`1.2.1` already tagged + published).
- Local `main` was stale vs `origin/main`; this branch is based on fresh `origin/main` (`225c2a7`).

## 9. Rollout (inside the deploy gate)

1. PR from `ci/release-on-tag` carrying this spec + `release.yml`.
2. Agentic review, then manual review and explicit approval.
3. Merge to `main`.
4. One-time trust registration (section 6).
5. Validate with a prerelease tag (A2), then the first real release.
