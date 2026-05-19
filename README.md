# 🎯 Pin Sniper
### **High-Speed Desktop Media Scraper for pin-based image boards.**

![Environment](https://img.shields.io/badge/Environment-Node.js-green?style=flat-square) ![Framework](https://img.shields.io/badge/Framework-Electron-blue?style=flat-square) ![Platform](https://img.shields.io/badge/Platform-Windows-orange?style=flat-square)

---

### 🚀 Key Features

* **Board & Grid Extraction:** Cleanly pulls high-quality visual media directly via target URLs or custom board configurations.
* **Silent System Tray Operation:** Runs entirely in the background without cluttering up your Windows taskbar.
* **Adaptive Rate-Limiting:** Built-in timing delays prevent your IP from getting blocked and preserve optimal connection speeds.
* **Process Conflict Prevention:** Single-instance port locking ensures smooth, crash-free background operations.

---

> ### 🛠️ How to Build from Source Code
> Follow these steps to compile the raw application files into a distribution executable on your local machine:
>
> 1. **Check System Prerequisites** >    Ensure your computer has [Node.js](https://nodejs.org/) and [Git](https://nodejs.org/) installed to manage background packages.
> 
> 2. **Clone the Local Repository** >    Launch your command terminal and pull down the files:
>    ```bash
>    git clone https://github.com/goldydrop/Pin-Sniper.git
>    cd Pin-Sniper
>    ```
> 
> 3. **Initialize Dependencies** >    Download the required modules using this line within the terminal, inside the Pin-Sniper folder:
>    ```bash
>    npm install
>    ```
> 
> 4. **Compile the Distribution Package** >    **(Open Command Prompt as Administrator!)** run line in pin-sniper folder to build a Windows setup.exe and portable exe :
>    ```bash
>    npm run dist
>    ```
>    ✨ *Output file will be generated instantly inside your local `/dist` directory!*

---

### ⚠️ Execution Warnings (Please Read)

Because this application is independently developed and does not have an expensive, commercially signed digital certificate, Windows will look at it suspiciously. 

* **During Installation:** Windows SmartScreen will likely pop up a blue warning saying *"Windows protected your PC"*. This is completely normal for custom tools. Click **"More Info"** and then click the **"Run Anyway"** button that appears.
* **Antivirus:** Some overly aggressive antivirus programs might flag the scraper because it runs in the background and makes rapid web requests. You may need to add it to your antivirus exclusion list if it gets blocked durring the building process.

---

### 📥 Looking for the Quick Installer?
If you do not want to compile code manually, skip the guide above! Head straight over to the **[Releases Section](../../releases)** on the right-hand sidebar to pull down the pre-packaged installation binary directly.
