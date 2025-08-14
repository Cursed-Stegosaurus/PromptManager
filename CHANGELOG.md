# Changelog

All notable changes to the Prompt Library Chrome extension will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial development setup
- Core extension structure

## [1.0.0] - 2024-01-01

### Added
- **Core Functionality**
  - Prompt storage and management using IndexedDB
  - Advanced search with filtering (tags, favorites, hidden, recycle bin)
  - Prompt actions: create, edit, clone, hide, favorite, delete, restore
  
- **User Interface**
  - Modern side panel with brand colors
  - Responsive design with focus states
  - Toast notifications for user feedback
  - Keyboard shortcuts (Alt+P, Alt+I)
  
- **Search & Performance**
  - Web worker for smooth search performance
  - Support for large prompt libraries (5,000+ prompts)
  - Advanced query syntax (tag:, fav:true, hidden:true, bin:true)
  
- **Data Management**
  - Seed prompts for common use cases
  - Import/export functionality with JSON files
  - Merge functionality with conflict resolution
  - Local backup before any merge operations
  
- **Google Drive Integration**
  - Automatic backup to Google Drive
  - Restore from Drive backups
  - OAuth2 authentication
  
- **Security & Privacy**
  - Optional encryption for user prompts
  - PBKDF2 key derivation (200k iterations)
  - AES-GCM encryption
  - Seed prompts remain unencrypted
  
- **Recycle Bin**
  - Soft delete with recovery
  - Automatic purging after configurable days (default: 30)
  - Scheduled cleanup via Chrome alarms
  
- **Context Menu**
  - Right-click integration for prompt insertion
  - Support for various input types (text, textarea, contenteditable)
  - Clipboard fallback when direct insertion fails
  
- **Settings & Configuration**
  - Comprehensive options page
  - Theme support (system/light/dark)
  - Telemetry controls
  - Customizable auto-purge settings

### Technical Features
- **Build System**
  - ESBuild for fast TypeScript compilation
  - Watch mode for development
  - Production build optimization
  - Release packaging with versioning
  
- **Architecture**
  - Chrome MV3 service worker
  - Modular TypeScript codebase
  - Strict Content Security Policy
  - No inline scripts or eval
  
- **Performance**
  - Lazy loading of prompts
  - Efficient database queries with indexes
  - Background processing for heavy operations
  - Memory-conscious data structures

### Security
- **Permissions**
  - Minimal required permissions
  - No host permissions by default
  - Secure OAuth2 implementation
  - Encrypted local storage option
  
- **Data Protection**
  - User data isolation
  - Secure key derivation
  - No passphrase storage
  - Audit trail for data changes

### Browser Support
- Chrome 114+ (MV3)
- Edge 114+ (Chromium-based)
- Other Chromium-based browsers

## [0.1.0] - 2024-01-01

### Added
- Project initialization
- Basic extension structure
- Development environment setup
