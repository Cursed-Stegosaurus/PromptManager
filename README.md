# Prompt Library Chrome Extension

A powerful Chrome extension for storing, searching, and inserting reusable prompts with optional encryption features.

## Features

- **Smart Search**: Find prompts quickly with advanced filtering (tags, favorites, hidden, recycle bin)
- **Prompt Management**: Create, edit, clone, hide, favorite, and delete prompts
- **Seed Prompts**: Pre-loaded professional templates for common use cases
- **Local Storage**: All data is stored locally in your browser for privacy
- **Import/Export**: Backup and restore prompts using JSON files
- **Encryption**: Optional encryption for sensitive user prompts
- **Recycle Bin**: Soft delete with automatic purging after 30 days
- **Context Menu**: Right-click to insert prompts anywhere on the web
- **Keyboard Shortcuts**: Quick access with Alt+P and Alt+I

## Installation

### Development Build

1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd PromptManager
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Build the extension:
   ```bash
   npm run build
   ```

4. Load in Chrome:
   - Open `chrome://extensions/`
   - Enable "Developer mode"
   - Click "Load unpacked"
   - Select the `dist` folder

### Production Build

1. Build for production:
   ```bash
   npm run build
   ```

2. Create release package:
   ```bash
   npm run release
   ```

## Usage

### Side Panel

- **Search**: Use the search bar with advanced filters:
  - `tag:sales` - Find prompts with specific tags
  - `fav:true` - Show only favorite prompts
  - `hidden:true` - Show hidden prompts
  - `bin:true` - Show deleted prompts

- **Prompt Actions**:
  - Click a prompt to view details
  - Use action buttons: ★ (favorite), 👁 (hide), 📋 (clone), 🗑 (delete), ↻ (restore)
  - Insert or copy prompts directly

### Options Page

- **Import/Export**: Backup and restore prompts as JSON files
- **Encryption**: Secure your prompts with a passphrase
- **Advanced Settings**: Configure auto-purge and analytics

### Context Menu

- Right-click in any text field
- Select "Insert Prompt" to use your last used prompt

### Keyboard Shortcuts

- `Alt+P`: Insert current prompt
- `Alt+I`: Copy current prompt to clipboard

## Development

### Project Structure

```
src/
├── background/          # Service worker
├── content/            # Content scripts
├── sidepanel/          # Side panel UI
├── options/            # Options page
└── lib/               # Shared utilities
    ├── schema.ts      # Data types
    ├── db.ts          # IndexedDB operations
    ├── searchWorker.ts # Search performance
    └── crypto.ts      # Encryption utilities
```

### Build Scripts

- `npm run build`: Build the extension
- `npm run watch`: Watch mode for development
- `npm run release`: Create production package

### Adding New Prompts

1. Edit `public/data/seed.json` for seed prompts
2. Use the side panel to create user prompts
3. Clone existing prompts to customize them

## Configuration

### Permissions

The extension requests these permissions:

- `storage`: Save prompts and settings
- `sidePanel`: Display the prompt library
- `scripting`: Insert prompts into web pages
- `activeTab`: Access current tab for insertion
- `contextMenus`: Right-click menu integration
- `clipboardWrite`: Copy prompts to clipboard

## Brand Colors

- **Primary**: #0075BA
- **Secondary**: #00A3E3
- **Tertiary**: #313B4C
- **Background**: #f9f9f9

## Troubleshooting

### Common Issues

1. **Extension won't load**: Check the build output and ensure all files are in the `dist` folder
2. **Search not working**: Verify the search worker is loading correctly
3. **Prompts not saving**: Check IndexedDB permissions and browser storage
4. **Import/Export issues**: Ensure JSON file format is correct

### Debug Mode

1. Open the side panel
2. Right-click and select "Inspect"
3. Check the console for errors
4. Use Chrome DevTools to debug

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

MIT License - see LICENSE file for details

## Support

For issues and questions:

1. Check the troubleshooting section
2. Search existing issues
3. Create a new issue with details

## Changelog

### v1.0.0
- Initial release
- Core prompt management
- Local storage with IndexedDB
- Import/Export functionality
- Encryption support
- Advanced search and filtering
- Context menu integration
