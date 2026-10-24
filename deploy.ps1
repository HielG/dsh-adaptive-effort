# Deploy adaptive-effort.js into the DSH desktop profile.
# DSH composes its profile at boot, so restart the app afterwards.
$ErrorActionPreference = 'Stop'

$source = Join-Path $PSScriptRoot 'adaptive-effort.js'
$profileDir = Join-Path $env:USERPROFILE '.dsh\profiles\desktop'
$target = Join-Path $profileDir 'plugins\adaptive-effort.js'

New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
Copy-Item $source $target -Force
Write-Host "deployed: $target"

$patch = Join-Path $profileDir 'cordis.patch.yml'
if (-not (Select-String -Path $patch -Pattern 'adaptive-effort' -Quiet -ErrorAction SilentlyContinue)) {
    Write-Warning "no adaptive-effort row in $patch; add the insert block from README.md"
}

Write-Host 'restart DSH to load the new generation'
