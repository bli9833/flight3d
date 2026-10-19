# Cloudflare Git deployment

Flight3d uses Workers Static Assets, matching Keepory and Haptilog's confirmed
Cloudflare Workers Builds integration. GitHub Actions checks and tests the source;
Cloudflare builds and deploys it through its own installed GitHub application.
GitHub Actions Cloudflare secrets are not required for this deployment method.

## Connect the repository once

In the Cloudflare account that hosts Keepory and Haptilog, open Workers & Pages →
Create → Import a repository, then select `stlim0727/flight3d` and set:

| Setting | Value |
| --- | --- |
| Worker name | `flight3d` |
| Production branch | `main` |
| Root directory | Repository root |
| Build command | `npm ci` |
| Deploy command | `npx --yes wrangler@4.151.1 deploy` |
| Node version | `22.23.2` (also declared in `.node-version`) |

`wrangler.toml` runs `npm run build` during deployment and uploads only `dist/`.
The simulator has no backend credentials or required build-time variables.
Cloudflare provides deployment authentication within Workers Builds.
Subsequent pushes to `main` automatically rebuild and deploy the connected Worker.
GitHub reports these runs as `Workers Builds: flight3d` checks.

Use the URL Cloudflare reports after deployment. With the existing account's
`stlim0727.workers.dev` subdomain, the expected address is
`https://flight3d.stlim0727.workers.dev`. This address is not evidence that the
site has been deployed; verify the live deployment before sharing it as ready.

The repository configuration alone cannot create the Cloudflare Git connection.
The initial import requires access to the Cloudflare dashboard or an API token
with the relevant account permissions. A local token's validity does not imply
that it can administer Workers Builds or create Workers.
