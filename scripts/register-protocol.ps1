param(
    [switch]$Unregister
)

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot

# Find electron.exe
$electronPath = Join-Path $projectRoot "node_modules\electron\dist\electron.exe"
if (-not (Test-Path $electronPath)) {
    Write-Error "electron.exe not found at $electronPath. Run npm install first."
    exit 1
}

if ($Unregister) {
    Write-Output "Removing RawTorrent magnet protocol registration..."
    Remove-Item -Path "HKCU:\Software\Classes\magnet" -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item -Path "HKCU:\Software\Classes\RawTorrent.magnet" -Recurse -Force -ErrorAction SilentlyContinue
    Write-Output "Done. Magnet links will no longer open in RawTorrent."
    exit 0
}

Write-Output "Registering RawTorrent as the magnet: protocol handler..."
Write-Output "Electron: $electronPath"
Write-Output "Project:  $projectRoot"

# Create the protocol key with display name
New-Item -Path "HKCU:\Software\Classes\magnet" -Force | Out-Null
Set-ItemProperty -Path "HKCU:\Software\Classes\magnet" -Name "(default)" -Value "URL:Magnet Link"
Set-ItemProperty -Path "HKCU:\Software\Classes\magnet" -Name "URL Protocol" -Value ""

# Friendly name for the "Open with" dialog
New-Item -Path "HKCU:\Software\Classes\magnet\Application" -Force | Out-Null
Set-ItemProperty -Path "HKCU:\Software\Classes\magnet\Application" -Name "ApplicationName" -Value "RawTorrent Engine"
Set-ItemProperty -Path "HKCU:\Software\Classes\magnet\Application" -Name "ApplicationIcon" -Value "$electronPath,0"
New-Item -Path "HKCU:\Software\Classes\magnet\DefaultIcon" -Force | Out-Null
Set-ItemProperty -Path "HKCU:\Software\Classes\magnet\DefaultIcon" -Name "(default)" -Value "$electronPath,0"

# Command to launch RawTorrent with the magnet link
$command = """$electronPath"" ""$projectRoot"" ""--"" ""%1"""
New-Item -Path "HKCU:\Software\Classes\magnet\shell\open\command" -Force | Out-Null
Set-ItemProperty -Path "HKCU:\Software\Classes\magnet\shell\open\command" -Name "(default)" -Value $command

# ProgID with RawTorrent name
New-Item -Path "HKCU:\Software\Classes\RawTorrent.magnet" -Force | Out-Null
Set-ItemProperty -Path "HKCU:\Software\Classes\RawTorrent.magnet" -Name "(default)" -Value "RawTorrent"

Write-Output ""
Write-Output "Registration complete! The browser should now show 'RawTorrent Engine' for magnet links."
Write-Output "Note: You may need to restart your browser for the change to take effect."
