# CutRoom landing on Vercel

This folder is the deployable, static copy of the CutRoom landing. It contains the page, videos, images, styles, interactive feature demo, and a single Node.js function for the download form.

## Vercel project settings

- Repository: `Mathpcastro/cutroom`
- Root directory: `website`
- Framework preset: Other
- Build and install commands: none
- Output directory: `public`
- Production and preview environment variable: `CUTROOM_SITES_BYPASS_TOKEN` (sensitive)

The function forwards only `POST /api/download` to the existing private Sites backend, which continues to validate the form and save contacts to the Pauta.ai Supabase database. The access token belongs in Vercel's encrypted environment settings; never commit it or print it in logs. The backend URL is fixed in `api/download.js`, so the function cannot be used as an open proxy.

After the backend confirms a saved registration, the function returns the allowlisted Windows or macOS 0.6.1 installer selected in the form. The private backend still owns validation and persistence; the Vercel function only chooses the matching public release asset.

Static assets in `public/assets` are real CutRoom recordings. Update the canonical landing in `cutroom-landing` and sync its `web/index.html` plus `public/` files here when the site changes.

The hero identifies two local MCP clients: Claude Desktop and Codex. Codex can also use the native App Server integration. The brand files in `public/assets/brands` come from Anthropic's official press kit and the official OpenAI Codex app; the page labels the integrations as independent and does not imply endorsement.
