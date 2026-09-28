# Read-only checks and explicit local build. Never signs in, publishes or alters a repository.
[CmdletBinding()]
param([switch]$Bootstrap, [switch]$Package)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Split-Path $PSScriptRoot -Parent)
function Invoke-Step {
  param([string]$Program, [string[]]$Arguments)
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) { throw "$Program failed ($LASTEXITCODE). Subsequent steps were not run." }
}
foreach ($Name in @('node', 'npm.cmd')) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { throw 'Install Node.js 22.12 or newer, reopen PowerShell, and retry.' }
}
if ($Bootstrap) { Invoke-Step 'npm.cmd' @('run','bootstrap') }
Invoke-Step 'npm.cmd' @('run','doctor')
Invoke-Step 'npm.cmd' @('test')
Invoke-Step 'npm.cmd' @('run','smoke:desktop')
if ($Package) { Invoke-Step 'npx.cmd' @('--no-install','electron-builder','--win','--x64','--publish','never') }
Write-Host 'Local checks finished. The custom system prompt is optional and not required.'
Write-Host 'Live sign-in, inference and the manual UX acceptance checklist are separate checks in docs/HANDOFF.md.'
if ($Package) { Write-Host 'Installer and portable artifacts: release\ (unsigned unless you configured signing).' }
