#!/usr/bin/env pwsh
# Install copilot-status-bar as your Copilot CLI status line (Windows / PowerShell).
#
# - Copies statusline\cop-statusline.js into ~\.copilot\hooks\
# - Patches ~\.copilot\settings.json so statusLine.command runs the script via Node
#
# Why "node <absolute-path>"? On Windows the Copilot CLI runs statusLine.command
# through cmd.exe. A bare ".js" path is handled by Windows Script Host (not Node),
# which produces no output, and "~" is not expanded by cmd.exe. Invoking Node
# explicitly with the resolved absolute path avoids both problems.
#
# Re-runnable: backs up settings.json to settings.json.bak before editing.

$ErrorActionPreference = 'Stop'

$PluginDir = Split-Path -Parent $PSScriptRoot
$ScriptSrc = Join-Path $PluginDir 'statusline\cop-statusline.js'
$CopilotDir = Join-Path $HOME '.copilot'
$HooksDir = Join-Path $CopilotDir 'hooks'
$Settings = Join-Path $CopilotDir 'settings.json'
$Dest = Join-Path $HooksDir 'cop-statusline.js'

if (-not (Test-Path -LiteralPath $ScriptSrc)) {
    Write-Error "error: $ScriptSrc not found"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "error: 'node' was not found on PATH. Install Node.js >= 18 and retry."
}

New-Item -ItemType Directory -Force -Path $HooksDir | Out-Null
Copy-Item -LiteralPath $ScriptSrc -Destination $Dest -Force
Write-Host "installed $Dest"

# Build the command Copilot will run. Forward slashes work for Node on Windows
# and the absolute path sidesteps cmd.exe's lack of "~" expansion.
$CommandPath = ($Dest -replace '\\', '/')
$Command = "node `"$CommandPath`""

$statusLine = [ordered]@{
    type    = 'command'
    command = $Command
    padding = 0
}

if (Test-Path -LiteralPath $Settings) {
    Copy-Item -LiteralPath $Settings -Destination "$Settings.bak" -Force
    $cfg = Get-Content -LiteralPath $Settings -Raw | ConvertFrom-Json
    if ($null -eq $cfg) { $cfg = [pscustomobject]@{} }
    if ($cfg.PSObject.Properties.Name -contains 'statusLine') {
        $cfg.statusLine = [pscustomobject]$statusLine
    } else {
        $cfg | Add-Member -NotePropertyName statusLine -NotePropertyValue ([pscustomobject]$statusLine)
    }
    ($cfg | ConvertTo-Json -Depth 20) + "`n" | Set-Content -LiteralPath $Settings -NoNewline
    Write-Host "patched $Settings (backup at $Settings.bak)"
} else {
    $cfg = [pscustomobject]@{ statusLine = [pscustomobject]$statusLine }
    ($cfg | ConvertTo-Json -Depth 20) + "`n" | Set-Content -LiteralPath $Settings -NoNewline
    Write-Host "created $Settings with statusLine configured"
}

Write-Host "done. restart 'copilot' to see the new status line."
