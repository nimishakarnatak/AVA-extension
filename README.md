# Screen Recorder Chrome Extension

A Chrome extension for screen recording with ethical user interaction tracking.

## Features

- 🎥 Screen, window, and tab recording
- 📊 Optional user interaction tracking (clicks, scrolls, keystrokes)
- 🔒 Privacy-focused with explicit user consent
- 📱 Visual recording indicator
- 📁 Downloadable interaction logs

## Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" in the top right
3. Click "Load unpacked" and select this extension folder
4. The extension icon should appear in your toolbar

## Usage

1. Click the extension icon in the toolbar
2. Choose whether to enable interaction tracking
3. Click "Start Recording" and select what to record
4. Use your application normally
5. Click "Stop Recording" when done
6. Download the video file and interaction log

## Privacy & Ethics

- ✅ Explicit user consent required for interaction tracking
- ✅ Visual indicator when recording/tracking is active
- ✅ No external data transmission
- ✅ Transparent interaction logging
- ✅ User control over all features

## Files

- `manifest.json` - Extension configuration
- `background.js` - Recording and data management
- `content.js` - Page interaction tracking
- `popup.html/js` - User interface
- `styles/popup.css` - Interface styling

## Development

To modify the extension:
1. Make your changes
2. Go to `chrome://extensions/`
3. Click the refresh icon on your extension
4. Test your changes

## License

MIT License - See LICENSE file for details
