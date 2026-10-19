# Cloudflare Pages deployment

The `Deploy Flight3d to Cloudflare Pages` GitHub Actions workflow checks, tests,
and builds the source, creates the `flight3d` Pages project when absent, and
uploads only `dist/`. It runs on pushes to `main` and can be dispatched manually
on `main`. Production publishes the exact checked-out commit.

## One-time account setup

In the Flight3d repository, under Settings → Secrets and variables → Actions,
add these repository secrets:

- `CLOUDFLARE_API_TOKEN`: a token with **Account → Cloudflare Pages → Edit** for
  the target account.
- `CLOUDFLARE_ACCOUNT_ID`: that Cloudflare account's ID.

GitHub repository secrets are not shared automatically between repositories.
An existing token in another repository cannot be read back from GitHub and
copied. A token configured for Cloudflare's own Git builds also does not become
available to GitHub Actions. Supply the intended token directly through the
GitHub secrets UI or `gh secret set`; never commit or print it.

Merge the workflow into `main` to deploy. Later pushes redeploy automatically.
The workflow's Wrangler output reports the actual deployment URL. The intended
production address is `https://flight3d.pages.dev`, subject to name availability.

This creates a Direct Upload Pages project. Cloudflare dashboard Git integration
is a separate deployment method; this workflow does not depend on it. If the
`flight3d` name belongs to another account, choose an available project name in
both workflow steps before deploying.
