const { app, BrowserWindow, ipcMain, Tray, Menu } = require('electron'); // 🛠️ Added Tray & Menu
const path = require('path');
const fs = require('fs');
const https = require('https');
const os = require('os');
const http = require('http');

// ========================================================
// 1. 🛡️ SINGLE INSTANCE LOCK (ANTI-TRAFFIC JAM GATEKEEPER)
// ========================================================
const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    // If another copy is already running, kill this duplicate copy immediately 
    // before it has a chance to fight over port 31337!
    console.log("[INFO] Pin Sniper is already running. Closing duplicate instance.");
    app.quit();
} else {

    // If someone tries to open a second copy, bring the existing background app back to the front!
    app.on('second-instance', (event, commandLine, workingDirectory) => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.show(); // 🛠️ Critical because your window hides instead of closing!
            mainWindow.focus();
        }
    });

    // ========================================================
    // 2. 🎯 YOUR ORIGINAL APP LOGIC & CORE VARIABLES
    // ========================================================
    let mainWindow;
    let crawlerWin = null;
    let tray = null; // 🛠️ Added Tray variable

    global.stopSignal = 0; 
    global.appState = { phase: 'idle' }; 

    function logMessage(msg, type = 'info') {
        console.log(`[${type.toUpperCase()}] ${msg}`);
        if(mainWindow) mainWindow.webContents.send('backend-log', msg, type);
    }

    function createWindow () {
      mainWindow = new BrowserWindow({ 
          width: 450, 
          height: 350, 
          x: 0, 
          y: 0,
          title: "Pin Sniper V3", 
          autoHideMenuBar: true, 
          resizable: false, 
          show: true, // 🛠️ CHANGED TO TRUE: App will now open the UI immediately!
          icon: path.join(__dirname, 'icon.ico'), // 🛠️ ADDED THIS LINE!
          webPreferences: { nodeIntegration: true, contextIsolation: false }
      });
      
      mainWindow.loadFile('index.html');

      // 🛠️ Prevents the app from quitting when you hit the 'X' on the window
      mainWindow.on('close', (event) => {
          if (!app.isQuiting) {
              event.preventDefault();
              mainWindow.hide();
          }
      });
    }

    // 🛠️ Hides the app icon from the macOS Dock
    if (app.dock) {
        app.dock.hide(); 
    }

    app.whenReady().then(() => { 
        createWindow(); 
        startLocalServer(); 

        // 🛠️ SETUP THE SYSTEM TRAY
        const iconPath = path.join(__dirname, 'icon.ico'); 
        tray = new Tray(iconPath);

        const contextMenu = Menu.buildFromTemplate([
            { label: '🎯 Pin Sniper is Running', enabled: false },
            { type: 'separator' },
            { 
                label: 'Show Logs', 
                click: () => {
                    if (mainWindow) mainWindow.show();
                }
            },
            { 
                label: 'Quit Pin Sniper', 
                click: () => {
                    app.isQuiting = true;
                    app.quit();
                }
            }
        ]);

        tray.setToolTip('Pin Sniper Background Server');
        tray.setContextMenu(contextMenu);
    });

    // 🛠️ Keeps the app alive in the background even if no windows are open
    app.on('window-all-closed', (e) => { 
        e.preventDefault(); 
    });

    // 🛠️ FIXED ANIMATION ENGINE
    ipcMain.on('resize-window', (event, expand) => {
        if (!mainWindow) return;
        
        mainWindow.setResizable(true); 
        const bounds = mainWindow.getBounds();
        let currentHeight = bounds.height;
        const targetHeight = expand ? 620 : 350; 
        const step = expand ? 25 : -25;
        
        const animate = setInterval(() => {
            currentHeight += step;
            if ((expand && currentHeight >= targetHeight) || (!expand && currentHeight <= targetHeight)) {
                clearInterval(animate);
                mainWindow.setBounds({ width: bounds.width, height: targetHeight });
                mainWindow.setResizable(false); 
            } else {
                mainWindow.setBounds({ width: bounds.width, height: currentHeight });
            }
        }, 10);
    });

    // ========================================================
    // 3. ⚙️ HARVESTER ENGINE & SCRAPING LOGIC
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

    // 🛠️ FIXED: ZERO-BYTE FILE PREVENTION & FAKE BROWSER HEADERS
    function downloadFile(url, filename, folderName, currentIndex, totalItems) {
      return new Promise((resolve) => {
          const targetDir = path.join(os.homedir(), 'Downloads', folderName);
          if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true });

          const downloadPath = path.join(targetDir, filename);

          const requestOptions = {
              headers: {
                  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
                  'Referer': 'https://www.pinterest.com/',
                  'Accept': 'image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8'
              }
          };

          https.get(url, requestOptions, (response) => {
            // ONLY create the file if Pinterest says OK (200). 
            // If it's a 403 Forbidden, we skip creating the blank file!
            if (response.statusCode !== 200) { 
                logMessage(`⚠️ Blocked by Pinterest (Error ${response.statusCode}) - Skipping ${filename}`, 'error');
                resolve(false); 
                return; 
            }
            
            const fileStream = fs.createWriteStream(downloadPath);
            response.pipe(fileStream);
            
            fileStream.on('finish', () => {
              fileStream.close();
              logMessage(`🟢 [${currentIndex}/${totalItems}] Saved: ${filename}`, 'success');
              resolve(true);
            });
          }).on('error', () => { resolve(false); });
      });
    }

    async function extractMediaFromPin(pinUrl) {
        return new Promise((resolve) => {
            const tempWin = new BrowserWindow({ show: false, webPreferences: { webSecurity: false, nodeIntegration: false } });
            tempWin.loadURL(pinUrl);
            tempWin.webContents.once('did-finish-load', async () => {
                try {
                    const mediaData = await tempWin.webContents.executeJavaScript(`
                      (() => {
                          let data = { type: 'none', url: '' };
                          let html = document.documentElement.innerHTML;
                          let mp4Match = html.match(/"url":"(https:\\\/\\\/[^"]+\\.mp4[^"]*)"/);
                          if (mp4Match) { data.type = 'video'; data.url = mp4Match[1].replace(/\\\\/g, ''); return data; }
                          let imgMatch = html.match(/"url":"(https:\\\/\\\/[^"]+\\\/originals\\\/[^"]+\\.(jpg|png|gif))"/);
                          if (imgMatch) { data.type = 'image'; data.url = imgMatch[1].replace(/\\\\/g, ''); return data; }
                          return data;
                      })();
                    `);
                    tempWin.destroy();
                    resolve(mediaData);
                } catch (error) { tempWin.destroy(); resolve({ type: 'none', url: '' }); }
            });
        });
    }

    async function executeSnipe(config) {
      global.stopSignal = 0; 
      
      let folderName = (config.customName && config.customName !== "") ? 
          config.customName.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_") : getFolderName(config.url);

      // 🛠️ THE NEW "EAGLE" HYBRID MODE
      if (config.mode === 'direct' && config.directLinks) {
          global.appState.phase = 'downloading';
          logMessage(`📥 HYBRID MODE: Received ${config.directLinks.length} media links from Chrome.`);
          
          const total = config.directLinks.length;
          for (let i = 0; i < total; i++) {
              if (global.stopSignal >= 2) {
                  logMessage(`🛑 DOWNLOADS CANCELLED.`);
                  break;
              }
              const url = config.directLinks[i];
              const ext = url.includes('.mp4') ? 'mp4' : 'jpg';
              const filename = `DirectSnipe_${i+1}_${Date.now()}.${ext}`;
              
              logMessage(`Saving item [${i + 1}/${total}]...`);
              await downloadFile(url, filename, folderName, i + 1, total);
              
              if (!config.fastMode) await new Promise(r => setTimeout(r, 500)); // Rate limiting
          }
          global.appState.phase = 'finished'; 
          logMessage(`🏆 ALL DIRECT TASKS FINISHED!`, 'success');
          if(mainWindow) mainWindow.webContents.send('snipe-finished');
          return;
      }

      // --- STANDARD GHOST CRAWLER (For Public Links) ---
      global.appState.phase = 'scrolling'; 
      logMessage(`🚀 INITIATING SNIPE PROTOCOL...`);

      const isSinglePin = /\/(?:pin|story|idea|idea-pin)\//i.test(config.url);
      
      if (isSinglePin && !config.keepGoing) {
          global.appState.phase = 'downloading'; 
          logMessage(`Extracting Single Pin...`);
          const media = await extractMediaFromPin(config.url);
          if (media.type !== 'none') {
              await downloadFile(media.url, `PinSniper_${Date.now()}.${media.type === 'video' ? 'mp4' : 'jpg'}`, folderName, 1, 1);
          }
          global.appState.phase = 'finished'; 
          if(mainWindow) mainWindow.webContents.send('snipe-finished');

      } else {
          logMessage(`Releasing invisible ghost crawler (Desktop Mode)...`);
          crawlerWin = new BrowserWindow({ show: false, width: 1920, height: 1080, webPreferences: { webSecurity: false } });

          crawlerWin.on('page-title-updated', (event, title) => {
              if (title.startsWith('PIN_COUNT:')) logMessage(`🎯 Live Scanner: Locked onto ${title.split(':')[1]} pins so far...`);
          });
          
          crawlerWin.loadURL(config.url);

          crawlerWin.webContents.once('did-finish-load', async () => {
              logMessage(`Initializing harvest grid lock...`);
              const pinLinks = await crawlerWin.webContents.executeJavaScript(`
                  new Promise((resolve) => {
                      let links = new Set(); let lastHeight = 0; let idleCount = 0;
                      let keepGoing = ${config.keepGoing}; let lastReportedCount = 0;
                      
                      let timer = setInterval(() => {
                          if (window.forceStop) { clearInterval(timer); resolve(Array.from(links)); return; }
                          let searchArea = document; 
                          if (!keepGoing) searchArea = document.querySelector('[data-test-id="board-feed"]') || document.querySelector('[role="list"]') || document;
                          if (searchArea) {
                              searchArea.querySelectorAll('a[href^="/pin/"]').forEach(a => {
                                  const rect = a.getBoundingClientRect();
                                  if (rect.width > 0 && rect.height > 0) {
                                      let cleanUrl = a.href.split('?')[0]; 
                                      if (!cleanUrl.endsWith('/')) cleanUrl += '/'; 
                                      if (/https?:\\/\\/[^\\/]+\\/pin\\/\\d+\\/$/.test(cleanUrl)) links.add(cleanUrl);
                                  }
                              });
                          }
                          if (links.size !== lastReportedCount) { document.title = 'PIN_COUNT:' + links.size; lastReportedCount = links.size; }
                          window.scrollTo(0, document.body.scrollHeight);
                          if (!keepGoing) {
                              if (document.body.scrollHeight === lastHeight) {
                                  idleCount++;
                                  if (idleCount > 2) { clearInterval(timer); resolve(Array.from(links)); }
                              } else { idleCount = 0; lastHeight = document.body.scrollHeight; }
                          }
                      }, 1000);
                  });
              `);
              
              crawlerWin.destroy(); crawlerWin = null;
              const totalPins = pinLinks.length;
              
              if (totalPins === 0 || global.stopSignal >= 2) {
                  logMessage(`❌ Harvest Aborted.`, 'error');
                  global.appState.phase = 'finished'; 
                  if(mainWindow) mainWindow.webContents.send('snipe-finished');
                  return;
              }

              global.appState.phase = 'downloading'; 
              logMessage(`🎯 HARVEST COMPLETE: Found ${totalPins} True Pins. Starting downloads...`);

              for (let i = 0; i < totalPins; i++) {
                  if (global.stopSignal >= 2) break;
                  logMessage(`Ripping pin [${i + 1}/${totalPins}]...`);
                  const media = await extractMediaFromPin(pinLinks[i]);
                  if (media.type !== 'none') {
                      const filename = `BoardItem_${i+1}_${Date.now()}.${media.type === 'video' ? 'mp4' : 'jpg'}`;
                      await downloadFile(media.url, filename, folderName, i + 1, totalPins);
                  }
                  if (!config.fastMode) await new Promise(r => setTimeout(r, 1000));
              }

              global.appState.phase = 'finished'; 
              logMessage(`🏆 ALL TASKS FINISHED!`, 'success');
              if(mainWindow) mainWindow.webContents.send('snipe-finished');
          });
      }
    }

    // ========================================================
    // 4. 📡 LOCAL BRIDGE SERVER 
    // ========================================================
    function startLocalServer() {
      const server = http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'OPTIONS, POST, GET');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type'); 
        
        if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

        if (req.method === 'GET' && req.url === '/status') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(global.appState));
            return;
        }

        if (req.method === 'POST' && req.url === '/snipe') {
          let body = '';
          req.on('data', chunk => body += chunk.toString());
          req.on('end', () => {
            const config = JSON.parse(body);
            executeSnipe(config);
            res.writeHead(200); res.end();
          });
        }

        if (req.method === 'POST' && req.url === '/stop') {
            if (global.appState.phase === 'scrolling') {
                global.stopSignal = 1; 
                if (crawlerWin) {
                    crawlerWin.webContents.executeJavaScript('window.forceStop = true;').catch(() => {});
                    logMessage(`⚠️ SCROLL STOP REQUESTED: Halting crawler...`);
                }
            } else if (global.appState.phase === 'downloading') {
                global.stopSignal = 2; 
                global.appState.phase = 'finished';
                logMessage(`🛑 HARD STOP SIGNAL RECEIVED: Cancelling downloads...`, 'error');
            }
            res.writeHead(200); res.end();
        }
      });

      server.listen(31337, '127.0.0.1', () => console.log('[INFO] 📡 Bridge Online: 127.0.0.1:31337'));
    }
}
