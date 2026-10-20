#Requires -Version 5.1
<#
.SYNOPSIS
Mirrors the committed tree of a Git ref to a second remote.

.DESCRIPTION
Builds a commit whose tree equals the tree of `-SourceRef`, then pushes that
commit to `-Remote`. The working tree and the real index are never read, so
uncommitted changes cannot enter the mirror.

The script builds the tree through a private index file that lives inside the
Git directory. A private index is the only safe way to do this: `git add -A`
against the real index would stage the user's work, and `git checkout --orphan`
would later delete the untracked files when the user switches back.

By default the script removes the documentation screen recordings. They are
about 250 MB and no part of the application reads them. Use `-IncludeMedia` to
keep them.

The pushed branch is a chain: each run makes a child of the previous run, so the
receiver can use `git pull`. Use `-Fresh` to start a new root commit instead.

.PARAMETER Remote
Name of the Git remote that receives the mirror. The remote must exist.

.PARAMETER SourceRef
The ref whose committed tree is mirrored. Defaults to `HEAD`.

.PARAMETER TargetBranch
The branch on `-Remote` that receives the mirror.

.PARAMETER LocalBranch
The local branch that records the mirror chain. Defaults to `gitee-mirror`.

.PARAMETER IncludeMedia
Keep the documentation screen recordings.

.PARAMETER Fresh
Make a root commit instead of a child. The receiver must then reset, because
the new commit has no relation to the old one.

.PARAMETER DryRun
Build and report. Do not write the local branch and do not push.

.PARAMETER Yes
Do not ask for confirmation before the push.

.PARAMETER Message
Commit message. Defaults to `chore: mirror the committed tree of <short sha>`.

.EXAMPLE
PS> .\docs\scripts\sync-gitee.ps1

Mirror `HEAD` into `gitee` `main`, without the documentation recordings.

.EXAMPLE
PS> .\docs\scripts\sync-gitee.ps1 -DryRun

Report what the next mirror sends. Change nothing.

.EXAMPLE
PS> .\docs\scripts\sync-gitee.ps1 -IncludeMedia -Yes

Mirror everything, including the recordings, without a prompt.
#>
[CmdletBinding()]
param(
  [string] $Remote = 'gitee',
  [string] $SourceRef = 'HEAD',
  [string] $TargetBranch = 'main',
  [string] $LocalBranch = 'gitee-mirror',
  [switch] $IncludeMedia,
  [switch] $Fresh,
  [switch] $DryRun,
  [switch] $Yes,
  [string] $Message
)

$ErrorActionPreference = 'Stop'

# Paths that hold the AIRI documentation recordings. The application does not
# read them, and they dominate the repository size.
$ExcludedPatterns = @(
  'docs/**/*.mp4'
  'docs/**/*.MP4'
  'docs/**/*.gif'
  'docs/**/*.avif'
)

function Invoke-Git {
  param(
    [Parameter(Mandatory)]
    [string[]] $Arguments,
    [switch] $AllowFailure
  )

  # `git` writes normal progress to stderr. PowerShell turns stderr into error
  # records, and `$ErrorActionPreference = 'Stop'` then aborts a successful
  # command. Lower the preference for the call and stringify the records.
  $previousPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & git @Arguments 2>&1 | ForEach-Object { $_.ToString() }
    $exitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousPreference
  }

  if ($exitCode -ne 0) {
    if ($AllowFailure) {
      return $null
    }
    throw ('git {0} failed with exit code {1}:{2}{3}' -f ($Arguments -join ' '), $exitCode, [Environment]::NewLine, ($output -join [Environment]::NewLine))
  }

  return $output
}

function Get-FirstLine {
  param([string[]] $Lines)
  if (-not $Lines) {
    return ''
  }
  return $Lines[0].Trim()
}

