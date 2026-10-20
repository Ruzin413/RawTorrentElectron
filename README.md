#  RawTorrent Engine

**RawTorrent** is a premium, high-performance desktop torrent client. It combines a lightning-fast **C# .NET Engine** with a modern, sleek **Electron** frontend to deliver a truly state-of-the-art downloading experience.

##  Key Features

- **Premium UI**: A stunning, modern interface built with Syne & DM Sans typography, featuring subtle micro-animations and a sleek light-mode design.
- **Asynchronous Architecture**: Decoupled backend and frontend ensures the UI never flickers or freezes, even during heavy file I/O or multi-gigabit downloads.
- **Context-Menu Management**: Clean, distraction-free layout using right-click context menus for advanced management (Stop, Resume, Open Folder, Delete with Data).
- **Persistent Progress**: Remembers every download state using a lightweight CSV data store.
- **Self-Contained Setup**: Ships as a Windows installer and as Linux AppImage / `.deb` packages that include the .NET runtime—no external dependencies required.

##  Getting Started

### Installation

#### Windows
1. Download the latest **`RawTorrent-win-<version>.exe`** from the [Releases](https://github.com/Ruzin413/RawTorrentDesktop/releases) page.
2. Run the installer and follow the wizard.
3. Launch **RawTorrent** from your desktop and start downloading!

#### Linux (x64)
Download from the [Releases](https://github.com/Ruzin413/RawTorrentDesktop/releases) page:

- **Debian / Ubuntu (`.deb`)**:
  ```bash
  sudo apt install ./RawTorrent-linux-<version>-amd64.deb
  ```
  Then launch **RawTorrent** from your app menu, or run `rawtorrent`. The package registers RawTorrent as the handler for `magnet:` links and `.torrent` files.
- **Any distro (AppImage)**:
  ```bash
  chmod +x RawTorrent-linux-<version>-x86_64.AppImage
  ./RawTorrent-linux-<version>-x86_64.AppImage
  ```
  AppImages need FUSE 2 (`sudo apt install libfuse2t64` on Ubuntu 24.04+, `libfuse2` on older releases).

On Linux, app data (torrent list, progress, metadata cache, error log) is stored in `~/.local/share/RawTorrent`. The engine's console log is at `~/.config/rawtorrent-electron/logs/backend.log`.

### Development Setup
To run the project in development mode:
1. **Clone the repo**:
   ```bash
   git clone https://github.com/Ruzin413/RawTorrentDesktop.git
   ```
2. **Install dependencies**:
   ```bash
   npm install
   ```
3. **Launch the app**:
   ```bash
   npm run dev
   ```

### Building the Installers
Building needs the [.NET 10 SDK](https://dotnet.microsoft.com/download) and Node.js. Every build publishes the .NET backend as a self-contained single file, then packages it with Electron into `dist-installer/`.

| Target | Command | Run on | Output |
|---|---|---|---|
| Windows installer | `npm run build:win` | Windows | `RawTorrent-win-<version>.exe` |
| Linux AppImage + `.deb` | `npm run build:linux` | Linux | `RawTorrent-linux-<version>-x86_64.AppImage`, `RawTorrent-linux-<version>-amd64.deb` |
| Linux, from Windows | `npm run build:linux:wsl` | Windows with WSL | Same as above, copied back to `dist-installer/` |

AppImage and `.deb` packages can't be built natively on Windows, so `build:linux:wsl` syncs the project into a WSL distro (default `Ubuntu-24.04`, which needs `node`, `dotnet` and `rsync`), builds it there, and copies the packages back.

### Releasing
Releases are built automatically by GitHub Actions (`.github/workflows/release.yml`). Push a version tag and the workflow builds the Windows installer plus the Linux AppImage and `.deb`, then publishes them as a GitHub Release:
```bash
git tag v1.0.1
git push origin v1.0.1
```
The tag sets the app version. Tags with a suffix (e.g. `v1.1.0-beta.1`) are published as pre-releases. To test the build without releasing, run **Build & Release** manually from the Actions tab; the installers are attached to the run as artifacts.

##  Tech Stack

- **Frontend**: Electron, Vanilla JavaScript, CSS3 (Modern Typography & Grid).
- **Backend**: ASP.NET Core (C# .NET 10.0), hosted locally at `localhost:5000`.
- **Packaging**: Electron Builder (NSIS for Windows; AppImage and deb for Linux).
- **Data Persistence**: CSV-based storage for minimal overhead.

##  Author

**Rujin Manandhar**
-  [rzmdr413@gmail.com](mailto:rzmdr413@gmail.com)
-  [GitHub](https://github.com/Ruzin413)
-  [LinkedIn](https://www.linkedin.com/in/ruzin-mdr-393bb9380/)
- 📍 Kathmandu, Nepal

##  License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
