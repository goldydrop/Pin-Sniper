# 🏗️ Pin Sniper: System Architecture & Developer Guide

Welcome to the Pin Sniper codebase! If you are looking to fork, modify, or understand how the system works under the hood, this document breaks down the entire application architecture.

At its core, Pin Sniper is a **hybrid system**. It consists of a local desktop engine (Electron) and a remote trigger (Browser Extensions), which communicate via a secure localhost bridge.

---


## 🗺️ System Architecture (How it Works)

Pin Sniper uses a lightweight bridge architecture to connect your web browser safely to your desktop filesystem. 

```text
 ┌──────────────────────────┐
 │   1. BROWSER COMPANION   │ ➔ Extracts raw high-resolution media 
 │    (Chrome / Firefox)    │   links right from the active webpage.
 └─────────────┬────────────┘
               │
               │ (Sends data securely over localhost)
               ▼
 ┌──────────────────────────┐
 │   2. LOCAL PORT BRIDGE   │ ➔ Receives payload at [http://127.0.0.1:31337](http://127.0.0.1:31337)
 │     (Node.js Server)     │   to safely bypass browser security limits.
 └─────────────┬────────────┘
               │
               │ (Hands off links to download engine)
               ▼
 ┌──────────────────────────┐
 │   3. ELECTRON ENGINE     │ ➔ Automatically builds target folders and
 │    (Desktop App Core)    │   saves image & video streams to hard drive.
 └──────────────────────────┘
