const { app, BrowserWindow, ipcMain, Tray, Menu, net, session } = require('electron'); 
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const cleanUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
    app.quit();
} else {
    let mainWindow;
    let tray = null;

    global.appState = { phase: 'idle', downloaded: 0, total: 0 };
    global.stopSignal = false;

    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show();
            mainWindow.focus();
        }
    });

    function createWindow() {
        mainWindow = new BrowserWindow({
            width: 550, 
            height: 350,
            autoHideMenuBar: true,
            resizable: false,
            show: true,
            icon: path.join(__dirname, 'icon.ico'),
            webPreferences: {
                nodeIntegration: true,
                contextIsolation: false
            }
        });

        mainWindow.loadFile('index.html');

        mainWindow.on('close', (event) => {
            if (!app.isQuitting) {
                event.preventDefault();
                mainWindow.hide();
            }
        });
    }

    app.whenReady().then(() => {
        createWindow();
        tray = new Tray(path.join(__dirname, 'icon.ico'));
        tray.setToolTip('Pin Sniper Server');
        tray.setContextMenu(Menu.buildFromTemplate([
            { label: 'Show Logs', click: () => { if (mainWindow) mainWindow.show(); } },
            { label: 'Quit', click: () => { app.isQuitting = true; app.quit(); } }
        ]));

        startLocalServer();
    });

    ipcMain.on('resize-window', (e, expand) => {
        if (!mainWindow) return;
        mainWindow.setResizable(true); 
        let currentHeight = mainWindow.getBounds().height;
        const targetHeight = expand ? 620 : 350; 
        const step = expand ? 25 : -25;
        
        const animate = setInterval(() => {
            currentHeight += step;
            if ((expand && currentHeight >= targetHeight) || (!expand && currentHeight <= targetHeight)) {
                clearInterval(animate);
                mainWindow.setBounds({ width: mainWindow.getBounds().width, height: targetHeight });
                mainWindow.setResizable(false); 
            } else {
                mainWindow.setBounds({ width: mainWindow.getBounds().width, height: currentHeight });
            }
        }, 10);
    });

    function logMessage(msg, type = 'info') {
        console.log(`[${type.toUpperCase()}] ${msg}`);
        if (mainWindow && !mainWindow.webContents.isDestroyed()) {
            mainWindow.webContents.send('backend-log', msg, type);
        }
    }

    function startLocalServer() {
        http.createServer((req, res) => {
            res.setHeader('Access-Control-Allow-Origin', '*');
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
            res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

            if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

            if (req.method === 'GET' && req.url === '/status') {
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify(global.appState));
                return;
            }

            if (req.method === 'POST' && req.url === '/stop') {
                global.stopSignal = true;
                global.appState.phase = 'finished';
                logMessage(`🛑 HARD STOP SIGNAL RECEIVED: Cancelling downloads...`, 'error');
                res.writeHead(200); res.end();
                return;
            }

            if (req.method === 'POST' && req.url === '/snipe') {
                let body = '';
                req.on('data', chunk => body += chunk.toString());
                req.on('end', () => {
                    const payload = JSON.parse(body);
                    res.writeHead(200); res.end();
                    if (payload.directLinks) {
                        executeDirectDownload(payload.directLinks, payload.customName);
                    }
                });
            }
        }).listen(31337, '127.0.0.1');
    }

    async function fetchText(url) {
        return new Promise((resolve, reject) => {
            const req = net.request({ method: 'GET', url: url, redirect: 'follow' });
            req.setHeader('User-Agent', cleanUserAgent);
            req.setHeader('Referer', 'https://www.pinterest.com/');
            req.on('response', (res) => {
                let data = '';
                res.on('data', chunk => data += chunk.toString());
                res.on('end', () => resolve(data));
                res.on('error', reject);
            });
            req.on('error', reject);
            req.end();
        });
    }

    async function downloadHLSStream(playlistUrl, destinationPath) {
        logMessage(`   -> Fetching HLS Master Manifest...`, 'system');
        let manifest = await fetchText(playlistUrl);
        let baseUrl = playlistUrl.substring(0, playlistUrl.lastIndexOf('/') + 1);

        if (manifest.includes('#EXT-X-STREAM-INF')) {
            let lines = manifest.split('\n');
            let bestUrl = '';
            let maxBandwidth = 0;
            
            for (let i = 0; i < lines.length; i++) {
                if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
                    let bwMatch = lines[i].match(/BANDWIDTH=(\d+)/);
                    let bw = bwMatch ? parseInt(bwMatch[1]) : 0;
                    if (bw >= maxBandwidth) {
                        maxBandwidth = bw;
                        bestUrl = lines[i+1].trim();
                    }
                }
            }
            if (bestUrl) {
                if (!bestUrl.startsWith('http')) bestUrl = baseUrl + bestUrl;
                playlistUrl = bestUrl;
                baseUrl = playlistUrl.substring(0, playlistUrl.lastIndexOf('/') + 1);
                manifest = await fetchText(playlistUrl); 
            }
        }

        let chunks = [];
        let lines = manifest.split('\n');
        for (let line of lines) {
            line = line.trim();
            if (line && !line.startsWith('#')) {
                let chunkUrl = line.startsWith('http') ? line : baseUrl + line;
                chunks.push(chunkUrl);
            }
        }

        if (chunks.length === 0) throw new Error("No video chunks found in playlist.");
        logMessage(`   -> Found ${chunks.length} video chunks. Stitching...`, 'system');

        for (let i = 0; i < chunks.length; i++) {
            if (global.stopSignal) break;
            
            await new Promise((resolve, reject) => {
                const req = net.request({ method: 'GET', url: chunks[i], redirect: 'follow' });
                req.setHeader('User-Agent', cleanUserAgent);
                req.setHeader('Referer', 'https://www.pinterest.com/');
                req.on('response', (res) => {
                    if (res.statusCode === 200) {
                        const stream = fs.createWriteStream(destinationPath, { flags: 'a' });
                        res.on('data', chunk => stream.write(chunk));
                        res.on('end', () => { stream.end(); resolve(); });
                        res.on('error', err => { stream.end(); reject(err); });
                    } else {
                        reject(new Error(`Chunk HTTP ${res.statusCode}`));
                    }
                });
                req.on('error', reject);
                req.end();
            });
        }
    }

    async function executeDirectDownload(links, folderName) {
        if (!links || links.length === 0) return;

        global.stopSignal = false;
        global.appState.phase = 'downloading';
        global.appState.downloaded = 0;
        global.appState.total = links.length;

        const downloadDir = path.join(os.homedir(), 'Downloads', folderName || 'Pinterest_Sniper');
        if (!fs.existsSync(downloadDir)) fs.mkdirSync(downloadDir, { recursive: true });

        logMessage(`🚀 TARGET ENGAGED: Processing batch download into: ${downloadDir}`, 'system');

        for (let i = 0; i < links.length; i++) {
            if (global.stopSignal) break;

            let targetUrl = links[i];

            // Auto-upgrade simple image links just in case
            if (!targetUrl.includes('.mp4') && !targetUrl.includes('.m3u8') && targetUrl.includes('pinimg.com')) {
                if (targetUrl.includes('/736x/') || targetUrl.includes('/236x/') || targetUrl.includes('/474x/')) {
                    targetUrl = targetUrl.replace(/\/(?:\d+x\d*|x|rs_[^/]+)\//g, '/originals/');
                }
            }

            const shortUrl = targetUrl.length > 55 ? targetUrl.substring(0, 52) + '...' : targetUrl;
            logMessage(`📡 [${i + 1}/${links.length}] Fetching: ${shortUrl}`);

            try {
                let ext = 'jpg'; 
                if (targetUrl.includes('.mp4')) ext = 'mp4';
                else if (targetUrl.includes('.m3u8')) ext = 'ts'; 
                else if (targetUrl.includes('.gif')) ext = 'gif';
                else if (targetUrl.includes('.png')) ext = 'png';
                else if (targetUrl.includes('.webp')) ext = 'webp';

                const filename = `Pin_${Date.now()}_${i + 1}.${ext}`;
                let destinationPath = path.join(downloadDir, filename);

                if (ext === 'ts') {
                    await downloadHLSStream(targetUrl, destinationPath);
                } else {
                    const downloadStandard = async (urlToTry, currentDestPath) => {
                        return new Promise((resolve, reject) => {
                            const request = net.request({ method: 'GET', url: urlToTry, redirect: 'follow' });
                            request.setHeader('User-Agent', cleanUserAgent);
                            request.setHeader('Referer', 'https://www.pinterest.com/');

                            request.on('response', (response) => {
                                if (response.statusCode === 200) {
                                    const fileStream = fs.createWriteStream(currentDestPath);
                                    response.on('data', (chunk) => fileStream.write(chunk));
                                    response.on('end', () => fileStream.end(() => resolve(true)));
                                    response.on('error', (err) => { fileStream.end(); reject(err); });
                                } else {
                                    resolve(response.statusCode); 
                                }
                            });
                            request.on('error', (err) => reject(err));
                            request.end();
                        });
                    };

                    let result = await downloadStandard(targetUrl, destinationPath);
                    
                    if (result === 403 && targetUrl.includes('.jpg')) {
                        logMessage(`   -> 403 Forbidden. Retrying as .png...`, 'system');
                        let pngUrl = targetUrl.replace('.jpg', '.png');
                        destinationPath = destinationPath.replace('.jpg', '.png'); 
                        let retryResult = await downloadStandard(pngUrl, destinationPath);
                        if (retryResult !== true) throw new Error(`HTTP ${retryResult} on retry`);
                    } else if (result !== true) {
                        throw new Error(`HTTP ${result}`);
                    }
                }

                global.appState.downloaded++;
                logMessage(`🟢 [${i + 1}/${links.length}] Saved: ${path.basename(destinationPath)}`, 'success');

            } catch (err) {
                logMessage(`❌ Blocked on slot ${i + 1}: ${err.message}`, 'error');
            }

            await new Promise(resolve => setTimeout(resolve, 600 + Math.random() * 400));
        }

        global.appState.phase = 'finished';
        logMessage(`🏆 SNIPE COMPLETE: ${global.appState.downloaded} elements archived.`, 'system');
        if (mainWindow) mainWindow.webContents.send('snipe-finished');
    }
}
