# Publishing @anttikissa/tsk

The initial `0.1.0` release was published manually. Future releases are intended to use [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) from GitHub Actions, without an npm token in GitHub secrets.

## One-time npm setup (package owner)

1. Log in to npmjs.com as an owner of [`@anttikissa/tsk`](https://www.npmjs.com/package/@anttikissa/tsk). Open the package **Settings → Trusted publishing → Add trusted publisher**, and choose **GitHub Actions**.
2. Set **Organization or user** to `anttikissa`, **Repository** to `tsk`, and **Workflow filename** to `publish.yml` (the filename only, not `.github/workflows/publish.yml`). Leave **Environment name** empty: the workflow does not use a GitHub environment. Enable **direct `npm publish`** in **Allowed actions**; the default for new connections can be stage-only. Save and check that this connection appears in package settings.
3. Ensure the repository's GitHub Actions policy allows `actions/checkout`, `actions/setup-node`, and `oven-sh/setup-bun`. Protect release tags (`v*`) from untrusted creation/changes and restrict changes to the publishing workflow. GitHub-hosted runners are required for npm OIDC.

npm does not validate the trusted publisher fields at save time. An `npm publish --dry-run` does not verify OIDC; a real, authorized future release is needed to test the connection. Do not add `NPM_TOKEN` or `NODE_AUTH_TOKEN` secrets to this workflow. npm's CLI must be at least 11.5.1 with Node 22.14.0 or later; the workflow uses Node 24 and pins npm 11.9.0 for publishing.

## Future release

1. Prepare a release commit on `main`: update `package.json` version and `CHANGELOG.md`, run `bun install --frozen-lockfile`, `bun test`, and `bun run typecheck`; inspect the packed files with `npm pack --dry-run`. Obtain release authorization before creating/pushing a version tag.
2. Tag that commit `v<package.json version>` and push the tag to `anttikissa/tsk`. `.github/workflows/publish.yml` runs on pushed `v*` tags, checks that the tag and package version match, installs with the Bun lockfile, runs tests/typecheck, and calls `npm publish --access public` without a token. The npm-side connection must permit **direct** publishing, not just staging.
3. Inspect the GitHub Actions **Publish to npm** run for the release tag. Confirm `npm view @anttikissa/tsk@<version> version` returns the new version and that the npm package page shows the provenance link to the correct GitHub repository, commit, and workflow. npm automatically generates provenance for public packages in public GitHub repositories published using trusted publishing. Verify the linked run and package contents before announcing the release. If publication fails, diagnose the workflow/npm connection; never reuse the same version for different contents.
4. After a successful trusted publish, consider **Settings → Publishing access → Require two-factor authentication and disallow tokens** and revoke obsolete automation tokens. This restriction does not disable OIDC publishes. Keep an owner recovery plan before removing token-based publishing.

The workflow configuration is not proof that the npm-side connection exists or works: record successful verification only after an actual future release. npm trusted publisher connections cannot be edited in place; to change the workflow filename, repository, or other fixed fields, delete and recreate the connection on npmjs.com.
