# Riftbound on Cloudflare

The game goes on Cloudflare Pages, with a small Function (`functions/api/turn.ts`) that hands out
Cloudflare Realtime TURN relay credentials so co-op works across mobile networks.
Everything is created by Terraform (`infra/main.tf`) from GitHub Actions. Until the two secrets
below exist, both workflows do nothing.

## One-time setup (about 10 minutes)

1. **Cloudflare account**: use your existing one.
2. **R2**: Dashboard > R2 > enable it (free tier; it may ask for a card on file). It stores Terraform's state.
3. **API token**: Dashboard > My Profile > API Tokens > Create Token > Custom token, with these
   *Account* permissions:
   - Cloudflare Pages: Edit
   - Calls (Realtime): Edit
   - Workers R2 Storage: Edit
   You can instead edit an existing token and add these permissions.
4. **GitHub secrets**: repo > Settings > Secrets and variables > Actions > New repository secret:
   - `CLOUDFLARE_API_TOKEN`: the token
   - `CLOUDFLARE_ACCOUNT_ID`: from the dashboard URL or the account home sidebar
5. **Run Infra**: repo > Actions > Infra > Run workflow. The summary shows the game URL
   (`https://riftbound.pages.dev`).
6. **Deploy**: Actions > Deploy > Run workflow once; after that it runs on every push that changes `docs/`.
7. Optional: make the repo private once the Pages link works (GitHub Pages stops then).

## No R2?

Run Terraform locally instead: delete the `backend "s3"` block in `infra/main.tf`, then `cd infra && terraform init && terraform apply -var account_id=...`
with `CLOUDFLARE_API_TOKEN` set. Keep the `terraform.tfstate` file safe.
