# Push Supabase migrations to the remote project in .env (bdfzckpwasyycwjggsfb)
#
# Prerequisites:
#   1. npx supabase login   (browser — use the account that owns the project)
#   2. Database password from: Supabase Dashboard → Project Settings → Database
#
# Usage:
#   $env:SUPABASE_DB_PASSWORD = "your-db-password"
#   .\scripts\supabase-db-push.ps1

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

$projectRef = "bdfzckpwasyycwjggsfb"
if (-not $env:SUPABASE_DB_PASSWORD) {
  Write-Host "Set your database password first:" -ForegroundColor Yellow
  Write-Host '  $env:SUPABASE_DB_PASSWORD = "your-password-from-supabase-dashboard"' -ForegroundColor Cyan
  exit 1
}

Write-Host "Linking project $projectRef ..." -ForegroundColor Cyan
npx supabase link --project-ref $projectRef -p $env:SUPABASE_DB_PASSWORD

Write-Host "Pushing migrations ..." -ForegroundColor Cyan
npx supabase db push --linked --yes

Write-Host "Done." -ForegroundColor Green
