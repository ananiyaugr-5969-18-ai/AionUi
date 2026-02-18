# Windows Build Guide for Local Testing

This guide explains how to build AionUi as a Windows executable (.exe) for local testing.

## Prerequisites

### Required Software
1. **Windows 10/11** (64-bit)
2. **Node.js 22.x** or later
   - Download from: https://nodejs.org/
   - Verify installation: `node --version`
3. **Git**
   - Download from: https://git-scm.com/download/win
4. **Visual Studio Build Tools** (for native modules)
   - Download from: https://visualstudio.microsoft.com/downloads/
   - Install "Desktop development with C++" workload

## Quick Start - Get Pre-Built Executables

### Option 1: GitHub Actions (Recommended)

1. Go to the repository on GitHub
2. Navigate to **Actions** tab
3. Select **"Manual Build for Testing"** workflow
4. Click **"Run workflow"**
5. Select:
   - **Platform:** `windows-x64` (or `windows-arm64` for ARM devices)
   - **Branch:** `copilot/add-slack-support` (or leave empty for current branch)
6. Click **"Run workflow"** button
7. Wait for the build to complete (~10-15 minutes)
8. Download the artifacts from the workflow run page
9. Extract the ZIP file and run the installer or portable .exe

### Option 2: Download from Releases

Check the [Releases page](https://github.com/ananiyaugr-5969-18-ai/AionUi/releases) for pre-built executables.

## Build Locally on Windows

### Step 1: Clone the Repository

```bash
# Clone the repository
git clone https://github.com/ananiyaugr-5969-18-ai/AionUi.git
cd AionUi

# Checkout the Slack support branch
git checkout copilot/add-slack-support
```

### Step 2: Install Dependencies

```bash
# Install all dependencies
npm install
```

This may take 5-10 minutes depending on your internet connection.

### Step 3: Build the Application

```bash
# Build Windows executable (64-bit)
npm run build-win
```

The build process will:
- Compile TypeScript code
- Bundle the application with Webpack
- Package the Electron app
- Create installers and portable executables

**Build time:** 10-20 minutes (first build may take longer)

### Step 4: Find Your Executables

After a successful build, you'll find the executables in the `out` directory:

```
out/
├── AionUi-{version}-win-x64.exe      # NSIS installer
├── AionUi-{version}-win-x64.zip      # Portable version (extract and run)
└── make/                              # Additional build artifacts
```

### Step 5: Test the Application

#### Option A: Use the Installer
1. Run `AionUi-{version}-win-x64.exe`
2. Follow the installation wizard
3. Launch AionUi from the Start Menu or Desktop shortcut

#### Option B: Use Portable Version
1. Extract `AionUi-{version}-win-x64.zip`
2. Navigate to the extracted folder
3. Run `AionUi.exe`

## Testing Slack Integration

1. **Launch AionUi**
2. **Go to Settings** → **Channels** → **Slack**
3. **Enter your Slack credentials:**
   - Bot Token (starts with `xoxb-`)
   - App Token (starts with `xapp-`)
   - Signing Secret (optional)
4. **Enable the plugin**
5. **Test in Slack:**
   - Send a direct message to your bot
   - Or mention the bot in a channel: `@YourBot hello`

## Alternative Build Commands

### Build for ARM64 Windows
```bash
npm run build-win -- arm64 --win --arm64
```

### Build Multiple Formats
```bash
# NSIS installer + ZIP
npm run build-win

# NSIS installer only
node scripts/build-with-builder.js x64 --win --x64 --targets nsis

# ZIP only (portable)
node scripts/build-with-builder.js x64 --win --x64 --targets zip
```

### Development Build (Faster)
```bash
# Run without building executable (for development)
npm start
```

## Troubleshooting

### Build Fails with "Python not found"
- Install Python 3.x from https://www.python.org/
- Add Python to PATH during installation

### Build Fails with "MSBuild not found"
- Install Visual Studio Build Tools
- Ensure "Desktop development with C++" is installed

### Build Fails with "npm ERR! gyp"
```bash
# Clean and rebuild
npm cache clean --force
rm -rf node_modules package-lock.json
npm install
```

### Out of Memory During Build
```bash
# Increase Node.js memory limit
$env:NODE_OPTIONS="--max-old-space-size=4096"
npm run build-win
```

### Antivirus Blocking Build
- Add the project folder to your antivirus exclusions
- Windows Defender may flag unsigned executables (this is normal)

## Build Artifacts Explanation

| File | Description | Best For |
|------|-------------|----------|
| `.exe` (NSIS) | Full installer with Start Menu shortcuts | General distribution |
| `.zip` | Portable version, no installation needed | Quick testing, USB drives |
| `.msi` | Windows Installer format | Enterprise deployments |

## Clean Build

If you need to start fresh:

```bash
# Remove build artifacts
rm -rf out
rm -rf .webpack
rm -rf node_modules

# Reinstall and rebuild
npm install
npm run build-win
```

## Getting Help

- **Issues:** https://github.com/ananiyaugr-5969-18-ai/AionUi/issues
- **Discussions:** https://github.com/ananiyaugr-5969-18-ai/AionUi/discussions
- **Documentation:** See project README.md

## Build Configuration

The Windows build is configured in:
- `electron-builder.yml` - Main build configuration
- `forge.config.ts` - Electron Forge configuration
- `scripts/build-with-builder.js` - Build script

## System Requirements

**Minimum:**
- Windows 10 version 1809 or later
- 4 GB RAM
- 500 MB disk space

**Recommended:**
- Windows 11
- 8 GB RAM
- 1 GB disk space
- SSD for better performance

## Security Note

The built executable is not code-signed. Windows SmartScreen may show a warning on first run. This is expected for unsigned applications. Click "More info" → "Run anyway" to proceed.

To get rid of warnings, the app needs to be code-signed with a valid certificate (requires purchasing a code signing certificate from a trusted CA).
