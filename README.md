<div align="center">
  <h1>S25 Mac Sync 📱🔄💻</h1>
  <p><strong>A lightning-fast, beautiful, and reliable dual-pane file manager to sync files between your Mac and Samsung Galaxy S25 Ultra (or any Android device).</strong></p>
</div>

---

## ✨ Features

- **🚀 Dual-Pane Interface:** Browse your local macOS file system alongside your Android's internal storage simultaneously. No more endlessly opening different Finder and Android File Transfer windows.
- **⚡ Seamless Push & Pull:** Quickly drag, drop, push, and pull files from your Mac to your Android device with blazing-fast speeds via ADB.
- **📂 Finder-Style Selection:** Full support for multi-file selection using `Cmd`/`Ctrl` + `Click` and `Shift` + `Click` to make batch transfers a breeze.
- **📊 Real-Time Progress Tracking:** Monitor exactly what file is transferring and track overall batch transfer progress in real-time.
- **🚫 Safe Cancellations:** Built-in kill-switch to safely cancel large file transfers midway without corrupting your local storage.
- **📸 MediaStore Injection:** Intelligently registers photos and videos directly into the Android MediaStore database upon push, ensuring your phone's Gallery app immediately sees transferred media.

## 📥 Installation

### Option 1: Download Pre-built Release (Recommended)
1. Go to the [Releases](../../releases) tab on GitHub.
2. Download the latest `.dmg` file.
3. Open the `.dmg` and drag **S25 Mac Sync** to your `Applications` folder.

> [!WARNING]
> **macOS Unverified Developer Warning**
> Because this is a free, open-source tool, it is not signed with a paid Apple Developer certificate. When you open the app for the first time, macOS might show a warning that says "macOS cannot verify the developer of this app". 
> **To bypass this:** Simply **Right-Click** the app in your Applications folder and select **Open**. You will only need to do this once.

### Option 2: Build From Source
If you want to build the app from source yourself, ensure you have [Rust](https://rustup.rs/) and [Node.js](https://nodejs.org/) installed on your machine.

```bash
# Clone the repository
git clone https://github.com/ecjung97/mac-android-file-transfer.git
cd mac-android-file-transfer

# Install dependencies
npm install

# Build for macOS
npm run tauri build
```
The resulting `.app` and `.dmg` will be placed in `src-tauri/target/release/bundle/`.

## 🛠️ Prerequisites

This app utilizes `adb` (Android Debug Bridge) under the hood to handle transfers safely and securely. The app will automatically try to find `adb` in common locations like:
- `/opt/homebrew/bin/adb`
- `/usr/local/bin/adb`
- `~/Library/Android/sdk/platform-tools/adb`

If `adb` is not installed on your Mac, you can easily install it using Homebrew:
```bash
brew install android-platform-tools
```

**On your Android Device:**
1. Go to **Settings > About Phone > Software Information**.
2. Tap **Build Number** 7 times to enable Developer Options.
3. Go back to **Settings > Developer Options** and enable **USB Debugging**.
4. Plug your phone into your Mac and accept the USB Debugging prompt on your phone's screen.

## 💻 Tech Stack

- **Frontend:** [React 19](https://react.dev/), [TypeScript](https://www.typescriptlang.org/), [Vite](https://vitejs.dev/)
- **Backend:** [Rust](https://www.rust-lang.org/), [Tauri v2](https://tauri.app/)
- **Core Engine:** ADB (Android Debug Bridge) shell & file transfer APIs

## 📄 License

This project is licensed under the [MIT License](LICENSE). Free to use, modify, and distribute.
