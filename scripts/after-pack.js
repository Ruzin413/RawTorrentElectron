// electron-builder afterPack hook: Linux packaging fixes.
// 1. Make the bundled .NET backend executable (exec bits are lost when the backend
//    is published on Windows or copied through a Windows filesystem).
// 2. Wrap the Electron binary so AppImage launches pass --no-sandbox. AppImages are
//    mounted nosuid, so chrome-sandbox can't be setuid, and Ubuntu 24.04+ blocks the
//    user-namespace fallback; without this the AppImage aborts on start.
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'linux') return;

  const appOutDir = context.appOutDir;
  const backend = path.join(appOutDir, 'resources', 'backend', 'TorServices');
  if (fs.existsSync(backend)) fs.chmodSync(backend, 0o755);

  const executableName = context.packager.executableName;
  const binary = path.join(appOutDir, executableName);
  const realBinary = `${binary}.bin`;
  if (!fs.existsSync(binary) || fs.existsSync(realBinary)) return;

  fs.renameSync(binary, realBinary);
  fs.chmodSync(realBinary, 0o755);
  fs.writeFileSync(binary, [
    '#!/bin/sh',
    'HERE="$(dirname "$(readlink -f "$0")")"',
    'if [ -n "$APPIMAGE" ]; then',
    `  exec "$HERE/${executableName}.bin" --no-sandbox "$@"`,
    'fi',
    `exec "$HERE/${executableName}.bin" "$@"`,
    ''
  ].join('\n'));
  fs.chmodSync(binary, 0o755);
};
