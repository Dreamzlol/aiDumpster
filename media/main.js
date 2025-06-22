const vscode = acquireVsCodeApi();

document.getElementById('btn-generate').addEventListener('click', () => {
    const prompt = document.getElementById('prompt').value;
    if (!prompt) {
        vscode.postMessage({
            command: 'showError',
            payload: { message: '✨ Pastr: Please enter a task description.' }
        });
        return;
    }
    vscode.postMessage({
        command: 'generate',
        payload: { prompt: prompt }
    });
});

document.getElementById('btn-apply').addEventListener('click', () => {
    const diff = document.getElementById('diff-input').value;
    if (!diff) {
        vscode.postMessage({
            command: 'showError',
            payload: { message: '✨ Pastr: Please paste the response to apply.' }
        });
        return;
    }
    vscode.postMessage({
        command: 'apply',
        payload: { diff: diff }
    });
});