function Get-TreeStatistics {
  param([Parameter(Mandatory)] [string] $Tree)

  # `rev-list -l` counts an object once per path. Count each blob once so the
  # reported size matches what the push transfers.
  $sizes = @{}
  $files = 0
  $bytes = [int64]0

  foreach ($line in (Invoke-Git @('ls-tree', '-r', '-l', $Tree))) {
    if (-not $line) {
      continue
    }
    $split = $line -split "`t", 2
    $meta = ($split[0] -split '\s+')
    if ($meta.Count -lt 4) {
      continue
    }
    $files++
    $sha = $meta[2]
    if (-not $sizes.ContainsKey($sha)) {
      $sizes[$sha] = $true
      $bytes += [int64]$meta[3]
    }
  }

  return [pscustomobject]@{
    Files = $files
    Bytes = $bytes
  }
}

# --- Resolve the repository ---------------------------------------------------

$gitCommand = Get-Command git -ErrorAction SilentlyContinue
if (-not $gitCommand) {
  throw 'git is not on PATH.'
}

$repoRoot = Get-FirstLine (Invoke-Git @('rev-parse', '--show-toplevel'))
if (-not $repoRoot) {
  throw 'This directory is not inside a Git repository.'
}

$remoteUrl = Get-FirstLine (Invoke-Git @('remote', 'get-url', $Remote) -AllowFailure)
if (-not $remoteUrl) {
  throw ('The remote "{0}" does not exist. Add it first: git remote add {0} <url>' -f $Remote)
}

$sourceSha = Get-FirstLine (Invoke-Git @('rev-parse', '--verify', ($SourceRef + '^{commit}')))
$shortSha = Get-FirstLine (Invoke-Git @('rev-parse', '--short', $sourceSha))
$gitDir = Get-FirstLine (Invoke-Git @('rev-parse', '--absolute-git-dir'))

Write-Host ('Repository : {0}' -f $repoRoot)
Write-Host ('Remote     : {0} -> {1}' -f $Remote, $remoteUrl)
Write-Host ('Source     : {0} ({1})' -f $SourceRef, $shortSha)
Write-Host ('Target     : {0} / {1}' -f $Remote, $TargetBranch)
Write-Host ''

# --- Build the tree through a private index -----------------------------------

# Both the index file and the `GIT_INDEX_FILE` override are process state. Save
# and restore both so a failed run leaves no trace.
$indexPath = Join-Path $gitDir 'mirror-index'
$previousIndexVariable = $env:GIT_INDEX_FILE

if (Test-Path -LiteralPath $indexPath) {
  Write-Host ('Removing a stale private index: {0}' -f $indexPath)
  Remove-Item -LiteralPath $indexPath -Force
}

try {
  $env:GIT_INDEX_FILE = $indexPath

  Invoke-Git @('read-tree', $sourceSha) | Out-Null

  if (-not $IncludeMedia) {
    # `--ignore-unmatch` keeps the call valid when a pattern matches nothing.
    $removeArguments = @('rm', '-r', '--cached', '--ignore-unmatch', '--quiet') + $ExcludedPatterns
    Invoke-Git $removeArguments | Out-Null
  }

  $tree = Get-FirstLine (Invoke-Git @('write-tree'))
}
finally {
  if ($null -eq $previousIndexVariable) {
    Remove-Item Env:\GIT_INDEX_FILE -ErrorAction SilentlyContinue
  }
  else {
    $env:GIT_INDEX_FILE = $previousIndexVariable
  }
  Remove-Item -LiteralPath $indexPath -Force -ErrorAction SilentlyContinue
}

# --- Check that only the excluded recordings differ ---------------------------

$differences = Invoke-Git @('diff', '--name-status', $sourceSha, $tree)

# `--name-status` types the change before a tab. Only deletions are legal here,
# and every deleted path must sit under `docs/`.
$unexpectedChanges = @()
$unexpectedPaths = @()

foreach ($line in $differences) {
  if (-not $line) {
    continue
  }
  $split = $line -split "`t", 2
  $status = $split[0]
  $path = ''
  if ($split.Count -gt 1) {
    $path = $split[1].Trim('"')
  }

  if ($status -ne 'D') {
    $unexpectedChanges += $line
    continue
  }
  if (-not $path.StartsWith('docs/')) {
    $unexpectedPaths += $path
  }
}

