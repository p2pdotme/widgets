# Widgets Release Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make publishing `@p2pdotme/widgets` a single act (merge release-please's release PR) that bumps the version, writes the changelog, tags, creates the GitHub Release, and publishes to npm keyless via OIDC with provenance.

**Architecture:** One new workflow `.github/workflows/release.yml` with two jobs. The `release-please` job (googleapis/release-please-action@v4) maintains a release PR and, on its merge, tags + creates the GitHub Release. A `publish` job, gated on `release_created`, then runs the verify gate and `npm publish --provenance` authenticated by GitHub's OIDC token (no stored npm token). Two small config files (`release-please-config.json`, `.release-please-manifest.json`) drive release-please. The existing `ci.yml` is the PR gate and is left untouched.

**Tech Stack:** GitHub Actions, googleapis/release-please-action@v4, npm OIDC trusted publishing (npm >= 11.5.1, Node 22), Conventional Commits.

**Verification note (read first):** This plan produces declarative CI config, not application code, so there is no unit under test. Per CLAUDE.md's non-code approximation, each build task is **create -> validate -> commit**, where "validate" is JSON parse-checks and `actionlint` (which runs shellcheck over `run:` blocks). The end-to-end behavior (acceptance criteria A1-A5 in the spec) cannot be exercised before the workflow exists on `main` — GitHub only runs a workflow present on the branch — so those live checks live in the **Post-merge runbook** at the end. Spec: `docs/superpowers/specs/2026-06-09-widgets-release-pipeline-design.md`.

**Preconditions:**
- Current branch is `ci/release-on-tag` (already created off fresh `origin/main` @ `225c2a7`).
- Working directory is the repo root: `/Users/gitchad/github.com/p2pdotme/widgets`.
- All commands below assume that cwd.

**File structure:**
- Create `.release-please-manifest.json` — anchors release-please at the current published version.
- Create `release-please-config.json` — release-please behavior for the single root package.
- Create `.github/workflows/release.yml` — two-job release workflow (release-please, then gated publish).
- Unchanged: `.github/workflows/ci.yml`, `package.json`, `CHANGELOG.md`, everything under `src/`.

---

### Task 1: release-please manifest + config

**Files:**
- Create: `.release-please-manifest.json`
- Create: `release-please-config.json`

- [ ] **Step 1: Create `.release-please-manifest.json`**

```json
{
  ".": "1.2.1"
}
```

- [ ] **Step 2: Create `release-please-config.json`**

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

- [ ] **Step 3: Validate both files are valid JSON and the anchor matches package.json**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('release-please-config.json','utf8')); console.log('config json ok')" \
&& node -e "const m=require('./.release-please-manifest.json'); const p=require('./package.json'); if(m['.']!==p.version){throw new Error('manifest '+m['.']+' != package '+p.version)} console.log('anchor ok', p.version)"
```
Expected:
```
config json ok
anchor ok 1.2.1
```

- [ ] **Step 4: Commit**

```bash
git add release-please-config.json .release-please-manifest.json
git commit -m "ci(release): add release-please config and manifest"
```

---

### Task 2: Release workflow

**Files:**
- Create: `.github/workflows/release.yml`

- [ ] **Step 1: Create `.github/workflows/release.yml`**

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

- [ ] **Step 2: Download actionlint to a temp location (not committed)**

Run:
```bash
curl -sSfL https://raw.githubusercontent.com/rhysd/actionlint/main/scripts/download-actionlint.bash -o /tmp/dl-actionlint.bash \
&& bash /tmp/dl-actionlint.bash latest /tmp >/dev/null \
&& /tmp/actionlint --version
```
Expected: a version string (e.g. `1.7.x`). If you already have `actionlint` on PATH, you may use that instead.

- [ ] **Step 3: Lint the new workflow (also runs shellcheck on the publish `run` block)**

Run:
```bash
/tmp/actionlint .github/workflows/release.yml
```
Expected: no output, exit code 0.

- [ ] **Step 4: Lint every workflow to confirm `ci.yml` is still clean**

Run:
```bash
/tmp/actionlint
```
Expected: no output, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci(release): add release-please + OIDC publish workflow"
```

---

### Task 3: Open the PR (enters the deploy gate)

**Files:** none.

- [ ] **Step 1: Push the branch**

```bash
git push -u origin ci/release-on-tag
```

- [ ] **Step 2: Open the PR against `main`**

```bash
gh pr create --repo p2pdotme/widgets --base main --head ci/release-on-tag \
  --title "ci: release-please + OIDC publish pipeline" \
  --body "$(cat <<'EOF'
Adds an automated release pipeline so a single act (merging release-please's release PR) bumps the version, writes the changelog, tags, creates the GitHub Release, and publishes to npm keyless via OIDC with provenance.

## What this adds
- `.github/workflows/release.yml` - two jobs: `release-please` (maintains the release PR; tags + creates the GitHub Release on merge), then a `publish` job gated on `release_created` that runs `npm run verify` and `npm publish --provenance` via OIDC. No stored npm token.
- `release-please-config.json` + `.release-please-manifest.json` (anchored at 1.2.1).
- Existing `ci.yml` is unchanged and remains the PR gate.

## One-time setup required AFTER merge (see plan runbook)
1. Enable repo setting "Allow GitHub Actions to create and approve pull requests" (release-please needs it to open its PR).
2. Register the npm OIDC trusted publisher: `npm trust github @p2pdotme/widgets --workflow release.yml`.

## Why
Closes the manual-publish drift: npm has 1.1.3 and 1.2.0 with no git tag, the changelog skips 1.1.3, and there are zero GitHub Releases despite 7 npm versions.

Design: `docs/superpowers/specs/2026-06-09-widgets-release-pipeline-design.md`
Plan: `docs/superpowers/plans/2026-06-09-widgets-release-pipeline.md`
EOF
)"
```
Expected: prints the new PR URL.

