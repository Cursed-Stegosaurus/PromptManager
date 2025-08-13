#!/usr/bin/env node

import { execSync } from 'child_process';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const rootDir = join(__dirname, '..');

// Configuration
const config = {
  version: process.argv[2] || '1.0.0',
  outputDir: join(rootDir, 'dist'),
  releaseDir: join(rootDir, 'release'),
  zipName: 'prompt-library-extension.zip'
};

console.log(`🚀 Building release version ${config.version}...`);

// Ensure output directory exists
if (!existsSync(config.outputDir)) {
  console.log('❌ Build directory not found. Run "npm run build" first.');
  process.exit(1);
}

// Create release directory
if (!existsSync(config.releaseDir)) {
  mkdirSync(config.releaseDir, { recursive: true });
}

// Update version in manifest.json
const manifestPath = join(config.outputDir, 'manifest.json');
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  manifest.version = config.version;
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(`✅ Updated manifest.json version to ${config.version}`);
}

// Create release notes
const changelogPath = join(rootDir, 'CHANGELOG.md');
let releaseNotes = '';
if (existsSync(changelogPath)) {
  const changelog = readFileSync(changelogPath, 'utf8');
  const versionMatch = changelog.match(new RegExp(`## \\[${config.version.replace(/\./g, '\\.')}\\]([\\s\\S]*?)(?=## \\[|$)`));
  if (versionMatch) {
    releaseNotes = versionMatch[1].trim();
  }
}

// Create release info file
const releaseInfo = {
  version: config.version,
  buildDate: new Date().toISOString(),
  releaseNotes: releaseNotes || 'No release notes available',
  files: []
};

// List all files in dist directory
function listFiles(dir, baseDir = '') {
  const files = [];
  const items = readdirSync(dir);
  
  for (const item of items) {
    const fullPath = join(dir, item);
    const relativePath = join(baseDir, item);
    
    if (statSync(fullPath).isDirectory()) {
      files.push(...listFiles(fullPath, relativePath));
    } else {
      files.push(relativePath);
    }
  }
  
  return files;
}

try {
  const { readdirSync, statSync } = await import('fs');
  releaseInfo.files = listFiles(config.outputDir);
} catch (error) {
  console.log('⚠️  Could not list files for release info');
}

// Write release info
writeFileSync(
  join(config.releaseDir, 'release-info.json'),
  JSON.stringify(releaseInfo, null, 2)
);

// Create zip file
try {
  const zipPath = join(config.releaseDir, config.zipName);
  
  // Use PowerShell on Windows, zip on Unix
  if (process.platform === 'win32') {
    const powershellCmd = `Compress-Archive -Path "${config.outputDir}\\*" -DestinationPath "${zipPath}" -Force`;
    execSync(`powershell -Command "${powershellCmd}"`, { stdio: 'inherit' });
  } else {
    execSync(`cd "${config.outputDir}" && zip -r "${zipPath}" .`, { stdio: 'inherit' });
  }
  
  console.log(`✅ Created release package: ${zipPath}`);
} catch (error) {
  console.log('❌ Failed to create zip file:', error.message);
  console.log('💡 You can manually zip the dist/ folder contents');
}

// Create installation instructions
const installInstructions = `# Prompt Library Extension - Installation

## Version ${config.version}
Built on: ${new Date().toLocaleDateString()}

## Installation Steps

1. Download and extract the zip file
2. Open Chrome and go to chrome://extensions/
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked" and select the extracted folder
5. The extension should now appear in your extensions list

## Features
- Side panel interface for prompt management
- Search and filter prompts
- Import/export functionality
- Optional Google Drive backup
- Optional encryption for user prompts

## Support
For issues or questions, please refer to the project documentation.

## Files Included
${releaseInfo.files.map(file => `- ${file}`).join('\n')}
`;

writeFileSync(join(config.releaseDir, 'INSTALL.md'), installInstructions);

console.log('\n🎉 Release build completed successfully!');
console.log(`📁 Release files are in: ${config.releaseDir}`);
console.log(`📦 Package: ${join(config.releaseDir, config.zipName)}`);
console.log(`📋 Install instructions: ${join(config.releaseDir, 'INSTALL.md')}`);
console.log('\nNext steps:');
console.log('1. Test the extension locally');
console.log('2. Upload to Chrome Web Store as Unlisted');
console.log('3. Share with internal team for testing');
