# ⚡ RawTorrent Engine

**RawTorrent** is a premium, high-performance desktop torrent client. It combines a lightning-fast **C# .NET Engine** with a modern, sleek **Electron** frontend to deliver a truly state-of-the-art downloading experience.

## ✨ Key Features

- **Premium UI**: A stunning, modern interface built with Syne & DM Sans typography, featuring subtle micro-animations and a sleek light-mode design.
- **Asynchronous Architecture**: Decoupled backend and frontend ensures the UI never flickers or freezes, even during heavy file I/O or multi-gigabit downloads.
- **Context-Menu Management**: Clean, distraction-free layout using right-click context menus for advanced management (Stop, Resume, Open Folder, Delete with Data).
- **Persistent Progress**: Remembers every download state using a lightweight CSV data store.
- **Self-Contained Setup**: Bundled as a professional Windows installer that includes all necessary .NET runtimes—no external dependencies required.

## 🚀 Getting Started

### Installation
1. Download the latest **`RawTorrent_Setup.exe`** from the [Releases](https://github.com/Ruzin413/RawTorrentDesktop/releases) page.
2. Run the installer and follow the wizard.
3. Launch **RawTorrent** from your desktop and start downloading!

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

### Building the Installer
To generate your own professional setup wizard:
```bash
npm run build
```
This will compile the .NET backend and package the Electron app into a single installer found in the `dist-installer/` folder.

## 🛠️ Tech Stack

- **Frontend**: Electron, Vanilla JavaScript, CSS3 (Modern Typography & Grid).
- **Backend**: ASP.NET Core (C# .NET 10.0), hosted locally at `localhost:5000`.
- **Packaging**: Electron Builder & NSIS.
- **Data Persistence**: CSV-based storage for minimal overhead.

## 👤 Author

**Rujin Manandhar**
- 📧 [rzmdr413@gmail.com](mailto:rzmdr413@gmail.com)
- 🔗 [GitHub](https://github.com/Ruzin413)
- 🔗 [LinkedIn](https://www.linkedin.com/in/ruzin-mdr-393bb9380/)
- 📍 Kathmandu, Nepal

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
