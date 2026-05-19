const { ipcRenderer } = require('electron');

const snipeBtn = document.getElementById('snipeBtn');
const urlInput = document.getElementById('urlInput');
const nameInput = document.getElementById('nameInput');
const keepGoing = document.getElementById('keepGoing');
const fastMode = document.getElementById('fastMode');
const logConsole = document.getElementById('logConsole');
const progressContainer = document.getElementById('progressContainer');
const progressBar = document.getElementById('progressBar');

const manualToggleBtn = document.getElementById('manualToggleBtn');
const manualControls = document.getElementById('manualControls');

let isRunning = false;
let isMenuOpen = false; // Tracks the current state

// Handle Menu Toggle & Window Animation
manualToggleBtn.addEventListener('click', () => {
    isMenuOpen = !isMenuOpen; // Flip the state
    
    if (isMenuOpen) {
        // We are Opening the menu
        manualControls.classList.remove('hide');
        ipcRenderer.send('resize-window', true);
    } else {
        // We are Closing the menu (Widget mode)
        manualControls.classList.add('hide');
        ipcRenderer.send('resize-window', false);
    }
});

// Handle the Start/Stop Button
snipeBtn.addEventListener('click', () => {
    if (isRunning) {
        fetch('http://127.0.0.1:31337/stop', { method: 'POST' });
        appendLog('⚠️ Stop command sent...', 'error');
        return;
    }

    const url = urlInput.value.trim();
    if (!url) {
        appendLog('❌ Please enter a Pinterest URL.', 'error');
        return;
    }

    isRunning = true;
    snipeBtn.textContent = 'Stop Sniping 🛑';
    snipeBtn.style.backgroundColor = '#333333'; 
    progressContainer.style.display = 'none';
    progressBar.style.width = '0%';
    
    if (logConsole.innerHTML.includes('[SYSTEM]')) {
        logConsole.innerHTML = ''; 
    }

    fetch('http://127.0.0.1:31337/snipe', {
        method: 'POST',
        body: JSON.stringify({
            url: url,
            customName: nameInput.value.trim(),
            keepGoing: keepGoing.checked,
            fastMode: fastMode.checked
        })
    });
});

ipcRenderer.on('backend-log', (event, msg, type) => {
    if (logConsole.innerHTML.includes('[SYSTEM]')) {
        logConsole.innerHTML = ''; 
    }

    appendLog(msg, type);

    if (msg.includes('🟢 [')) {
        progressContainer.style.display = 'block'; 
        const match = msg.match(/\[(\d+)\/(\d+)\]/);
        if (match) {
            const current = parseInt(match[1]);
            const total = parseInt(match[2]);
            const percent = (current / total) * 100;
            progressBar.style.width = `${percent}%`;
        }
    }
});

ipcRenderer.on('snipe-finished', () => {
    isRunning = false;
    snipeBtn.textContent = 'Start Sniping';
    snipeBtn.style.backgroundColor = '#E60023'; 
});

function appendLog(msg, type) {
    const div = document.createElement('div');
    div.textContent = msg;
    
    if (type === 'error') {
        div.style.color = '#ff6b6b'; 
    } else if (type === 'success') {
        div.style.color = '#51cf66'; 
    } else {
        div.style.color = '#cccccc'; 
    }
    
    logConsole.appendChild(div);
    logConsole.scrollTop = logConsole.scrollHeight;
}