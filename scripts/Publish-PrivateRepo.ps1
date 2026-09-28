# Run from an extracted, reviewed source package. Never accepts or prints tokens.
[CmdletBinding()]
param([string]$Owner = 'Avrena', [string]$Name = 'tinfoil-windows')
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
function Invoke-Native {
  param([string]$Program, [string[]]$Arguments)
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Program failed with exit code $LASTEXITCODE. No subsequent step was run." }
}
if ($Owner -notmatch '^[A-Za-z0-9-]+$' -or $Name -notmatch '^[A-Za-z0-9_.-]+$') { throw 'Invalid repository name.' }
$Root = Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $Root
foreach ($Command in @('git', 'gh')) { if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) { throw "Install $Command first." } }
if (-not (Test-Path 'package-lock.json')) { throw 'Run npm run bootstrap first; review the generated exact dependency versions and lockfile.' }
# Refuse ancestor repositories as well as a pre-existing .git directory.
$Cursor = Get-Item -LiteralPath $Root
while ($null -ne $Cursor) {
  if (Test-Path (Join-Path $Cursor.FullName '.git')) { throw 'This directory is already inside a Git repository. Use a fresh extraction; nothing was changed.' }
  $Cursor = $Cursor.Parent
}
Invoke-Native 'gh' @('auth', 'status')
$Login = (& gh api user --jq '.login').Trim()
if ($LASTEXITCODE -ne 0 -or $Login -cne $Owner) { throw "Authenticated account must be $Owner; currently $Login. Organization creation is intentionally not supported by this helper." }
# Do not accidentally push to an existing public or unrelated repository.
$Repo = "$Owner/$Name"
& gh repo view $Repo --json nameWithOwner 2>$null | Out-Null
if ($LASTEXITCODE -eq 0) { throw "$Repo already exists. This script only creates new repositories." }
Invoke-Native 'git' @('init', '-b', 'main')
# Explicit source allowlist: no runtime vault, credentials, node_modules, build outputs, or local environment files.
$Allowed = @('.gitattributes', '.gitignore', '.github', 'package.json', 'package-lock.json', 'tsconfig.json', 'README.md', 'CHANGELOG.md', 'NOTICE.md', 'SECURITY.md', 'AGENTS.md', 'src', 'desktop', 'scripts', 'tests', 'docs', 'assets')
Invoke-Native 'git' (@('add', '--') + $Allowed)
Invoke-Native 'git' @('commit', '-m', 'feat: initialize private Tinfoil Windows workbench')
Invoke-Native 'gh' @('repo', 'create', $Repo, '--private', '--description', 'Unofficial Tinfoil AI desktop client for Windows 11', '--disable-wiki')
$Metadata = & gh repo view $Repo --json nameWithOwner,visibility
if ($LASTEXITCODE -ne 0) { throw 'Could not verify repository visibility. No source was pushed.' }
$Remote = $Metadata | ConvertFrom-Json
if ($Remote.nameWithOwner -cne $Repo -or $Remote.visibility -cne 'PRIVATE') { throw 'Private visibility verification failed. No source was pushed.' }
Invoke-Native 'git' @('remote', 'add', 'origin', "https://github.com/$Repo.git")
Invoke-Native 'git' @('push', '-u', 'origin', 'main')
Write-Host "Created and pushed private repository: https://github.com/$Repo"
