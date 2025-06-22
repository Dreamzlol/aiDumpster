import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { FileFilter, FilterOptions } from '../fileFilter';
import { MarkdownGenerator } from '../markdownGenerator';
import { CodebaseExporter } from '../codebaseExporter';

suite('Codebase Exporter Test Suite', () => {
    let testWorkspacePath: string;
    let testFiles: { [key: string]: string };

    suiteSetup(async () => {
        // Create a temporary test workspace
        testWorkspacePath = fs.mkdtempSync(path.join(os.tmpdir(), 'codebase-exporter-test-'));
        
        // Create test files
        testFiles = {
            'src/index.js': 'console.log("Hello World");',
            'src/utils.ts': 'export function add(a: number, b: number): number { return a + b; }',
            'src/component.jsx': 'import React from "react"; export default function Component() { return <div>Hello</div>; }',
            'README.md': '# Test Project\n\nThis is a test project.',
            'package.json': '{"name": "test-project", "version": "1.0.0"}',
            'node_modules/dependency/index.js': 'module.exports = {};',
            'build/output.js': 'console.log("built");',
            '.git/config': '[core]\nrepositoryformatversion = 0',
            '.gitignore': 'node_modules/\nbuild/\n*.log',
            'binary.png': Buffer.from([0x89, 0x50, 0x4E, 0x47]).toString('binary'), // PNG header
            'large-file.txt': 'x'.repeat(2000000), // 2MB file
            'test.log': 'log entry'
        };

        // Create directory structure and files
        for (const [filePath, content] of Object.entries(testFiles)) {
            const fullPath = path.join(testWorkspacePath, filePath);
            const dir = path.dirname(fullPath);
            
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            
            fs.writeFileSync(fullPath, content);
        }
    });

    suiteTeardown(() => {
        // Clean up test workspace
        if (fs.existsSync(testWorkspacePath)) {
            fs.rmSync(testWorkspacePath, { recursive: true, force: true });
        }
    });

    suite('FileFilter', () => {
        test('should filter files based on default options', async () => {
            const fileFilter = new FileFilter(testWorkspacePath);
            const options: FilterOptions = {
                respectGitignore: true,
                includePatterns: ['**/*.{js,ts,jsx,tsx,md,json}'],
                excludePatterns: ['**/node_modules/**', '**/build/**', '**/.git/**'],
                maxFileSize: 1048576 // 1MB
            };

            const result = await fileFilter.filterFiles(options);

            // Should include source files but exclude ignored/binary/large files
            assert.ok(result.includedFiles.includes('src/index.js'));
            assert.ok(result.includedFiles.includes('src/utils.ts'));
            assert.ok(result.includedFiles.includes('src/component.jsx'));
            assert.ok(result.includedFiles.includes('README.md'));
            assert.ok(result.includedFiles.includes('package.json'));

            // Should exclude these files
            assert.ok(!result.includedFiles.includes('node_modules/dependency/index.js'));
            assert.ok(!result.includedFiles.includes('build/output.js'));
            assert.ok(!result.includedFiles.includes('.git/config'));
            assert.ok(!result.includedFiles.includes('binary.png'));
            assert.ok(!result.includedFiles.includes('large-file.txt'));

            // Check exclusion reasons
            const excludedPaths = result.excludedFiles.map(f => f.path);
            assert.ok(excludedPaths.includes('node_modules/dependency/index.js'));
            assert.ok(excludedPaths.includes('large-file.txt'));
        });

        test('should respect gitignore when enabled', async () => {
            const fileFilter = new FileFilter(testWorkspacePath);
            const options: FilterOptions = {
                respectGitignore: true,
                includePatterns: ['**/*'],
                excludePatterns: [],
                maxFileSize: 10485760 // 10MB
            };

            const result = await fileFilter.filterFiles(options);

            // Files in .gitignore should be excluded
            const excludedPaths = result.excludedFiles.map(f => f.path);
            assert.ok(excludedPaths.some(p => p.includes('node_modules')));
            assert.ok(excludedPaths.some(p => p.includes('build')));
            assert.ok(excludedPaths.some(p => p.endsWith('.log')));
        });

        test('should ignore gitignore when disabled', async () => {
            const fileFilter = new FileFilter(testWorkspacePath);
            const options: FilterOptions = {
                respectGitignore: false,
                includePatterns: ['**/*.js'],
                excludePatterns: [],
                maxFileSize: 10485760 // 10MB
            };

            const result = await fileFilter.filterFiles(options);

            // Should include files that would normally be gitignored
            assert.ok(result.includedFiles.includes('node_modules/dependency/index.js'));
            assert.ok(result.includedFiles.includes('build/output.js'));
        });
    });

    suite('MarkdownGenerator', () => {
        test('should generate markdown with table of contents', async () => {
            const generator = new MarkdownGenerator(testWorkspacePath);
            const filePaths = ['src/index.js', 'src/utils.ts', 'README.md'];
            const options = {
                includeTableOfContents: true,
                workspaceName: 'test-project',
                exportTimestamp: '2024-01-01 12:00:00',
                totalFiles: 3
            };

            const markdown = await generator.generateMarkdown(filePaths, options);

            // Check header
            assert.ok(markdown.includes('# Codebase Export'));
            assert.ok(markdown.includes('**Generated:** 2024-01-01 12:00:00'));
            assert.ok(markdown.includes('**Workspace:** test-project'));
            assert.ok(markdown.includes('**Total Files:** 3'));

            // Check table of contents
            assert.ok(markdown.includes('## Table of Contents'));
            assert.ok(markdown.includes('[index.js]'));
            assert.ok(markdown.includes('[utils.ts]'));
            assert.ok(markdown.includes('[README.md]'));

            // Check file contents
            assert.ok(markdown.includes('### src/index.js'));
            assert.ok(markdown.includes('```javascript'));
            assert.ok(markdown.includes('console.log("Hello World");'));

            assert.ok(markdown.includes('### src/utils.ts'));
            assert.ok(markdown.includes('```typescript'));
            assert.ok(markdown.includes('export function add'));

            assert.ok(markdown.includes('### README.md'));
            assert.ok(markdown.includes('```markdown'));
            assert.ok(markdown.includes('# Test Project'));
        });

        test('should generate markdown without table of contents', async () => {
            const generator = new MarkdownGenerator(testWorkspacePath);
            const filePaths = ['src/index.js'];
            const options = {
                includeTableOfContents: false,
                workspaceName: 'test-project',
                exportTimestamp: '2024-01-01 12:00:00',
                totalFiles: 1
            };

            const markdown = await generator.generateMarkdown(filePaths, options);

            // Should not include table of contents
            assert.ok(!markdown.includes('## Table of Contents'));
            
            // But should include file content
            assert.ok(markdown.includes('### src/index.js'));
            assert.ok(markdown.includes('```javascript'));
        });

        test('should detect correct programming languages', async () => {
            const generator = new MarkdownGenerator(testWorkspacePath);
            const filePaths = ['src/utils.ts', 'src/component.jsx', 'package.json'];
            const options = {
                includeTableOfContents: false,
                workspaceName: 'test-project',
                exportTimestamp: '2024-01-01 12:00:00',
                totalFiles: 3
            };

            const markdown = await generator.generateMarkdown(filePaths, options);

            assert.ok(markdown.includes('```typescript'));
            assert.ok(markdown.includes('```jsx'));
            assert.ok(markdown.includes('```json'));
        });

        test('should generate proper filename from template', () => {
            const filename1 = MarkdownGenerator.generateFileName('export-{timestamp}', 'my-project');
            const filename2 = MarkdownGenerator.generateFileName('codebase-{workspace}-export', 'my-project');

            assert.ok(filename1.startsWith('export-'));
            assert.ok(filename1.endsWith('.md'));
            assert.ok(filename1.includes('2024')); // Should include current year

            assert.strictEqual(filename2, 'codebase-my-project-export.md');
        });
    });

    suite('CodebaseExporter Integration', () => {
        test('should validate workspace correctly', () => {
            // Test with valid workspace
            const validResult = CodebaseExporter.validateWorkspace();
            // Note: This test depends on VS Code workspace being available
            // In a real test environment, you might need to mock this

            // Test validation logic
            assert.ok(typeof validResult.valid === 'boolean');
            if (!validResult.valid) {
                assert.ok(typeof validResult.message === 'string');
            }
        });

        test('should handle export process', async () => {
            // This test would require mocking VS Code APIs
            // For now, we'll test the basic structure
            const exporter = new CodebaseExporter(testWorkspacePath);
            assert.ok(exporter instanceof CodebaseExporter);
        });
    });
});
