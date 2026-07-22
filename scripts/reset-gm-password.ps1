# Resets an existing Game Master user's password in the LOCAL Supabase instance.
#
# Usage (from the repo root, with local Supabase running):
#   powershell -File .\scripts\reset-gm-password.ps1
#
# The email and replacement password are prompted for. The password is hidden
# and is not stored on disk.

$ErrorActionPreference = "Continue"
$statusEnv = pnpm dlx supabase status -o env 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Error "Could not read local Supabase status. Is 'supabase start' running?"
  return
}

$ErrorActionPreference = "Stop"
$svcLine = $statusEnv | Select-String '^SERVICE_ROLE_KEY='
$apiLine = $statusEnv | Select-String '^API_URL='
if (-not $svcLine -or -not $apiLine) {
  Write-Error "Could not read the local API URL or service-role key."
  return
}

$svc = $svcLine.ToString().Split('=', 2)[1].Trim('"')
$apiUrl = $apiLine.ToString().Split('=', 2)[1].Trim('"').TrimEnd('/')
$email = (Read-Host "GM email").Trim().ToLowerInvariant()

$headers = @{
  apikey = $svc
  Authorization = "Bearer $svc"
  "Content-Type" = "application/json"
}

try {
  $response = Invoke-RestMethod -Method Get `
    -Uri "$apiUrl/auth/v1/admin/users?per_page=1000" `
    -Headers $headers
  $user = $response.users | Where-Object { $_.email -eq $email } |
    Select-Object -First 1

  if (-not $user) {
    Write-Error "No local user exists for $email. Use create-gm-user.ps1 instead."
    return
  }

  $secure = Read-Host "New GM password (hidden)" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
    $body = @{ password = $password; email_confirm = $true } | ConvertTo-Json
    Invoke-RestMethod -Method Put `
      -Uri "$apiUrl/auth/v1/admin/users/$($user.id)" `
      -Headers $headers -Body $body | Out-Null
    Write-Host "Password reset for $email" -ForegroundColor Green
  } finally {
    if ($bstr -ne [IntPtr]::Zero) {
      [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
    $password = $null
    $body = $null
  }
} catch {
  Write-Host "Failed to reset the local GM password:" -ForegroundColor Red
  Write-Host $_.Exception.Message
  if ($_.ErrorDetails) { Write-Host $_.ErrorDetails.Message }
}
