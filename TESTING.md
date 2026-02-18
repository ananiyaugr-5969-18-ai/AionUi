# Testing Slack Integration on Windows

This PR adds Slack support to AionUi. Here's how to get a Windows .exe to test it locally.

## 🚀 Quick Start - Get Windows Executable

### Method 1: GitHub Actions (Easiest) ⭐

1. **Go to Actions tab** on GitHub
2. **Select "Manual Build for Testing"** workflow
3. **Click "Run workflow"**
4. **Configure:**
   - Platform: `windows-x64`
   - Branch: `copilot/add-slack-support`
5. **Wait ~15 minutes** for build to complete
6. **Download artifacts** from the workflow run
7. **Extract and run** the installer

### Method 2: Build Locally on Windows

See detailed instructions in [`WINDOWS_BUILD.md`](./WINDOWS_BUILD.md)

```bash
git clone https://github.com/ananiyaugr-5969-18-ai/AionUi.git
cd AionUi
git checkout copilot/add-slack-support
npm install
npm run build-win
```

Executable will be in `out/AionUi-{version}-win-x64.exe`

## 🧪 Testing Slack Integration

### Prerequisites
1. Create a Slack app at https://api.slack.com/apps
2. Enable Socket Mode and get:
   - Bot Token (`xoxb-...`)
   - App Token (`xapp-...`)
3. Install the app to your workspace

### Test Steps
1. **Launch AionUi**
2. **Go to:** Settings → Channels → Slack
3. **Enter credentials:**
   - Bot Token
   - App Token
   - Signing Secret (optional)
4. **Enable** the Slack plugin
5. **Test in Slack:**
   ```
   Send DM to bot: "Hello!"
   Or mention: "@AionUi help"
   ```

### Features to Test
- ✅ Direct messages
- ✅ @mentions in channels
- ✅ Button interactions
- ✅ Agent selection
- ✅ File attachments
- ✅ Long messages

## 📋 What's Included

- **Slack Plugin** implementation with Socket Mode
- **Message adapter** for Slack Block Kit format
- **Encrypted credential storage**
- **Full integration** with existing plugin system

## 📚 Documentation

- [Windows Build Guide](./WINDOWS_BUILD.md) - Complete build instructions
- [Slack Integration Guide](./SLACK_INTEGRATION_GUIDE.md) - Setup and usage (if exists)
- [Project README](./readme.md) - General documentation

## 🐛 Known Issues

- Windows SmartScreen may warn about unsigned executable (expected)
- First build may take 15-20 minutes
- Requires Visual Studio Build Tools for native modules

## 💡 Need Help?

- Can't build? → See [Troubleshooting](./WINDOWS_BUILD.md#troubleshooting)
- Want pre-built? → Use GitHub Actions workflow
- Found a bug? → Open an issue

---

**Note:** This is a development build from a feature branch. For production use, wait for the official release.
