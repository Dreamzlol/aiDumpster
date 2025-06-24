import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { parseSearchReplaceBlocks } from '../lib/parser';
import { applySearchReplaceBlocks } from '../lib/applicator';

suite('Extension Test Suite', () => {
    vscode.window.showInformationMessage('Start all tests.');

    test('Sample test', () => {
        assert.strictEqual(-1, [1, 2, 3].indexOf(5));
        assert.strictEqual(-1, [1, 2, 3].indexOf(0));
    });
});

suite('SEARCH/REPLACE Block Test Suite', () => {
    let tempDir: string;

    setup(() => {
        // Create a temporary directory for testing
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pastr-test-'));
    });

    teardown(() => {
        // Clean up temporary directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

	test('Should parse valid SEARCH/REPLACE blocks (legacy format with path inside)', () => {
        const validContent = `\`\`\`python
test.py
<<<<<<< SEARCH
def old_function():
    return "old"
=======
def new_function():
    return "new"
>>>>>>> REPLACE
\`\`\``;

		const blocks = parseSearchReplaceBlocks(validContent);
        assert.strictEqual(blocks.length, 1);
        assert.strictEqual(blocks[0].language, 'python');
        assert.strictEqual(blocks[0].filePath, 'test.py');
        assert.strictEqual(blocks[0].searchContent, 'def old_function():\n    return "old"');
        assert.strictEqual(blocks[0].replaceContent, 'def new_function():\n    return "new"');
        assert.strictEqual(blocks[0].isNewFile, false);
    });

	test('Should parse valid SEARCH/REPLACE blocks with path outside', () => {
		const content = `
some intro text
src/test.py
\`\`\`python
<<<<<<< SEARCH
this is a test
=======
this is the replacement
>>>>>>> REPLACE
\`\`\`
		`;
		const blocks = parseSearchReplaceBlocks(content);
		assert.strictEqual(blocks.length, 1, "Should have parsed one block");
		assert.strictEqual(blocks[0].filePath, 'src/test.py');
		assert.strictEqual(blocks[0].language, 'python');
		assert.strictEqual(blocks[0].searchContent.trim(), 'this is a test');
	});

    test('Should parse valid SEARCH/REPLACE blocks with XML wrapper', () => {
        const validContent = `<search_replace_blocks>
test.py
\`\`\`python
<<<<<<< SEARCH
def old_function():
    return "old"
=======
def new_function():
    return "new"
>>>>>>> REPLACE
\`\`\`
</search_replace_blocks>`;

		const blocks = parseSearchReplaceBlocks(validContent);
        assert.strictEqual(blocks.length, 1);
        assert.strictEqual(blocks[0].language, 'python');
        assert.strictEqual(blocks[0].filePath, 'test.py');
        assert.strictEqual(blocks[0].searchContent, 'def old_function():\n    return "old"');
        assert.strictEqual(blocks[0].replaceContent, 'def new_function():\n    return "new"');
        assert.strictEqual(blocks[0].isNewFile, false);
    });

    test('Should handle empty or invalid content', async () => {
		const result1 = await applySearchReplaceBlocks('', tempDir);
        assert.strictEqual(result1.success, false);
        assert.strictEqual(result1.message, 'No valid SEARCH/REPLACE blocks found');

		const result2 = await applySearchReplaceBlocks('invalid content', tempDir);
        assert.strictEqual(result2.success, false);
        assert.strictEqual(result2.message, 'No valid SEARCH/REPLACE blocks found');
    });

	test('Should parse multiple SEARCH/REPLACE blocks with paths outside', () => {
		const multiBlockContent = `
file1.py
\`\`\`python
<<<<<<< SEARCH
def old_func1():
    pass
=======
def new_func1():
    pass
>>>>>>> REPLACE
\`\`\`

Some text in between.

file2.js
\`\`\`javascript
<<<<<<< SEARCH
function oldFunc2() {}
=======
function newFunc2() {}
>>>>>>> REPLACE
\`\`\``;

		const blocks = parseSearchReplaceBlocks(multiBlockContent);
        assert.strictEqual(blocks.length, 2);
        assert.strictEqual(blocks[0].filePath, 'file1.py');
        assert.strictEqual(blocks[1].filePath, 'file2.js');
    });

	test('Should correctly parse the user-provided failing case', () => {
		const failingContent = `<search_replace_blocks>
src/lib/components/ContentSection.svelte
\`\`\`svelte
<<<<<<< SEARCH
=======
<script lang="ts">
	import type { Snippet } from 'svelte'

	type Props = {
		title: string
		children: Snippet
		testId?: string
		titleTestId?: string
		class?: string
	}

	let {
		children,
		title,
		testId,
		titleTestId,
		class: className
	}: Props = $props()
</script>

<section
	class="mx-auto flex max-w-screen-sm flex-col items-start gap-18 {className || ''}"
	data-testid={testId}
>
	<h2
		class="text-2xl font-normal text-white md:text-4xl"
		data-testid={titleTestId}
	>
		{title}
	</h2>
	{@render children()}
</section>
>>>>>>> REPLACE
\`\`\`
src/lib/components/about/About.svelte
\`\`\`svelte
<<<<<<< SEARCH
<script lang="ts">
	import type { AboutItem } from '$lib/types/about'

	interface Props {
		data: AboutItem[]
	}

	let { data }: Props = $props()
</script>
=======
<script lang="ts">
	import type { AboutItem } from '$lib/types/about'

	interface Props {
		data: AboutItem
	}

	let { data }: Props = $props()
</script>
>>>>>>> REPLACE
\`\`\`
</search_replace_blocks>`;

		const blocks = parseSearchReplaceBlocks(failingContent);
		assert.strictEqual(blocks.length, 2, "Should parse two blocks");
		assert.strictEqual(blocks[0].filePath, "src/lib/components/ContentSection.svelte");
		assert.strictEqual(blocks[0].isNewFile, true);
		assert.strictEqual(blocks[0].language, "svelte");
		assert.ok(blocks[0].replaceContent.includes('<script lang="ts">'));

		assert.strictEqual(blocks[1].filePath, "src/lib/components/about/About.svelte");
		assert.strictEqual(blocks[1].isNewFile, false);
		assert.ok(blocks[1].searchContent.includes('data: AboutItem[]'));
		assert.ok(blocks[1].replaceContent.includes('data: AboutItem'));
    });

	test('Should handle file modification with exact match', async () => {
        const filePath = path.join(tempDir, 'existing_file.py');
		const originalContent = 'def old_function():\n    return "old value"\n\nprint("test")';
        fs.writeFileSync(filePath, originalContent, 'utf8');

		const modifyContent = `existing_file.py
\`\`\`python
<<<<<<< SEARCH
def old_function():
    return "old value"
=======
def new_function():
    return "new value"
>>>>>>> REPLACE
\`\`\``;

		const result = await applySearchReplaceBlocks(modifyContent, tempDir);
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.filesProcessed, 1);
        assert.strictEqual(result.blocksProcessed, 1);

        const newContent = fs.readFileSync(filePath, 'utf8');
        assert.strictEqual(newContent.includes('def new_function():'), true);
        assert.strictEqual(newContent.includes('return "new value"'), true);
		assert.strictEqual(newContent.includes('print("test")'), true);
    });

	test('Should fail to apply but give whitespace warning', async () => {
		const filePath = path.join(tempDir, 'file.js');
		// File has 4-space indent
		fs.writeFileSync(filePath, 'function test() {\n    console.log("hello");\n}', 'utf8');

		// Search block has 2-space indent and tabs
		const modifyContent = `file.js
\`\`\`javascript
<<<<<<< SEARCH
function test() {
	console.log("hello");
}
=======
function test() {
	console.log("goodbye");
}
>>>>>>> REPLACE
\`\`\``;

		const result = await applySearchReplaceBlocks(modifyContent, tempDir);
		assert.strictEqual(result.success, false, "Apply should fail");
		assert.strictEqual(result.errors.length, 1, "Should have one error");
		assert.strictEqual(result.warnings.length, 1, "Should have one warning");
		assert.ok(result.warnings[0].includes("whitespace"));
	});

	test('Should handle file creation', async () => {
		const newFileContent = `new_file.py
\`\`\`python
<<<<<<< SEARCH
=======
def hello():
	print("Hello, World!")
>>>>>>> REPLACE
\`\`\``;

		const result = await applySearchReplaceBlocks(newFileContent, tempDir);
		assert.strictEqual(result.success, true);
		const filePath = path.join(tempDir, 'new_file.py');
		assert.strictEqual(fs.existsSync(filePath), true);
		const content = fs.readFileSync(filePath, 'utf8');
		assert.ok(content.includes('def hello():'));
    });

    test('Should handle file already exists error for new files', async () => {
        const filePath = path.join(tempDir, 'existing.py');
        fs.writeFileSync(filePath, 'existing content', 'utf8');

		const duplicateContent = `existing.py
\`\`\`python
<<<<<<< SEARCH
=======
new content
>>>>>>> REPLACE
\`\`\``;

		const result = await applySearchReplaceBlocks(duplicateContent, tempDir);
        assert.strictEqual(result.success, false);
		assert.strictEqual(result.errors.length, 1);
		assert.ok(result.errors[0].includes('File already exists'));
    });
});