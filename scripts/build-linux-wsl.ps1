# Builds the Linux packages (AppImage + .deb) from Windows using WSL.
# electron-builder cannot create AppImage/deb on Windows (mksquashfs/fpm are Linux-only),
# so the repo is synced into the WSL filesystem, built there, and the artifacts copied back.
#
# Requirements inside the WSL distro: node/npm, .NET 10 SDK, rsync.
# Usage: powershell -ExecutionPolicy Bypass -File scripts/build-linux-wsl.ps1 [-Distro Ubuntu-24.04]
param(
    [string]$Distro = "Ubuntu-24.04",
    [string]$BuildDir = "~/rawtorrent-build"
)

$ErrorActionPreference = "Stop"
$repo = (Resolve-Path "$PSScriptRoot\..").Path
$repoWsl = (wsl -d $Distro -e wslpath -u ($repo -replace '\\', '/')).Trim()
$outDir = Join-Path $repo "dist-installer"

# The script goes to bash over stdin; PowerShell appends CRLF to the last line,
# so it ends with an explicit "exit" that is never followed by a stray CR.
$script = @"
set -e
export DOTNET_NOLOGO=1 DOTNET_CLI_TELEMETRY_OPTOUT=1
# Non-login shell: pick up nvm / dotnet-install locations, and never fall back to Windows tools under /mnt
[ -s "`$HOME/.nvm/nvm.sh" ] && . "`$HOME/.nvm/nvm.sh"
export PATH="`$HOME/.dotnet:`$PATH"
for tool in node npm dotnet rsync; do
  case "`$(command -v `$tool)" in
    /mnt/*|"") echo "Linux `$tool not found in WSL; install it first (see README)"; exit 1;;
  esac
done
mkdir -p $BuildDir
rsync -a --delete \
  --exclude node_modules --exclude dist-installer --exclude dist-backend \
  --exclude bin --exclude obj --exclude .vs --exclude .git \
  '$repoWsl/' $BuildDir/
cd $BuildDir
npm ci --no-audit --no-fund
npm run build:linux
mkdir -p '$repoWsl/dist-installer'
cp -f dist-installer/*.AppImage dist-installer/*.deb '$repoWsl/dist-installer/'
exit 0
"@
$script = ($script -replace "`r", "") + "`n"

Write-Host "Building Linux packages in WSL ($Distro)..."
$script | wsl -d $Distro -e bash -s
if ($LASTEXITCODE -ne 0) { throw "Linux build failed (exit code $LASTEXITCODE)" }

Write-Host "Linux packages copied to $outDir"
Get-ChildItem $outDir -Include *.AppImage, *.deb -File -Recurse | Select-Object Name, Length
