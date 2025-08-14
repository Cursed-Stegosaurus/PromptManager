# Icon Files

This directory contains the icon files for the Prompt Library extension.

## Icon Structure

### Extension Logo Icons
- `logo16.png` - 16x16 pixels (toolbar icon)
- `logo24.png` - 24x24 pixels (additional size)
- `logo32.png` - 32x32 pixels (Windows taskbar)
- `logo48.png` - 48x48 pixels (extension management page)
- `logo64.png` - 64x64 pixels (additional size)
- `logo128.png` - 128x128 pixels (Chrome Web Store)
- `logo256.png` - 256x256 pixels (high DPI displays)

### Action Button Icons
Each function has icons in multiple sizes (16, 24, 32, 48, 64, 128, 256):

- **Favorite (Starred)**: `fav-f*.png` (filled star)
- **Favorite (Unstarred)**: `fav-s*.png` (empty star)
- **Visibility**: `visible*.png` (eye open)
- **Hidden**: `hide*.png` (eye closed)
- **Clone**: `clone*.png` (copy icon)
- **Delete**: `delete*.png` (trash icon)
- **Restore**: `restore*.png` (restore icon)

## Icon Design Guidelines

- Use the brand colors: Primary #0075BA, Secondary #00A3E3
- Keep designs simple and recognizable at small sizes
- Use consistent stroke weights
- Ensure good contrast for accessibility
- Test visibility on both light and dark backgrounds

## Icon Creation

You can create these icons using:
- Figma, Sketch, or Adobe Illustrator
- Export as PNG with transparent backgrounds
- Ensure crisp edges at all sizes
- Consider using vector graphics for scalability

## File Naming Convention

All icons follow the pattern: `{function}{size}.png`
- Function: logo, fav-f, fav-s, visible, hide, clone, delete, restore
- Size: 16, 24, 32, 48, 64, 128, 256

Example: `fav-f16.png` = filled favorite icon at 16x16 pixels
