# Prompt Library (Chrome MV3 Extension)

A Chrome Manifest V3 extension that stores, searches, and inserts reusable prompts into any web page.  
Supports local storage, optional Google Drive backup, encryption, and a recycle bin.

---

## Features
- **Side Panel UI**: Search, filter, favorite, hide, and clone prompts with modern, responsive design
- **Advanced Search**: Fuzzy search with relevance scoring, filters, and sorting options
- **Seed prompts**: Preloaded, read-only prompts for Sales, Finance, Engineering, and Operations
- **Smart Insertion**: Directly into the active field, with clipboard fallback
- **Optional Google Drive backup**: Store your library in your Drive `appDataFolder` for migration between devices
- **Optional encryption**: Encrypt user-created prompts with AES-GCM
- **Recycle bin**: Soft delete prompts; auto-purge after 30 days
- **Import/export**: Save or load your library as JSON with smart merging
- **Toast notifications**: User-friendly feedback for all operations
- **Brand-compliant UI**: Professional styling with your brand colors

---

## Quick Start

### 1. Clone and install dependencies
```bash
git clone https://github.com/Cursed-Stegosaurus/PromptManager.git
cd PromptManager
npm install
```

### 2. Configure OAuth Client ID (for Google Drive backup)
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable Google Drive API
4. Create OAuth 2.0 credentials
5. Update `public/manifest.json` with your client ID
6. Add `chrome-extension://<your-extension-id>` to authorized origins

### 3. Build and install
```bash
# Development build with watch mode
npm run dev

# Production build
npm run build

# Clean build directory
npm run clean
```

### 4. Install in Chrome
1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked" and select the `dist/` folder
4. The extension should now appear in your extensions list

---

## Development

### Project Structure
```
PromptManager/
├── public/                 # Static assets and HTML files
│   ├── assets/icons/      # Extension icons
│   ├── data/             # Seed prompts and data
│   ├── options/          # Options page
│   └── sidepanel/        # Side panel HTML and CSS
├── src/                   # TypeScript source code
│   ├── background/        # Background script
│   ├── content/          # Content scripts
│   ├── lib/              # Core libraries
│   ├── options/          # Options page logic
│   └── sidepanel/        # Side panel logic
├── scripts/               # Build and utility scripts
├── tests/                 # Unit tests
└── dist/                  # Built extension (generated)
```

### Available Scripts
- `npm run dev` - Development build with watch mode
- `npm run build` - Production build
- `npm run clean` - Clean build directory
- `npm run test` - Run tests in watch mode
- `npm run test:run` - Run tests once
- `npm run release` - Create release package

### Testing
```bash
# Run tests in watch mode
npm run test

# Run tests once
npm run test:run

# Run tests with coverage
npm run test -- --coverage
```

### Brand Guidelines
The extension uses your brand colors:
- **Primary**: #0075BA
- **Secondary**: #00A3E3  
- **Tertiary**: #313B4C
- **Background**: #f9f9f9

---

## Features in Detail

### Advanced Search
- **Fuzzy matching**: Find prompts even with typos
- **Relevance scoring**: Most relevant results first
- **Advanced filters**: `fav:true`, `tag:sales`, `category:engineering`
- **Sorting options**: By relevance, title, date, or favorites
- **Exact phrases**: Use quotes for exact matches

### Google Drive Integration
- Automatic backup to `appDataFolder`
- Smart merging with local changes
- Conflict resolution based on timestamps
- Secure OAuth2 authentication

### Encryption
- AES-GCM encryption for user prompts
- Automatic key generation and management
- Secure storage of sensitive content
- Optional for individual prompts

### Import/Export
- JSON format for easy sharing
- Smart merging with existing prompts
- Preserves metadata and timestamps
- Handles conflicts gracefully

---

## Release Process

### 1. Development
- Features developed in feature branches
- Tests written and passing
- Code reviewed and approved

### 2. Testing
- Local testing and validation
- Cross-browser compatibility check
- Performance testing

### 3. Release Build
```bash
npm run release [version]
# Example: npm run release 1.0.0
```

### 4. Chrome Web Store
- Upload as Unlisted for internal testing
- Share with team for feedback
- Change to Public when ready

---

## Troubleshooting

### Common Issues
1. **Extension not loading**: Check manifest.json syntax and file paths
2. **OAuth errors**: Verify client ID and authorized origins
3. **Storage issues**: Check IndexedDB permissions
4. **Build errors**: Ensure all dependencies are installed

### Debug Mode
- Enable Chrome DevTools for background script
- Check console for error messages
- Use Chrome extension debugging tools

---

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

---

## License

This project is proprietary software. All rights reserved.

---

## Support

For issues, questions, or feature requests, please contact the development team or create an issue in the repository.
