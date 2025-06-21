import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GitDiffParser } from '../gitDiffParser';

suite('GitDiffParser Test Suite', () => {
    let tempDir: string;
    let parser: GitDiffParser;

    setup(() => {
        // Create a temporary directory for each test
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pastr-test-'));
        parser = new GitDiffParser(tempDir);
    });

    teardown(() => {
        // Clean up temporary directory
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
    });

    suite('New File Diff', () => {
        test('should create new file with content', async () => {
            const diff = `diff --git a/newfile.md b/newfile.md
new file mode 100644
index 0000000..aa39060
--- /dev/null
+++ b/newfile.md
@@ -0,0 +1 @@
+newfile`;

            const result = await parser.applyDiff(diff);
            
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.filesProcessed, 1);
            assert.strictEqual(result.errors.length, 0);
            
            const filePath = path.join(tempDir, 'newfile.md');
            assert.strictEqual(fs.existsSync(filePath), true);
            assert.strictEqual(fs.readFileSync(filePath, 'utf-8'), 'newfile');
        });

        test('should handle new file with multiple lines', async () => {
            const diff = `diff --git a/multiline.txt b/multiline.txt
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/multiline.txt
@@ -0,0 +1,3 @@
+line 1
+line 2
+line 3`;

            const result = await parser.applyDiff(diff);
            
            assert.strictEqual(result.success, true);
            const filePath = path.join(tempDir, 'multiline.txt');
            const content = fs.readFileSync(filePath, 'utf-8');
            assert.strictEqual(content, 'line 1\nline 2\nline 3');
        });

        test('should create nested directory structure', async () => {
            const diff = `diff --git a/nested/dir/file.txt b/nested/dir/file.txt
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/nested/dir/file.txt
@@ -0,0 +1 @@
+nested content`;

            const result = await parser.applyDiff(diff);
            
            assert.strictEqual(result.success, true);
            const filePath = path.join(tempDir, 'nested', 'dir', 'file.txt');
            assert.strictEqual(fs.existsSync(filePath), true);
            assert.strictEqual(fs.readFileSync(filePath, 'utf-8'), 'nested content');
        });
    });

    suite('Deleted File Diff', () => {
        test('should delete existing file', async () => {
            // Create a file first
            const filePath = path.join(tempDir, 'deleteme.md');
            fs.writeFileSync(filePath, 'content to delete');

            const diff = `diff --git a/deleteme.md b/deleteme.md
deleted file mode 100644
index aa39060..0000000
--- a/deleteme.md
+++ /dev/null
@@ -1 +0,0 @@
-content to delete`;

            const result = await parser.applyDiff(diff);
            
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.filesProcessed, 1);
            assert.strictEqual(fs.existsSync(filePath), false);
        });

        test('should handle error when file does not exist', async () => {
            const diff = `diff --git a/nonexistent.md b/nonexistent.md
deleted file mode 100644
index aa39060..0000000
--- a/nonexistent.md
+++ /dev/null
@@ -1 +0,0 @@
-some content`;

            const result = await parser.applyDiff(diff);
            
            assert.strictEqual(result.success, false);
            assert.strictEqual(result.filesProcessed, 0);
            assert.strictEqual(result.errors.length, 1);
            assert.ok(result.errors[0].includes('File does not exist'));
        });
    });

    suite('Renamed File Diff', () => {
        test('should rename file without content changes', async () => {
            // Create source file
            const oldPath = path.join(tempDir, 'oldname.md');
            fs.writeFileSync(oldPath, 'original content');

            const diff = `diff --git a/oldname.md b/newname.md
similarity index 100%
rename from oldname.md
rename to newname.md`;

            const result = await parser.applyDiff(diff);
            
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.filesProcessed, 1);
            
            const newPath = path.join(tempDir, 'newname.md');
            assert.strictEqual(fs.existsSync(oldPath), false);
            assert.strictEqual(fs.existsSync(newPath), true);
            assert.strictEqual(fs.readFileSync(newPath, 'utf-8'), 'original content');
        });

        test('should rename file with content changes', async () => {
            // Create source file
            const oldPath = path.join(tempDir, 'oldfile.txt');
            fs.writeFileSync(oldPath, 'old content\nline 2');

            const diff = `diff --git a/oldfile.txt b/newfile.txt
similarity index 50%
rename from oldfile.txt
rename to newfile.txt
index 1234567..abcdefg 100644
--- a/oldfile.txt
+++ b/newfile.txt
@@ -1,2 +1,2 @@
-old content
+new content
 line 2`;

            const result = await parser.applyDiff(diff);
            
            assert.strictEqual(result.success, true);
            const newPath = path.join(tempDir, 'newfile.txt');
            assert.strictEqual(fs.existsSync(oldPath), false);
            assert.strictEqual(fs.existsSync(newPath), true);
            assert.strictEqual(fs.readFileSync(newPath, 'utf-8'), 'new content\nline 2');
        });
    });

    suite('Changed File Diff', () => {
        test('should modify existing file', async () => {
            // Create source file
            const filePath = path.join(tempDir, 'modify.txt');
            fs.writeFileSync(filePath, 'original line\nkeep this line\nchange this line');

            const diff = `diff --git a/modify.txt b/modify.txt
index 1234567..abcdefg 100644
--- a/modify.txt
+++ b/modify.txt
@@ -1,3 +1,3 @@
 original line
 keep this line
-change this line
+modified line`;

            const result = await parser.applyDiff(diff);
            
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.filesProcessed, 1);
            
            const content = fs.readFileSync(filePath, 'utf-8');
            assert.strictEqual(content, 'original line\nkeep this line\nmodified line');
        });

        test('should add new lines to existing file', async () => {
            const filePath = path.join(tempDir, 'addlines.txt');
            fs.writeFileSync(filePath, 'existing line');

            const diff = `diff --git a/addlines.txt b/addlines.txt
index 1234567..abcdefg 100644
--- a/addlines.txt
+++ b/addlines.txt
@@ -1 +1,3 @@
 existing line
+new line 1
+new line 2`;

            const result = await parser.applyDiff(diff);
            
            assert.strictEqual(result.success, true);
            const content = fs.readFileSync(filePath, 'utf-8');
            assert.strictEqual(content, 'existing line\nnew line 1\nnew line 2');
        });

        test('should remove lines from existing file', async () => {
            const filePath = path.join(tempDir, 'removelines.txt');
            fs.writeFileSync(filePath, 'keep this\nremove this\nkeep this too');

            const diff = `diff --git a/removelines.txt b/removelines.txt
index 1234567..abcdefg 100644
--- a/removelines.txt
+++ b/removelines.txt
@@ -1,3 +1,2 @@
 keep this
-remove this
 keep this too`;

            const result = await parser.applyDiff(diff);
            
            assert.strictEqual(result.success, true);
            const content = fs.readFileSync(filePath, 'utf-8');
            assert.strictEqual(content, 'keep this\nkeep this too');
        });
    });

    suite('Multiple Files Diff', () => {
        test('should handle multiple file operations in one diff', async () => {
            // Create existing file for modification
            const existingPath = path.join(tempDir, 'existing.txt');
            fs.writeFileSync(existingPath, 'original content');

            const diff = `diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/new.txt
@@ -0,0 +1 @@
+new file content
diff --git a/existing.txt b/existing.txt
index abcdefg..1234567 100644
--- a/existing.txt
+++ b/existing.txt
@@ -1 +1 @@
-original content
+modified content`;

            const result = await parser.applyDiff(diff);
            
            assert.strictEqual(result.success, true);
            assert.strictEqual(result.filesProcessed, 2);
            
            // Check new file
            const newPath = path.join(tempDir, 'new.txt');
            assert.strictEqual(fs.existsSync(newPath), true);
            assert.strictEqual(fs.readFileSync(newPath, 'utf-8'), 'new file content');
            
            // Check modified file
            assert.strictEqual(fs.readFileSync(existingPath, 'utf-8'), 'modified content');
        });
    });

    suite('Error Handling', () => {
        test('should handle invalid diff content', async () => {
            const result = await parser.applyDiff('not a valid diff');

            assert.strictEqual(result.success, false);
            assert.strictEqual(result.filesProcessed, 0);
            assert.ok(result.errors.length > 0);
        });

        test('should handle empty diff content', async () => {
            const result = await parser.applyDiff('');

            assert.strictEqual(result.success, false);
            assert.strictEqual(result.message, 'No valid git diff content found');
        });

        test('should handle file creation when file already exists', async () => {
            // Create file first
            const filePath = path.join(tempDir, 'duplicate.txt');
            fs.writeFileSync(filePath, 'existing content');

            const diff = `diff --git a/duplicate.txt b/duplicate.txt
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/duplicate.txt
@@ -0,0 +1 @@
+new content`;

            const result = await parser.applyDiff(diff);

            assert.strictEqual(result.success, false);
            assert.strictEqual(result.filesProcessed, 0);
            assert.ok(result.errors[0].includes('File already exists'));
        });

        test('should handle modification of non-existent file', async () => {
            const diff = `diff --git a/nonexistent.txt b/nonexistent.txt
index 1234567..abcdefg 100644
--- a/nonexistent.txt
+++ b/nonexistent.txt
@@ -1 +1 @@
-old line
+new line`;

            const result = await parser.applyDiff(diff);

            assert.strictEqual(result.success, false);
            assert.strictEqual(result.filesProcessed, 0);
            assert.ok(result.errors[0].includes('File does not exist'));
        });
    });

    suite('Complex Scenarios', () => {
        test('should handle diff with AI response artifacts', async () => {
            const diffWithArtifacts = `Here's the git diff for your changes:

\`\`\`diff
diff --git a/test.txt b/test.txt
new file mode 100644
index 0000000..1234567
--- /dev/null
+++ b/test.txt
@@ -0,0 +1 @@
+test content
\`\`\`

This diff creates a new file with the requested content.`;

            const result = await parser.applyDiff(diffWithArtifacts);

            assert.strictEqual(result.success, true);
            assert.strictEqual(result.filesProcessed, 1);

            const filePath = path.join(tempDir, 'test.txt');
            assert.strictEqual(fs.existsSync(filePath), true);
            assert.strictEqual(fs.readFileSync(filePath, 'utf-8'), 'test content');
        });

        test('should handle file with no newline at end', async () => {
            const filePath = path.join(tempDir, 'nonewline.txt');
            fs.writeFileSync(filePath, 'line without newline');

            const diff = `diff --git a/nonewline.txt b/nonewline.txt
index 1234567..abcdefg 100644
--- a/nonewline.txt
+++ b/nonewline.txt
@@ -1 +1,2 @@
 line without newline
+added line
\\ No newline at end of file`;

            const result = await parser.applyDiff(diff);

            assert.strictEqual(result.success, true);
            const content = fs.readFileSync(filePath, 'utf-8');
            assert.strictEqual(content, 'line without newline\nadded line');
        });

        test('should handle multiple hunks in single file', async () => {
            const filePath = path.join(tempDir, 'multihunk.txt');
            fs.writeFileSync(filePath, 'line 1\nline 2\nline 3\nline 4\nline 5\nline 6');

            const diff = `diff --git a/multihunk.txt b/multihunk.txt
index 1234567..abcdefg 100644
--- a/multihunk.txt
+++ b/multihunk.txt
@@ -1,3 +1,3 @@
-line 1
+modified line 1
 line 2
 line 3
@@ -4,3 +4,3 @@
 line 4
-line 5
+modified line 5
 line 6`;

            const result = await parser.applyDiff(diff);

            assert.strictEqual(result.success, true);
            const content = fs.readFileSync(filePath, 'utf-8');
            assert.strictEqual(content, 'modified line 1\nline 2\nline 3\nline 4\nmodified line 5\nline 6');
        });

        test('should handle partial success with some errors', async () => {
            // Create one valid file
            const validPath = path.join(tempDir, 'valid.txt');
            fs.writeFileSync(validPath, 'valid content');

            const diff = `diff --git a/valid.txt b/valid.txt
index 1234567..abcdefg 100644
--- a/valid.txt
+++ b/valid.txt
@@ -1 +1 @@
-valid content
+modified valid content
diff --git a/invalid.txt b/invalid.txt
index 1234567..abcdefg 100644
--- a/invalid.txt
+++ b/invalid.txt
@@ -1 +1 @@
-nonexistent content
+modified content`;

            const result = await parser.applyDiff(diff);

            assert.strictEqual(result.success, true); // Partial success
            assert.strictEqual(result.filesProcessed, 1);
            assert.strictEqual(result.errors.length, 1);
            assert.ok(result.errors[0].includes('File does not exist'));

            // Valid file should be modified
            const content = fs.readFileSync(validPath, 'utf-8');
            assert.strictEqual(content, 'modified valid content');
        });
    });
});
