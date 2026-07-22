# Creates a single Game Master user in the LOCAL Supabase instance.
#
# Usage (from the repo root, with `pnpm dlx supabase start` already running):
#   pwsh ./scripts/create-gm-user.ps1
#   (or in Windows PowerShell 5.1:)  powershell -File .\scripts\create-gm-user.ps1
#
# You will be prompted for an email and a hidden password. Nothing is stored
# on disk. The user is created pre-confirmed so you can sign in immediately.

$ErrorActionPreference = "Stop"

# Pull the local service-role key straight from the running Supabase stack.
$statusEnv = pnpm dlx supabase status -o env 2>$null
$svcLine = $statusEnv | Select-String '^SERVICE_ROLE_KEY='
if (-not $svcLine) {
  Write-Error "Could not read SERVICE_ROLE_KEY. Is 'supabase start' running?"
  return
}
$svc = $svcLine.ToString().Split('=', 2)[1].Trim('"')

$email = Read-Host "GM email"
$secure = Read-Host "GM password (hidden)" -AsSecureString
$pw = [Runtime.InteropServices.Marshal]::PtrToStringAuto(
  [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
)

$headers = @{
  apikey          = $svc
  Authorization   = "Bearer $svc"
  "Content-Type"  = "application/json"
}
$body = @{ email = $email; password = $pw; email_confirm = $true } | ConvertTo-Json

try {
  $r = Invoke-RestMethod -Method Post `
    -Uri "http://127.0.0.1:54321/auth/v1/admin/users" `
    -Headers $headers -Body $body
  Write-Host "Created GM user: $($r.email)" -ForegroundColor Green
  Write-Host "You can now sign in at http://localhost:3000 with that email and password."
} catch {
  Write-Host "Failed to create user:" -ForegroundColor Red
  Write-Host $_.Exception.Message
  if ($_.ErrorDetails) { Write-Host $_.ErrorDetails.Message }
} finally {
  $pw = $null; $body = $null
}
