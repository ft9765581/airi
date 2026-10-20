#Requires -Version 5.1
<#
.SYNOPSIS
Creates a verified local account for the practice backend.

.DESCRIPTION
Runs the real sign-up endpoint, then signs in to prove that the account works.

The server now turns email verification off (`requireEmailVerification: false`
in `server/apps/auth/src/auth.ts`), so a sign-up returns a live session and this
script is only needed for scripting and for recreating an account.

The script still writes `email_verified` directly. Set that block aside when the
server requires verification again: with verification on, sign-in fails with
`EMAIL_NOT_VERIFIED` and the flag is the only way in without a mail service.

The password hash comes from Better Auth. The script does not write the password
column itself.

.EXAMPLE
PS> .\docs\scripts\create-local-account.ps1 -Email nurse@example.com

Create the account `nurse@example.com` with a generated password.

.EXAMPLE
PS> .\docs\scripts\create-local-account.ps1 -Email doctor@example.com -Password 'Airi-Local-2026' -Name 'Doctor'

Create the account with a fixed password.

.EXAMPLE
PS> .\docs\scripts\create-local-account.ps1 -Email nurse@example.com -ServerUrl http://localhost:3000

Target the API process directly instead of the Caddy gateway.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)]
  [string] $Email,

  # Omit to generate a random password. A generated password is printed once.
  [string] $Password,

  [string] $Name = 'Local User',

  [string] $ServerUrl = 'http://localhost:6112',

  # Container that runs the local PostgreSQL from `server/docker-compose.yaml`.
  [string] $DatabaseContainer = 'airi-pg',

  [string] $DatabaseUser = 'postgres',
  [string] $DatabaseName = 'postgres',

  # Delete an existing row for this address before the sign-up. The account and
  # the sessions cascade. Use it when the password is lost.
  [switch] $Recreate
)

$ErrorActionPreference = 'Stop'

function New-RandomPassword {
  param([int] $Length = 20)

  # Drop the characters that a shell, a URL, or a JSON string treats specially,
  # so the printed password can be pasted anywhere.
  $alphabet = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  $bytes = New-Object byte[] $Length
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $rng.GetBytes($bytes)

  $builder = New-Object System.Text.StringBuilder
  for ($i = 0; $i -lt $Length; $i++) {
    [void]$builder.Append($alphabet[$bytes[$i] % $alphabet.Length])
  }
  return $builder.ToString()
}

function Invoke-JsonPost {
  param(
    [Parameter(Mandatory)] [string] $Path,
    [Parameter(Mandatory)] $Body
  )

  # `curl.exe` reads the body from a file. Passing JSON as a command argument
  # lets PowerShell rewrite the quotes before curl sees them.
  $bodyFile = [System.IO.Path]::GetTempFileName()
  try {
    $json = $Body | ConvertTo-Json -Compress
    [System.IO.File]::WriteAllText($bodyFile, $json, (New-Object System.Text.UTF8Encoding($false)))

    $raw = & curl.exe -s -w "`n%{http_code}" -X POST ($ServerUrl + $Path) `
      -H 'Content-Type: application/json' `
      --data-binary "@$bodyFile" `
      --max-time 30 2>&1

    $lines = @($raw)
    $status = $lines[$lines.Count - 1]

    # The trailing newline that `-w` adds means a body-less response still
    # yields two lines. Guard the single-line case anyway.
    $text = ''
    if ($lines.Count -gt 1) {
      $text = ($lines[0..($lines.Count - 2)] -join "`n")
    }

    return [pscustomobject]@{
      Status = [int]$status
      Body = $text
    }
  }
  finally {
    Remove-Item -LiteralPath $bodyFile -Force -ErrorAction SilentlyContinue
  }
}

# --- Validate the inputs -------------------------------------------------------

$Email = $Email.Trim()
if ($Email -notmatch '^[^@\s]+@[^@\s]+\.[^@\s]+$') {
  throw ('"{0}" is not an email address.' -f $Email)
}

if (-not $Password) {
  $Password = New-RandomPassword
  Write-Host 'No password given. The script generated one.'
}

Write-Host ('Server  : {0}' -f $ServerUrl)
Write-Host ('Email   : {0}' -f $Email)
Write-Host ''

# --- Remove an existing row when asked ----------------------------------------

if ($Recreate) {
  # The address is validated above, so it cannot contain the quoting characters
  # that would break this statement.
  $deleteSql = "delete from ""user"" where lower(email) = lower('{0}');" -f $Email
  $deleteOutput = $deleteSql | docker exec -i $DatabaseContainer psql -U $DatabaseUser -d $DatabaseName -t 2>&1

  if ($LASTEXITCODE -ne 0) {
    throw ('The delete failed: {0}' -f (($deleteOutput -join ' ').Trim()))
  }

  Write-Host ('Removed : {0}' -f ((($deleteOutput -join ' ') -replace '\s+', ' ').Trim()))
  Write-Host ''
}

# --- Create the account --------------------------------------------------------

$signUp = Invoke-JsonPost -Path '/api/auth/sign-up/email' -Body @{
  email = $Email
  password = $Password
  name = $Name
}

if ($signUp.Status -eq 200) {
  # A 200 does not prove creation. Better Auth keeps the response shape stable
  # for an address that already exists, so it does not reveal which addresses
  # are registered. The sign-in check below is the real proof.
  Write-Host 'Sign-up : accepted.'
}
elseif ($signUp.Body -match 'USER_ALREADY_EXISTS|already exists') {
  Write-Host 'Sign-up : the address already exists. The script continues to the verification step.'
}
else {
  throw ('Sign-up failed with HTTP {0}: {1}' -f $signUp.Status, $signUp.Body)
}

# --- Mark the email as verified ------------------------------------------------

# The address is validated above, so it cannot contain the quoting characters
# that would break this statement.
$sql = "update ""user"" set email_verified = true where lower(email) = lower('{0}');" -f $Email
$update = $sql | docker exec -i $DatabaseContainer psql -U $DatabaseUser -d $DatabaseName -t 2>&1

if ($LASTEXITCODE -ne 0) {
  throw ('The database update failed: {0}' -f (($update -join ' ').Trim()))
}

$rowCount = (($update -join ' ') -replace '\s+', ' ').Trim()

if ($rowCount -notmatch 'UPDATE\s+1') {
  throw ('The update did not touch exactly one row. Output: {0}' -f $rowCount)
}

Write-Host 'Verified: email_verified is now true.'

# --- Prove the account can sign in --------------------------------------------

$signIn = Invoke-JsonPost -Path '/api/auth/sign-in/email' -Body @{
  email = $Email
  password = $Password
}

if ($signIn.Status -ne 200) {
  if ($signIn.Body -match 'INVALID_EMAIL_OR_PASSWORD') {
    throw ('The address already exists with a different password. Pass the original password with -Password, or delete the row first with -Recreate. Server said: {0}' -f $signIn.Body)
  }
  throw ('Sign-in failed with HTTP {0}: {1}' -f $signIn.Status, $signIn.Body)
}

Write-Host 'Sign-in : accepted.'
Write-Host ''
Write-Host 'Credentials'
Write-Host ('  email    : {0}' -f $Email)
Write-Host ('  password : {0}' -f $Password)
Write-Host ''
Write-Host 'Open the app, then sign in. The sign-in UI is the separate app on port 5173.'
