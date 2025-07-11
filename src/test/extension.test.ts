import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseSearchReplaceBlocks, validateSearchReplaceBlock } from '../lib/parser';
import { applySearchReplaceBlocks } from '../lib/applicator';
import { generateFileTree, getNonce, getWorkspaceFilesWithGlob } from '../lib/utils';
import type { SearchReplaceBlock } from '../lib/types';

suite('Pastr Extension Test Suite', () => {
    let tempDir: string;

	suiteSetup(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pastr-test-'));
    });

	suiteTeardown(() => {
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

	suite('Parser (parser.ts)', () => {
		test('Should return empty array for null, undefined, or empty content', () => {
			assert.deepStrictEqual(parseSearchReplaceBlocks(null as any), []);
			assert.deepStrictEqual(parseSearchReplaceBlocks(undefined as any), []);
			assert.deepStrictEqual(parseSearchReplaceBlocks(''), []);
		});

		test('Should parse a single valid block with path outside', () => {
			const content = `
file/path/to/test.py
\`\`\`python
<<<<<<< SEARCH
print("hello")
=======
print("goodbye")
>>>>>>> REPLACE
\`\`\`
			`;
			const blocks = parseSearchReplaceBlocks(content);
			assert.strictEqual(blocks.length, 1);
			assert.strictEqual(blocks[0].filePath, 'file/path/to/test.py');
			assert.strictEqual(blocks[0].language, 'python');
			assert.strictEqual(blocks[0].searchContent, 'print("hello")');
			assert.strictEqual(blocks[0].replaceContent, 'print("goodbye")');
		});

		test('Should parse a new file block', () => {
			const content = `
new_file.js
\`\`\`javascript
<<<<<<< SEARCH
=======
console.log("new file created");
>>>>>>> REPLACE
\`\`\`
			`;
			const blocks = parseSearchReplaceBlocks(content);
			assert.strictEqual(blocks.length, 1);
			assert.strictEqual(blocks[0].isNewFile, true);
			assert.strictEqual(blocks[0].searchContent, '');
			assert.strictEqual(blocks[0].replaceContent, 'console.log("new file created");');
		});
		
		test('Should parse multiple blocks correctly', () => {
			const content = `
file1.ts
\`\`\`typescript
<<<<<<< SEARCH
const a = 1;
=======
const a = 2;
>>>>>>> REPLACE
\`\`\`

Some other text.

file2.ts
\`\`\`typescript
<<<<<<< SEARCH
const b = 3;
=======
const b = 4;
>>>>>>> REPLACE
\`\`\`
			`;
			const blocks = parseSearchReplaceBlocks(content);
			assert.strictEqual(blocks.length, 2);
			assert.strictEqual(blocks[0].filePath, 'file1.ts');
			assert.strictEqual(blocks[1].filePath, 'file2.ts');
		});
		
		test('Should handle blocks with XML wrapper', () => {
			const content = `<search_replace_blocks>
path/to/file.html
\`\`\`html
<<<<<<< SEARCH
<h1>Old</h1>
=======
<h1>New</h1>
>>>>>>> REPLACE
\`\`\`
</search_replace_blocks>`;
			const blocks = parseSearchReplaceBlocks(content);
			assert.strictEqual(blocks.length, 1);
			assert.strictEqual(blocks[0].filePath, 'path/to/file.html');
		});

		test('Should ignore malformed blocks', () => {
			const content = `
file.txt
\`\`\`text
<<<<<<< SEARCH
missing divider and end
`;
			const blocks = parseSearchReplaceBlocks(content);
			assert.strictEqual(blocks.length, 0);
		});

		suite('validateSearchReplaceBlock', () => {
			const baseBlock: SearchReplaceBlock = {
				filePath: 'src/main.ts',
				language: 'typescript',
				searchContent: 'search',
				replaceContent: 'replace',
				isNewFile: false,
			};

			test('Should pass a valid block', () => {
				const { valid, errors } = validateSearchReplaceBlock(baseBlock);
				assert.strictEqual(valid, true);
				assert.strictEqual(errors.length, 0);
			});

			test('Should fail with missing file path', () => {
				const { valid } = validateSearchReplaceBlock({ ...baseBlock, filePath: '' });
				assert.strictEqual(valid, false);
			});

			test('Should fail with absolute file path', () => {
				const { valid, errors } = validateSearchReplaceBlock({ ...baseBlock, filePath: '/abs/path' });
				assert.strictEqual(valid, false);
				assert.ok(errors.some(e => e.includes('absolute')));
			});

			test('Should fail with ".." in file path', () => {
				const { valid, errors } = validateSearchReplaceBlock({ ...baseBlock, filePath: '../src/main.ts' });
				assert.strictEqual(valid, false);
				assert.ok(errors.some(e => e.includes('..')));
			});
			
			test('Should fail with empty search content for existing file', () => {
				const { valid } = validateSearchReplaceBlock({ ...baseBlock, searchContent: '  ', isNewFile: false });
				assert.strictEqual(valid, false);
			});

			test('Should pass with empty search content for new file', () => {
				const { valid } = validateSearchReplaceBlock({ ...baseBlock, searchContent: '', isNewFile: true });
				assert.strictEqual(valid, true);
			});

			test('Should fail with missing language', () => {
				const { valid } = validateSearchReplaceBlock({ ...baseBlock, language: '' });
				assert.strictEqual(valid, false);
			});
		});
    });

	suite('Applicator (applicator.ts)', () => {
		let testWorkspace: string;
		
		setup(() => {
			testWorkspace = fs.mkdtempSync(path.join(tempDir, 'workspace-'));
		});

		teardown(() => {
			if (fs.existsSync(testWorkspace)) {
				fs.rmSync(testWorkspace, { recursive: true, force: true });
			}
		});
		
		test('Should create a new file', async () => {
			const content = `
new/app.js
\`\`\`javascript
<<<<<<< SEARCH
=======
console.log("hello world");
>>>>>>> REPLACE
\`\`\`
			`;
			const result = await applySearchReplaceBlocks(content, testWorkspace);
			assert.strictEqual(result.success, true);
			assert.strictEqual(result.filesProcessed, 1);
			const newFilePath = path.join(testWorkspace, 'new', 'app.js');
			assert.ok(fs.existsSync(newFilePath));
			assert.strictEqual(fs.readFileSync(newFilePath, 'utf8'), 'console.log("hello world");');
		});

		test('Should modify an existing file', async () => {
			const filePath = path.join(testWorkspace, 'test.txt');
			const originalContent = 'Line 1\nLine 2 is the one to be replaced.\nLine 3';
			fs.writeFileSync(filePath, originalContent, 'utf8');

			const content = `
test.txt
\`\`\`text
<<<<<<< SEARCH
Line 2 is the one to be replaced.
=======
Line 2 has been replaced.
>>>>>>> REPLACE
\`\`\`
`;
			const result = await applySearchReplaceBlocks(content, testWorkspace);

			assert.strictEqual(result.success, true, `Apply failed: ${result.errors.join('; ')}`);
			assert.strictEqual(result.blocksProcessed, 1);

			const newFileContent = fs.readFileSync(filePath, 'utf8');
			const expectedNewContent = 'Line 1\nLine 2 has been replaced.\nLine 3';
			assert.strictEqual(newFileContent, expectedNewContent);
		});
		
		test('Should fail to create a file that already exists', async () => {
			const filePath = path.join(testWorkspace, 'existing.txt');
			fs.writeFileSync(filePath, 'original');
			const content = `
existing.txt
\`\`\`text
<<<<<<< SEARCH
=======
new content
>>>>>>> REPLACE
\`\`\`
			`;
			const result = await applySearchReplaceBlocks(content, testWorkspace);
			assert.strictEqual(result.success, false);
			assert.strictEqual(result.errors.length, 1);
			assert.ok(result.errors[0].includes('File already exists'));
		});
		
		test('Should fail if search content not found', async () => {
			const filePath = path.join(testWorkspace, 'file.txt');
			fs.writeFileSync(filePath, 'hello world');
			const content = `
file.txt
\`\`\`text
<<<<<<< SEARCH
goodbye world
=======
hello universe
>>>>>>> REPLACE
\`\`\`
			`;
			const result = await applySearchReplaceBlocks(content, testWorkspace);
			assert.strictEqual(result.success, false);
			assert.strictEqual(result.errors.length, 1);
			assert.ok(result.errors[0].includes('did not exactly match'));
		});
		
		test('Should return a warning for whitespace differences', async () => {
			const filePath = path.join(testWorkspace, 'file.js');
			// File has 2-space indentation
			fs.writeFileSync(filePath, 'if (true) {\n  console.log(1);\n}', 'utf8');
			const content = `
file.js
\`\`\`javascript
<<<<<<< SEARCH
if (true) {
	console.log(1);
}
=======
if (true) {
	console.log(2);
}
>>>>>>> REPLACE
\`\`\`
			`;
			const result = await applySearchReplaceBlocks(content, testWorkspace);
			assert.strictEqual(result.success, false);
			assert.strictEqual(result.errors.length, 1);
			assert.strictEqual(result.warnings.length, 1);
			assert.ok(result.warnings[0].includes('whitespace'));
		});
		
		test('Should handle partial success (one block fails, one succeeds)', async () => {
			const filePath1 = path.join(testWorkspace, 'file1.txt');
			fs.writeFileSync(filePath1, 'content1');
			const content = `
file1.txt
\`\`\`text
<<<<<<< SEARCH
content1
=======
content2
>>>>>>> REPLACE
\`\`\`

file2.txt
\`\`\`text
<<<<<<< SEARCH
does not exist
=======
wont be applied
>>>>>>> REPLACE
\`\`\`
			`;
			const result = await applySearchReplaceBlocks(content, testWorkspace);
			assert.strictEqual(result.success, true);
			assert.strictEqual(result.blocksProcessed, 1);
			assert.strictEqual(result.filesProcessed, 1);
			assert.strictEqual(result.errors.length, 1);
			assert.ok(result.errors[0].includes('file2.txt'));
		});
	});

	suite('Utils (utils.ts)', () => {
		test('getNonce should return a 32-character string', () => {
			const nonce = getNonce();
			assert.strictEqual(typeof nonce, 'string');
			assert.strictEqual(nonce.length, 32);
		});

		test('generateFileTree should create a correct tree structure', () => {
			const files = [
				'src/main.ts',
				'src/lib/parser.ts',
				'package.json'
			];
			const rootName = 'my-project';
			const expected =
`my-project
├── src
│   ├── main.ts
│   └── lib
│       └── parser.ts
└── package.json
`;
			const tree = generateFileTree(files, rootName).replace(/(\r\n|\r)/g, '\n');
			// A bit of normalization for OS differences
			assert.strictEqual(tree, expected.replace(/(\r\n|\r)/g, '\n'));
		});

		test('generateFileTree should handle empty file list', () => {
			const tree = generateFileTree([], 'empty-project');
			assert.strictEqual(tree, 'empty-project\n');
		});
    });

		suite('File Export (getWorkspaceFilesWithGlob)', () => {
			let testWorkspace: string;

			setup(() => {
				testWorkspace = fs.mkdtempSync(path.join(tempDir, 'export-test-'));
			});

			teardown(() => {
				if (fs.existsSync(testWorkspace)) {
					fs.rmSync(testWorkspace, { recursive: true, force: true });
				}
			});

			test('Should find all files in workspace', async () => {
				// Create test files
				fs.writeFileSync(path.join(testWorkspace, 'test.js'), 'console.log("test");');
				fs.writeFileSync(path.join(testWorkspace, 'README.md'), '# Test Project');

				// Create subdirectory with file
				const subDir = path.join(testWorkspace, 'src');
				fs.mkdirSync(subDir);
				fs.writeFileSync(path.join(subDir, 'main.ts'), 'export const main = () => {};');

				const files = await getWorkspaceFilesWithGlob(testWorkspace);

				assert.ok(files.length >= 3, `Expected at least 3 files, got ${files.length}`);

				const filePaths = files.map((uri: vscode.Uri) => path.relative(testWorkspace, uri.fsPath));
				assert.ok(filePaths.includes('test.js'));
				assert.ok(filePaths.includes('README.md'));
				assert.ok(filePaths.includes(path.join('src', 'main.ts')));
			});

			test('Should exclude binary files', async () => {
				// Create test files including binary ones
				fs.writeFileSync(path.join(testWorkspace, 'test.js'), 'console.log("test");');
				fs.writeFileSync(path.join(testWorkspace, 'image.png'), Buffer.from('fake png data'));
				fs.writeFileSync(path.join(testWorkspace, 'font.woff'), Buffer.from('fake font data'));

				const files = await getWorkspaceFilesWithGlob(testWorkspace);
				const filePaths = files.map((uri: vscode.Uri) => path.relative(testWorkspace, uri.fsPath));

				assert.ok(filePaths.includes('test.js'));
				assert.ok(!filePaths.includes('image.png'));
				assert.ok(!filePaths.includes('font.woff'));
			});

			test('Should respect .gitignore', async () => {
				// Create .gitignore
				fs.writeFileSync(path.join(testWorkspace, '.gitignore'), 'ignored.txt\ntemp/\n');

				// Create files
				fs.writeFileSync(path.join(testWorkspace, 'test.js'), 'console.log("test");');
				fs.writeFileSync(path.join(testWorkspace, 'ignored.txt'), 'should be ignored');

				// Create temp directory with file
				const tempDir = path.join(testWorkspace, 'temp');
				fs.mkdirSync(tempDir);
				fs.writeFileSync(path.join(tempDir, 'temp.txt'), 'temp file');

				const files = await getWorkspaceFilesWithGlob(testWorkspace);
				const filePaths = files.map((uri: vscode.Uri) => path.relative(testWorkspace, uri.fsPath));



				assert.ok(filePaths.includes('test.js'));
				assert.ok(!filePaths.includes('ignored.txt'));
				assert.ok(!filePaths.some(p => p.startsWith('temp')), `Found temp files: ${filePaths.filter(p => p.startsWith('temp'))}`);
			});

			test('Should exclude node_modules and common build directories', async () => {
				// Create files in excluded directories
				const nodeModulesDir = path.join(testWorkspace, 'node_modules');
				const distDir = path.join(testWorkspace, 'dist');
				fs.mkdirSync(nodeModulesDir);
				fs.mkdirSync(distDir);

				fs.writeFileSync(path.join(testWorkspace, 'test.js'), 'console.log("test");');
				fs.writeFileSync(path.join(nodeModulesDir, 'package.js'), 'module.exports = {};');
				fs.writeFileSync(path.join(distDir, 'bundle.js'), 'bundled code');

				const files = await getWorkspaceFilesWithGlob(testWorkspace);
				const filePaths = files.map((uri: vscode.Uri) => path.relative(testWorkspace, uri.fsPath));

				assert.ok(filePaths.includes('test.js'));
				assert.ok(!filePaths.some(p => p.startsWith('node_modules')));
				assert.ok(!filePaths.some(p => p.startsWith('dist')));
			});

			test('Should exclude dotfiles and config files', async () => {
				// Create test files including dotfiles and config files
				fs.writeFileSync(path.join(testWorkspace, 'test.js'), 'console.log("test");');
				fs.writeFileSync(path.join(testWorkspace, 'package-lock.json'), '{}');
				fs.writeFileSync(path.join(testWorkspace, '.npmrc'), 'registry=...');
				fs.writeFileSync(path.join(testWorkspace, '.prettierignore'), '*.min.js');
				fs.writeFileSync(path.join(testWorkspace, '.env'), 'SECRET=value');
				fs.writeFileSync(path.join(testWorkspace, '.eslintrc.json'), '{}');

				// Create dot directories
				const svelteKitDir = path.join(testWorkspace, '.svelte-kit');
				const nextDir = path.join(testWorkspace, '.next');
				fs.mkdirSync(svelteKitDir);
				fs.mkdirSync(nextDir);
				fs.writeFileSync(path.join(svelteKitDir, 'generated.js'), 'generated code');
				fs.writeFileSync(path.join(nextDir, 'build.js'), 'build code');

				const files = await getWorkspaceFilesWithGlob(testWorkspace);
				const filePaths = files.map((uri: vscode.Uri) => path.relative(testWorkspace, uri.fsPath));

				// Should include regular files
				assert.ok(filePaths.includes('test.js'));

				// Should exclude lock files
				assert.ok(!filePaths.includes('package-lock.json'));

				// Should exclude config files
				assert.ok(!filePaths.includes('.npmrc'));
				assert.ok(!filePaths.includes('.prettierignore'));
				assert.ok(!filePaths.includes('.env'));
				assert.ok(!filePaths.includes('.eslintrc.json'));

				// Should exclude dot directories
				assert.ok(!filePaths.some(p => p.startsWith('.svelte-kit')));
				assert.ok(!filePaths.some(p => p.startsWith('.next')));
			});
		});
	});