# Riftbound on Cloudflare: the app on Pages (with the /api/turn function) and a TURN key for Cloudflare's relay.
# Applied by .github/workflows/infra.yml; state lives in an R2 bucket in the same account (see backend below).
terraform {
  required_version = ">= 1.7"
  required_providers {
    cloudflare = { source = "cloudflare/cloudflare", version = "~> 5.0" }
  }
  # R2 speaks the S3 API. Bucket, endpoint and keys are passed in by the workflow (-backend-config).
  backend "s3" {
    key                         = "riftbound/terraform.tfstate"
    region                      = "auto"
    skip_credentials_validation = true
    skip_region_validation      = true
    skip_requesting_account_id  = true
    skip_metadata_api_check     = true
    skip_s3_checksum            = true
    use_path_style              = true
  }
}

variable "account_id" {
  type        = string
  description = "Cloudflare account ID"
}
variable "project_name" {
  type    = string
  default = "riftbound"
}

provider "cloudflare" {} # reads CLOUDFLARE_API_TOKEN

# The TURN relay key for co-op on mobile data (first 1,000 GB a month free) is made once by the workflow and kept
# as Pages secrets: Cloudflare only shows a key's secret when it's created, so Terraform can't hand it over.
removed {
  from = cloudflare_calls_turn_app.relay
  lifecycle { destroy = false }
}

# The game. Deployed by direct upload from GitHub Actions (wrangler pages deploy), so no GitHub app is needed on Cloudflare.
resource "cloudflare_pages_project" "game" {
  account_id        = var.account_id
  name              = var.project_name
  production_branch = "main"
  deployment_configs = {
    production = { compatibility_date = "2025-01-01" }
    preview    = { compatibility_date = "2025-01-01" }
  }
  # the relay secrets are set by the workflow (wrangler pages secret put)
  lifecycle { ignore_changes = [deployment_configs] }
}

output "url" { value = "https://${cloudflare_pages_project.game.subdomain}" }
