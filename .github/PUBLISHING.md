# Publishing Setup Guide

This repository uses **npm Trusted Publishers** with OIDC authentication for secure, token-free package publishing.

## Setup Steps

### 1. Configure Trusted Publisher on npmjs.com

1. Go to [npmjs.com](https://www.npmjs.com) and log in
2. Navigate to your package: `@mshindi-labs/refetch`
3. Go to **Settings** → **Publishing Access**
4. Click **"Add a trusted publisher"**
5. Select **GitHub Actions** as the provider
6. Fill in the following details:
   - **Repository owner**: `mshindi-labs` (your GitHub username or org)
   - **Repository name**: `refetch` (or your actual repo name)
   - **Workflow filename**: `publish.yml`
   - **Environment name**: Leave empty (optional)

**Important**: The workflow filename must match exactly (case-sensitive) including the `.yml` extension.

### 2. How to Publish

Once the trusted publisher is configured on npmjs.com:

1. Update the version in `package.json`
2. Commit your changes
3. Create and push a git tag:
   ```bash
   git tag v1.0.2
   git push origin v1.0.2
   ```

The GitHub Action will automatically:
- Build your package
- Publish to npm using OIDC authentication (no tokens needed!)
- Generate provenance attestations automatically

### 3. (Recommended) Restrict Token Access

For maximum security, after verifying trusted publishing works:

1. Go to package **Settings** → **Publishing access**
2. Select **"Require two-factor authentication and disallow tokens"**
3. Save changes

This ensures only trusted publishing can publish your package.

## Workflow Details

- **Trigger**: Automatically runs when you push a tag starting with `v` (e.g., `v1.0.2`)
- **Node Version**: 20
- **npm Version**: Latest (11.5.1+ required for trusted publishing)
- **Authentication**: OIDC (no tokens stored in GitHub)
- **Provenance**: Automatically generated for transparency

## Benefits of Trusted Publishing

✅ No long-lived tokens to manage
✅ No risk of token leaks
✅ Automatic provenance generation
✅ Short-lived, scoped credentials
✅ Cryptographic proof of package authenticity

## Troubleshooting

- **"Unable to authenticate"**: Verify the workflow filename in npmjs.com settings matches exactly
- **Workflow doesn't trigger**: Ensure you're pushing tags (not just commits)
- **Build fails**: Check that all dependencies are correctly specified in `package.json`

## Resources

- [npm Trusted Publishers Documentation](https://docs.npmjs.com/trusted-publishers)
- [GitHub Actions OIDC](https://docs.github.com/en/actions/deployment/security-hardening-your-deployments/about-security-hardening-with-openid-connect)
