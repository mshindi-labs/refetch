# Publishing Setup Guide

Releases are automated. [release-please](https://github.com/googleapis/release-please) keeps a **Release PR** open on `main`; merging it tags the release, creates the GitHub release and publishes to npm through **npm Trusted Publishers** (OIDC, no tokens, provenance attached). Everything lives in `.github/workflows/publish.yml`.

## One-time setup

### 1. Configure the trusted publisher on npmjs.com

1. Go to [npmjs.com](https://www.npmjs.com) and log in
2. Navigate to the package: `@mshindi-labs/refetch`
3. Go to **Settings** → **Publishing Access**
4. Click **"Add a trusted publisher"** and select **GitHub Actions**
5. Fill in:
   - **Repository owner**: `mshindi-labs`
   - **Repository name**: `refetch`
   - **Workflow filename**: `publish.yml`
   - **Environment name**: leave empty

**Important**: the workflow filename must match exactly (case-sensitive) including the `.yml` extension. The publish job deliberately stays in `publish.yml` so this setting never changes.

### 2. Repository settings on GitHub

- **Settings → Actions → General → Workflow permissions**: enable **Allow GitHub Actions to create and approve pull requests**. release-please needs it to open the Release PR.
- Optional: add a repository secret `RELEASE_PLEASE_TOKEN` holding a fine-grained personal access token with `contents: write` and `pull-requests: write` on this repository. With it, the Release PR gets the normal CI checks. With the default `GITHUB_TOKEN`, GitHub never triggers workflows for pull requests or tags created by Actions, so the Release PR shows no checks; the publish job still runs the full `npm run ci` gate before publishing.
- Keep tags clean: release-please looks at existing tags and releases to find the previous version. Delete tags that were never released (for example a stray `v4.0.0` created by an accidental `npm version`).

### 3. (Recommended) Restrict token access

After verifying trusted publishing works:

1. Go to package **Settings** → **Publishing access**
2. Select **"Require two-factor authentication and disallow tokens"**
3. Save

This ensures only the workflow can publish.

## How a release happens

1. Pull requests merge into `main` with Conventional Commit messages (`fix:`, `feat:`, `feat!:` / `BREAKING CHANGE:`).
2. On every push to `main`, release-please creates or updates the PR titled `chore: release X.Y.Z` with the version bump in `package.json` / `package-lock.json` and the generated `CHANGELOG.md` entry.
3. Review the notes. If they need more context, commit to the Release PR branch (the next push to `main` regenerates it, so do this right before merging) or add a follow-up docs commit after the release.
4. Merge the Release PR. The workflow tags `vX.Y.Z`, publishes the GitHub release, checks out the tag, runs `npm ci` and `npm run ci`, then `npm publish --provenance --access public`.
5. Confirm on [npmjs.com](https://www.npmjs.com/package/@mshindi-labs/refetch) and the GitHub Releases page.

## Forcing a version

Add a `Release-As: X.Y.Z` footer to any commit that lands on `main`, for example an empty commit:

```bash
git commit --allow-empty -m "chore: release 3.1.0" -m "Release-As: 3.1.0"
```

The next Release PR uses that version regardless of the commit types.

## Re-publishing an existing tag

If publishing failed after the release was created (transient npm or runner error), re-run it from the Actions tab: **Release & Publish** → **Run workflow** → enter the tag (for example `v3.1.0`). The job re-verifies and publishes that exact tag.

## Workflow details

- **Triggers**: push to `main` (release-please), `workflow_dispatch` with a tag (re-publish)
- **Node version**: 24 (ships npm 11, which satisfies the 11.5.1+ trusted-publishing requirement)
- **Verification**: `npm run ci` (lint, typecheck, build, tests with coverage, arethetypeswrong/publint, size budget, smoke) must pass before `npm publish`
- **Authentication**: OIDC, no tokens stored in GitHub
- **Provenance**: generated for every publish

## Known registry quirk: the stray 4.0.0

A `4.0.0` was published by mistake on 2025-10-30 and cannot be removed (npm only allows unpublishing within 72 hours). Consequences:

- The workflow publishes with an explicit `--tag latest`; without it npm fails with "Cannot implicitly apply the latest tag because previously published version 4.0.0 is higher".
- Run `npm deprecate @mshindi-labs/refetch@4.0.0 "Published by mistake; use 3.x"` once from a logged-in maintainer account so `npm install @mshindi-labs/refetch@4` warns instead of installing it.
- The first real v4 release must be **4.0.1 or higher** (for example `Release-As: 4.1.0`), because 4.0.0 is taken.

## Troubleshooting

- **No Release PR after merging**: check the "Allow GitHub Actions to create and approve pull requests" setting, and that the commits since the last release contain `fix`, `feat`, `perf` or `revert` types (hidden types such as `docs` or `chore` alone do not produce a release)
- **Wrong next version**: use a `Release-As` footer; `feat` bumps minor, `fix` patch, `!` or `BREAKING CHANGE:` major
- **"Unable to authenticate"**: the workflow filename in npmjs.com settings must be exactly `publish.yml`
- **Publish job did not run after merging the Release PR**: open the "Release & Publish" run for the merge commit; re-run via *Run workflow* with the tag if needed
- **Verify step fails**: run `npm run ci` locally; the tag is not published until every check is green
- **Release created but publish failed**: the tag and GitHub release already exist, so fix the cause and re-publish that tag via *Run workflow*; nothing needs to be re-tagged

## Resources

- [release-please](https://github.com/googleapis/release-please) and [release-please-action](https://github.com/googleapis/release-please-action)
- [npm Trusted Publishers Documentation](https://docs.npmjs.com/trusted-publishers)
- [GitHub Actions OIDC](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect)
