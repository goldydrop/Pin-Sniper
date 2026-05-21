const { app, BrowserWindow, ipcMain, Tray, Menu, net } = require('electron'); 
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

const cleanUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ========================================================
// 1. 🛡️ SINGLE INSTANCE LOCK
// ========================================================
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {

    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show(); 
            mainWindow.focus();
        }
    });

    // ========================================================
    // 2. 🎯 CORE VARIABLES
    // ========================================================
    let mainWindow;
    let tray = null; 

    global.stopSignal = 0; 
    global.appState = { phase: 'idle', downloaded: 0, total: 0 }; 

    function logMessage(msg, type = 'info') {
        console.log(`[${type.toUpperCase()}] ${msg}`);
        if(mainWindow) mainWindow.webContents.send('backend-log', msg, type);
    }

    function createWindow () {
      mainWindow = new BrowserWindow({ 
          width: 450, height: 350, 
          title: "Pin Sniper V3", 
          autoHideMenuBar: true, resizable: false, show: true, 
          icon: path.join(__dirname, 'icon.ico'), 
          webPreferences: { nodeIntegration: true, contextIsolation: false }
      });
      mainWindow.loadFile('index.html');
      mainWindow.on('close', (e) => {
          if (!app.isQuiting) { e.preventDefault(); mainWindow.hide(); }
      });
    }

    if (app.dock) app.dock.hide(); 

    app.whenReady().then(() => { 
        createWindow(); 
        startLocalServer(); 
        tray = new Tray(path.join(__dirname, 'icon.ico'));
        tray.setToolTip('Pin Sniper Server');
        tray.setContextMenu(Menu.buildFromTemplate([
            { label: 'Show Logs', click: () => { if (mainWindow) mainWindow.show(); } },
            { label: 'Quit', click: () => { app.isQuiting = true; app.quit(); } }
        ]));
    });

    app.on('window-all-closed', (e) => { e.preventDefault(); });

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

    // ========================================================
    // 3. ⚙️ DOWNLOAD & SCRAPING ENGINE
    // ========================================================
    function getFolderName(urlStr) {
        try {
            const urlObj = new URL(urlStr);
            if (/\/(?:pin|story|idea|idea-pin)\/([a-zA-Z0-9_-]+)/i.test(urlObj.pathname)) {
                const match = urlObj.pathname.match(/\/(?:pin|story|idea|idea-pin)\/([a-zA-Z0-9_-]+)/i);
                return match ? "Pin_" + match[1] : "PinSniper_Single";
            } else {
                const match = urlObj.pathname.match(/\/([^\/]+)\/([^\/]+)\/?$/);
                return match ? match[1] + "_" + match[2] : "PinSniper_Board";
            }
        } catch (e) { return "PinSniper_Downloads"; }
    }

    async function downloadFile(url, baseFilename, folderName, currentIndex, totalItems) {
        try {
            const targetDir = path.join(os.homedir(), 'Downloads', folderName);
            if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

            // Chromium Architecture Infused Fetch Protocol
            const response = await net.fetch(url, {
                method: 'GET',
                headers: {
                    'User-Agent': cleanUserAgent,
                    'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8',
                    'Accept-Language': 'en-US,en;q=0.9',
                    'Cache-Control': 'no-cache',
                    'Referer': 'https://www.pinterest.com/',
                    'Origin': 'https://www.pinterest.com'
                }
            });

            if (!response.ok) {
                logMessage(`❌ Download blocked! (Status: ${response.status}) on Pin ${currentIndex}`, 'error');
                return false;
            }

            // Inspect dynamic response headers for correct format allocation
            let derivedExt = 'jpg';
            const contentType = response.headers.get('content-type') || '';
            if (contentType.includes('image/webp')) derivedExt = 'webp';
            else if (contentType.includes('image/png')) derivedExt = 'png';
            else if (contentType.includes('image/gif')) derivedExt = 'gif';
            else if (contentType.includes('video/mp4')) derivedExt = 'mp4';
            else {
                const urlPathClean = new URL(url).pathname.split('?')[0];
                const pathExt = urlPathClean.split('.').pop().toLowerCase();
                if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4'].includes(pathExt)) {
                    derivedExt = pathExt;
                }
            }

            const filename = `${baseFilename}.${derivedExt}`;
            const downloadPath = path.join(targetDir, filename);

            // Stream chunk buffer configuration
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            
            await fs.promises.writeFile(downloadPath, buffer);
            logMessage(`🟢 [${currentIndex}/${totalItems}] Saved: ${filename}`, 'success');
            return true;

        } catch (err) {
            logMessage(`❌ Download Pipeline Error on Pin ${currentIndex}: ${err.message}`, 'error');
            return false;
        }
    }

    // GHOST FETCH: Scrapes raw HTML directly to completely bypass the login wall
    async function extractMediaFromPin(pinUrl) {
        try {
            logMessage(`Ghost-fetching raw HTML to bypass login wall...`);
            const response = await net.fetch(pinUrl, {
                headers: {
                    'User-Agent': cleanUserAgent,
                    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9',
                    'Accept-Language': 'en-US,en;q=0.9',
                }
            });
            
            if (!response.ok) return { type: 'none', url: '' };
            const html = await response.text();
            
            // 1. Hunt for video streams
            const videoMatch = html.match(/<meta\s+property="og:video"\s+content="([^"]+)"/i) || 
                               html.match(/"contentUrl"\s*:\s*"([^"]+\.mp4)"/i) ||
                               html.match(/(https:\/\/[^\s"'<>]+\.mp4)/i);
                               
            if (videoMatch && videoMatch[1]) {
                const cleanUrl = videoMatch[1].replace(/\\/g, ''); 
                logMessage(`🎯 SUCCESS: Bypassed login wall and extracted video stream!`);
                return { type: 'video', url: cleanUrl };
            }
            
            // 2. Fallback to image streams
            const imageMatch = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"/i) ||
                               html.match(/"url"\s*:\s*"(https?:[^"]+\/(?:originals|736x)\/[^"]+\.(?:jpg|png|webp))"/i);
            
            if (imageMatch && imageMatch[1]) {
                const cleanUrl = imageMatch[1].replace(/\\/g, '');
                logMessage(`🎯 Bypassed login wall and extracted high-res image!`);
                return { type: 'image', url: cleanUrl };
            }

            logMessage(`❌ No hidden media streams found in source markup.`, 'error');
            return { type: 'none', url: '' };

        } catch (error) {
            logMessage(`❌ Headless network fetch failed: ${error.message}`, 'error');
            return { type: 'none', url: '' };
        }
    }

    async function executeSnipe(config) {
      global.stopSignal = 0; 
      let folderName = (config.customName && config.customName !== "") ? config.customName.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_") : getFolderName(config.url);

      // HYBRID BUNDLE BALANCER
      if (config.mode === 'direct' && Array.isArray(config.directLinks)) {
          global.appState.phase = 'downloading';
          global.appState.total = config.directLinks.length;
          global.appState.downloaded = 0;
          logMessage(`🚀 Processing bundle: downloading ${config.directLinks.length} files into folder [${folderName}]...`);

          for (let i = 0; i < config.directLinks.length; i++) {
              if (global.stopSignal === 2) {
                  logMessage("🛑 Operation stopped by user request.", "warning");
                  break;
              }
              const url = config.directLinks[i];
              const baseFilename = `PinSniper_${Date.now()}_${i + 1}`;
              
              await downloadFile(url, baseFilename, folderName, i + 1, config.directLinks.length);
              global.appState.downloaded = i + 1;
              
              // 🧠 Proactive Rate Limit Mitigator (200ms spacing protect signature)
              await new Promise(r => setTimeout(r, 200));
          }

          global.appState.phase = 'finished';
          if(mainWindow) mainWindow.webContents.send('snipe-finished');
          return;
      }

      // DEFAULT PROTOCOL: Single Pin headless extraction
      global.appState.phase = 'scrolling'; 
      global.appState.total = 1;
      global.appState.downloaded = 0;
      logMessage(`🚀 INITIATING HEADLESS SNIPE PROTOCOL...`);

      const isSinglePin = /\/(?:pin|story|idea|idea-pin)\//i.test(config.url);
      
      if (isSinglePin) {
          global.appState.phase = 'downloading'; 
          logMessage(`Extracting Single Pin...`);
          
          const media = await extractMediaFromPin(config.url);
          if (media.type !== 'none') {
              logMessage(`Downloading asset...`);
              const baseFilename = `PinSniper_${Date.now()}`;
              await downloadFile(media.url, baseFilename, folderName, 1, 1);
              global.appState.downloaded = 1;
          } else {
              logMessage(`❌ No asset was downloaded.`, 'error');
          }
          
          global.appState.phase = 'finished'; 
          if(mainWindow) mainWindow.webContents.send('snipe-finished');
      } else {
          logMessage(`❌ Processing failed. Open a single pin closeup or scan using the menu overlay.`, 'error');
          global.appState.phase = 'finished'; 
          if(mainWindow) mainWindow.webContents.send('snipe-finished');
      }
    }

    function startLocalServer() {
      const server = http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, POST, GET');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); 
        if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
        if (req.method === 'GET' && req.url === '/status') {
            res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(global.appState)); return;
        }
        if (req.method === 'POST' && req.url === '/snipe') {
          let body = '';
          req.on('data', chunk => body += chunk.toString());
          req.on('end', () => { executeSnipe(JSON.parse(body)); res.writeHead(200); res.end(); });
        }
        if (req.method === 'POST' && req.url === '/stop') {
            if (global.appState.phase === 'downloading') { global.stopSignal = 2; global.appState.phase = 'finished'; }
            res.writeHead(200); res.end();
        }
      });
      server.listen(31337, '127.0.0.1');
    }
}
