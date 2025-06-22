# Codebase Exporter Feature

This VS Code extension now includes a powerful **Codebase Exporter** feature that allows you to export your entire workspace to a single, well-formatted markdown file.

## Features

### 🚀 Core Functionality
- **One-Click Export**: Export your entire codebase to markdown with a single command
- **Smart File Filtering**: Automatically excludes binary files, build directories, and respects .gitignore
- **Syntax Highlighting**: Each file is formatted as a markdown code block with proper language detection
- **Table of Contents**: Automatically generated navigation for easy browsing
- **Progress Tracking**: Visual progress indicator during export process

### 🎯 File Filtering
- **Respects .gitignore**: Automatically excludes files and directories listed in .gitignore
- **Binary File Detection**: Intelligently skips binary files (images, executables, etc.)
- **Common Exclusions**: Excludes `node_modules`, `.git`, `build`, `dist`, `.vscode`, `.idea`, and other common non-source directories
- **Customizable Patterns**: Configure your own include/exclude patterns via VS Code settings
- **File Size Limits**: Configurable maximum file size to prevent including huge files

### 📝 Output Format
- **Metadata Header**: Includes export timestamp, workspace name, and file count
- **Organized Structure**: Files grouped by directory with clear navigation
- **Proper Formatting**: Each file formatted with correct syntax highlighting based on extension
- **Customizable Naming**: Template-based file naming with timestamp and workspace name support

### ⚙️ Configuration Options
All settings are available under `Codebase Exporter` in VS Code settings:

- `codebaseExporter.defaultExportPath`: Default save location for exports
- `codebaseExporter.respectGitignore`: Whether to respect .gitignore rules (default: true)
- `codebaseExporter.includePatterns`: File patterns to include in export
- `codebaseExporter.excludePatterns`: File patterns to exclude from export
- `codebaseExporter.maxFileSize`: Maximum file size to include (default: 1MB)
- `codebaseExporter.includeTableOfContents`: Whether to include table of contents (default: true)
- `codebaseExporter.fileNameTemplate`: Template for exported file names

## How to Use

### Command Palette
1. Open Command Palette (`Ctrl+Shift+P` / `Cmd+Shift+P`)
2. Type "Export Codebase" and choose from:
   - **Export Codebase to Markdown**: Direct export to file
   - **Export Codebase to Markdown (with Preview)**: Preview before saving
   - **Configure Codebase Export Settings**: Open settings

### Quick Export
1. Press `Ctrl+Shift+P` and type "Export Codebase to Markdown"
2. Choose save location when prompted
3. Wait for the export to complete
4. Open the generated markdown file or reveal in explorer

### Preview Mode
1. Use "Export Codebase to Markdown (with Preview)" command
2. Review the generated content in VS Code
3. Choose to save, configure settings, or close preview

## Example Output

```markdown
# Codebase Export

**Generated:** 2024-06-22 14:30:00  
**Workspace:** my-awesome-project  
**Total Files:** 15  

---

## Table of Contents

### src
- [index.js](#srcindexjs)
- [utils.ts](#srcutilsts)
- [components.jsx](#srccomponentsjsx)

### docs
- [README.md](#docsreadmemd)

---

## Files

### src/index.js {#srcindexjs}

```javascript
console.log("Hello World!");
// Main application entry point
function main() {
    // Application logic here
}
```

### src/utils.ts {#srcutilsts}

```typescript
export function add(a: number, b: number): number {
    return a + b;
}
```
```

## Default File Patterns

### Included by Default
- JavaScript/TypeScript: `*.js`, `*.ts`, `*.jsx`, `*.tsx`
- Python: `*.py`
- Java: `*.java`
- C/C++: `*.c`, `*.cpp`, `*.h`, `*.hpp`
- C#: `*.cs`
- PHP: `*.php`
- Ruby: `*.rb`
- Go: `*.go`
- Rust: `*.rs`
- Swift: `*.swift`
- Kotlin: `*.kt`
- Scala: `*.scala`
- Web: `*.html`, `*.css`, `*.scss`, `*.sass`, `*.less`
- Config: `*.json`, `*.yaml`, `*.yml`, `*.xml`
- Documentation: `*.md`, `*.txt`

### Excluded by Default
- `**/node_modules/**`
- `**/.git/**`
- `**/build/**`
- `**/dist/**`
- `**/out/**`
- `**/.vscode/**`
- `**/.idea/**`
- `**/target/**`
- `**/bin/**`
- `**/obj/**`

## Error Handling

The exporter gracefully handles:
- **Permission Errors**: Skips files that can't be read due to permissions
- **Missing .gitignore**: Works fine even if .gitignore doesn't exist
- **Large Files**: Excludes files larger than the configured limit
- **Binary Files**: Automatically detects and skips binary content
- **Empty Workspaces**: Validates that exportable files exist before proceeding

## Tips

1. **Large Codebases**: For very large projects, consider adjusting the include patterns to focus on specific file types
2. **Custom Filters**: Use the settings to create project-specific include/exclude patterns
3. **Preview First**: Use preview mode for large exports to review before saving
4. **Regular Exports**: Set up a consistent naming template to track exports over time
5. **Documentation**: The exported markdown is perfect for code reviews, documentation, or AI analysis

## Troubleshooting

### No Files Found
- Check your include patterns in settings
- Verify the workspace contains the expected file types
- Ensure files aren't being excluded by .gitignore or exclude patterns

### Export Too Large
- Reduce the maximum file size limit
- Add more specific exclude patterns
- Use include patterns to focus on specific directories

### Performance Issues
- Large codebases may take time to process
- Consider excluding large directories like `node_modules` (done by default)
- Use more specific include patterns to reduce the number of files processed

---

*This feature integrates seamlessly with your existing VS Code workflow and respects your project's structure and conventions.*
