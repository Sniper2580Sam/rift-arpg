# Riftbound on Cloudflare: the app on Pages (with the /api/turn function) and a TURN key for Cloudflare's relay.
# Applied by .github/workflows/infra.yml; state lives in an R2 bucket in the same account (see backend below).
terraform {
  required_version = ">= 1.6"
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

# Relay for co-op when two phones can't connect directly (mobile data). First 1,000 GB a month are free.
resource "cloudflare_calls_turn_app" "relay" {
  account_id = var.account_id
  name       = "${var.project_name}-relay"
}

# The game. Deployed by direct upload from GitHub Actions (wrangler pages deploy), so no GitHub app is needed on Cloudflare.
resource "cloudflare_pages_project" "game" {
  account_id        = var.account_id
  name              = var.project_name
  production_branch = "main"
  deployment_configs = {
    production = {
      compatibility_date = "2025-01-01"
      env_vars = {
        TURN_KEY_ID        = { type = "plain_text", value = cloudflare_calls_turn_app.relay.uid }
        TURN_KEY_API_TOKEN = { type = "secret_text", value = cloudflare_calls_turn_app.relay.key }
      }
    }
    preview = {
      compatibility_date = "2025-01-01"
      env_vars = {
        TURN_KEY_ID        = { type = "plain_text", value = cloudflare_calls_turn_app.relay.uid }
        TURN_KEY_API_TOKEN = { type = "secret_text", value = cloudflare_calls_turn_app.relay.key }
      }
    }
  }
}

output "url" { value = "https://${cloudflare_pages_project.game.subdomain}" }