- [ ] **Step 3: STOP — deploy gate**

The user drives agentic review, manual review, explicit approval, and the merge. **Claude does not merge.** Do not proceed to the runbook until the PR is merged to `main`.

---

## Post-merge runbook (operational; after the user merges the PR)

These are not build tasks. They run against the live repo and npm, once, in order. They prove acceptance criteria A1-A5 from the spec.

### R1: Enable Actions PR creation (one-time)

release-please cannot open its release PR unless this repo setting is on.

- UI: Settings -> Actions -> General -> Workflow permissions -> check "Allow GitHub Actions to create and approve pull requests".
- Or API:
```bash
gh api --method PUT /repos/p2pdotme/widgets/actions/permissions/workflow \
  -F default_workflow_permissions=read -F can_approve_pull_request_reviews=true
gh api /repos/p2pdotme/widgets/actions/permissions/workflow   # verify can_approve_pull_request_reviews=true
```
If the org (`p2pdotme`) enforces this off at the org level, it must be enabled by an org admin first.

### R2: Register the OIDC trusted publisher (one-time, before merging the first release PR)

`npm trust` needs npm >= 11.10.0; local npm is 10.9.2, so run via `npx` (no global upgrade).

```bash
# 1. dry-run to confirm exact flags + intended config (writes nothing)
npx -y npm@latest trust github @p2pdotme/widgets \
  --repository p2pdotme/widgets \
  --workflow release.yml \
  --allow-publish \
  --dry-run

# 2. same command without --dry-run; supply the email OTP at the prompt
```
Auth for this single run: a short-lived granular access token with write access to the package, held in macOS Keychain under an always-prompt ACL per the secret-handling policy, used only here and revoked afterward. The trust operation itself still demands an OTP (a 2FA-bypass token is rejected for trust), read from email at the prompt. `--workflow release.yml` must match the workflow filename exactly.

Verify: `npx -y npm@latest trust list` shows the GitHub trusted publisher for `@p2pdotme/widgets`.

### R3: First release (proves A1, A2, A4, A5)

- [ ] After R1, the `release-please` workflow run from the merge opens the first release PR. Inspect it WITHOUT merging (**A5**): the proposed version must be the next bump after `1.2.1`, and the changelog must cover only commits since `1.2.1`.
  - If it pulls in pre-`1.2.1` history, get the anchor commit (`git rev-list -n 1 v1.2.1`) and add `"bootstrap-sha": "<that sha>"` into the `.` package block of `release-please-config.json` via a follow-up PR, then re-check.
- [ ] Merge the release PR (**user action; deploy gate**). The `publish` job runs in that same workflow run.
- [ ] Verify the publish (**A2**):
```bash
npm view @p2pdotme/widgets version                 # the new version
npm view @p2pdotme/widgets dist-tags               # new version under "latest"
gh release list --repo p2pdotme/widgets            # GitHub Release for the new tag exists
```
  Provenance: open the package page on npmjs.com and confirm the "Provenance" / published-via-GitHub-Actions attestation is shown.
- [ ] Confirm a non-release push does not publish (**A4**): a later non-bumping merge to `main` runs only the `release-please` job; the `publish` job is skipped.

### R4: Confirm keyless (proves A3)

```bash
gh secret list --repo p2pdotme/widgets
```
Expected: no `NPM_TOKEN` and no publish PAT. The only publish credential is the OIDC trust from R2.

---

## Self-review

**Spec coverage:**
- D1 OIDC keyless publish -> Task 2 publish job (`id-token: write`, `npm publish --provenance`, no token) + R2.
- D2 `npm trust` CLI + email OTP -> R2.
- D3 release-please drives version/changelog/tag/release -> Task 1 + Task 2 `release-please` job.
- D4 gated publish, no `on: release`, no PAT -> Task 2 `publish` `if: release_created`.
- D5 no Environment gate -> absent by construction.
- D6 no GitHub Packages mirror -> absent by construction.
- D7 guards dropped -> publish job has none; npm rejects duplicate versions.
- D8 stable off main, defensive dist-tag -> Task 2 publish `run` block.
- One-time setup (spec section 6) -> R1 + R2.
- Acceptance A1-A5 -> R3 (A1/A2/A4/A5) + R4 (A3).
- Risk: Actions-PR setting -> R1 (incl. org-level note). Risk: anchoring -> R3 bootstrap-sha fallback.

**Placeholder scan:** none. Every file has full content; every command has an expected result; the PR body is literal.

**Consistency:** workflow filename `release.yml` is identical in Task 2, the PR body, and R2's `--workflow`. Manifest anchor `1.2.1` matches `package.json` (asserted in Task 1 Step 3). Job output `release_created` is defined in the `release-please` job `outputs` and consumed in the `publish` job `if`.

**TDD-on-config boundary:** the dist-tag derivation is the only branching logic; its prerelease branch is deferred (D8) and dormant for stable releases (always `latest`), so it is left inline and covered by actionlint/shellcheck rather than a unit test. When a prerelease channel is enabled later, extract that derivation into a tested script at that time.
