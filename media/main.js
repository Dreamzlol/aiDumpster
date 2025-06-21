const vscode = acquireVsCodeApi();

document.getElementById('create-codebase').addEventListener('click', () => {
    const prompt = document.getElementById('prompt').value;
    vscode.postMessage({
        command: 'createCodebase',
        prompt: prompt
    });
});

document.getElementById('apply-changes').addEventListener('click', () => {
    const diff = document.getElementById('diff-input').value;
    vscode.postMessage({
        command: 'applyGitDiff',
        diff: diff
    });
});