if ($unexpectedChanges.Count -gt 0 -or $unexpectedPaths.Count -gt 0) {
  $message = 'The mirror tree differs from the source tree by more than the documentation recordings.'
  if ($unexpectedChanges.Count -gt 0) {
    $message += [Environment]::NewLine + 'Changes that are not deletions:'
    $message += [Environment]::NewLine + '  ' + ($unexpectedChanges -join ([Environment]::NewLine + '  '))
  }
  if ($unexpectedPaths.Count -gt 0) {
    $message += [Environment]::NewLine + 'Deletions outside docs/:'
    $message += [Environment]::NewLine + '  ' + ($unexpectedPaths -join ([Environment]::NewLine + '  '))
  }
  throw $message
}

$statistics = Get-TreeStatistics -Tree $tree

Write-Host ('Files      : {0}' -f $statistics.Files)
Write-Host ('Size       : {0:N1} MB' -f ($statistics.Bytes / 1MB))
Write-Host ('Removed    : {0} recordings' -f $differences.Count)
Write-Host ''

# --- Build the commit --------------------------------------------------------

$parentArguments = @()
$localBranchRef = 'refs/heads/' + $LocalBranch
$existingTip = Get-FirstLine (Invoke-Git @('rev-parse', '--verify', '--quiet', $localBranchRef) -AllowFailure)

if ($existingTip -and -not $Fresh) {
  $existingTree = Get-FirstLine (Invoke-Git @('rev-parse', ($existingTip + '^{tree}')))
  if ($existingTree -eq $tree) {
    Write-Host ('The branch {0} already holds this tree. Nothing to mirror.' -f $LocalBranch)
    return
  }
  $parentArguments = @('-p', $existingTip)
}

$commitMessage = $Message
if (-not $commitMessage) {
  $commitMessage = 'chore: mirror the committed tree of ' + $shortSha
}

$commitArguments = @('commit-tree', $tree) + $parentArguments + @('-m', $commitMessage)
$commit = Get-FirstLine (Invoke-Git $commitArguments)

Write-Host ('Commit     : {0}' -f $commit)
Write-Host ''

if ($DryRun) {
  Write-Host 'Dry run. The local branch and the remote are unchanged.'
  return
}

if (-not $Yes) {
  $answer = Read-Host ('Push {0} to {1}/{2}? Type yes to continue' -f $commit.Substring(0, 9), $Remote, $TargetBranch)
  if ($answer -ne 'yes') {
    Write-Host 'Stopped. Nothing was pushed.'
    return
  }
}

# --- Push --------------------------------------------------------------------

$remoteRef = 'refs/heads/' + $TargetBranch
$remoteLine = Get-FirstLine (Invoke-Git @('ls-remote', '--heads', $Remote, $remoteRef) -AllowFailure)

$pushArguments = @('push')
if ($remoteLine) {
  # Replacing the remote branch must only succeed while the remote still points
  # at the value we read. This prevents overwriting a concurrent push.
  $remoteSha = ($remoteLine -split '\s+')[0]
  $pushArguments += ('--force-with-lease=refs/heads/{0}:{1}' -f $TargetBranch, $remoteSha)
}
$pushArguments += $Remote
$pushArguments += ('{0}:{1}' -f $LocalBranch, $TargetBranch)

Write-Host ('Pushing to {0} ...' -f $remoteUrl)
$pushOutput = Invoke-Git $pushArguments
foreach ($line in $pushOutput) {
  Write-Host ('  {0}' -f $line)
}

# Advance the local branch only after the remote accepts the commit, so a failed
# push does not leave the chain ahead of the remote.
Invoke-Git @('update-ref', $localBranchRef, $commit) | Out-Null

Write-Host ''
Write-Host ('Done. {0}/{1} now holds {2}.' -f $Remote, $TargetBranch, $commit.Substring(0, 9))
