## ⚙️ Component Breakdown

### 1. The Local Server Bridge (Node.js / HTTP)
Because browser extensions are sandboxed and cannot write files directly to a user's hard drive efficiently, Pin Sniper uses a local HTTP server as a bridge.
* Located in `main.js` (`startLocalServer()`).
* Binds exclusively to `127.0.0.1:31337` to ensure no outside network can access the API.
* Listens for three primary endpoints:
  * `POST /snipe`: Receives the JSON payload containing the target URL or an array of direct media links.
  * `POST /stop`: Receives the kill signal to halt downloads or scrolling.
  * `GET /status`: Returns the global state (`idle`, `scrolling`, `downloading`, `finished`) so the browser extension can display real-time UI updates.

### 2. The Browser Extensions (Chrome / Firefox)
The extensions act as the "eyes" and the "remote control" for the desktop app.
* **`popup.js`**: Reads user toggles (Fast Mode, Keep Scrolling) and injects the scraper payload into the active tab.
* **`scraper.js`**: The heavy lifter. It creates the custom "Eagle Menu" overlay inside the webpage. It handles DOM traversal, bypassing React routing to find raw `.jpg` and `.mp4` URLs.
* **`background.js`**: Acts as the messenger. Browser security prevents content scripts from making complex cross-origin API calls, so the background worker securely relays the payload to the `127.0.0.1:31337` desktop bridge.

### 3. The Desktop Engine (Electron)
The desktop application does the heavy lifting, networking, and file management. It operates in two distinct modes depending on how the snipe was triggered:

* **Hybrid "Eagle" Mode (Triggered via Extension):** Receives an array of pre-scraped, raw media links from the browser extension. It bypasses headless crawling entirely and jumps straight to the rate-limited file downloading queue.
* **Standalone "Ghost Crawler" Mode (Triggered via Desktop UI):** If a user pastes a URL directly into the desktop app, `main.js` spawns a hidden, headless `BrowserWindow`. It injects a script to programmatically scroll the page, harvest pins into a `Set()`, and extract the grids before passing the URLs to the download queue.
