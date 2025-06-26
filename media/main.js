const vscode = acquireVsCodeApi();

const toggle = document.getElementById('mode-toggle');
const generateBtnText = document.getElementById('generate-btn-text');
const contextInstruction = document.getElementById('context-instruction');

function updateUI() {
    if (toggle.checked) {
        generateBtnText.textContent = 'Generate & Save to File';
        contextInstruction.textContent = 'All workspace files will be included automatically.';
    } else {
        generateBtnText.textContent = 'Generate & Copy';
        contextInstruction.textContent = 'Open the files you want to include as context.';
    }
}

toggle.addEventListener('change', updateUI);

document.getElementById('btn-generate').addEventListener('click', () => {
    const prompt = document.getElementById('prompt').value;
    if (!prompt) {
        vscode.postMessage({
            command: 'showError',
            payload: { message: '✨ Pastr: Please enter a task description.' }
        });
        return;
    }
    const mode = toggle.checked ? 'file' : 'clipboard';
    vscode.postMessage({
        command: 'generate',
        payload: { prompt: prompt, mode: mode }
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

// Set initial state on load
updateUI();