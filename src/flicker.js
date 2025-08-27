const { app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu } = require('electron');
const path = require('path');

// Application state
let mainWindow;
let tray;
let fallbackWindow;
app.isQuiting = false;

// Utility functions
const getAssetPath = (filename) => path.join(__dirname, '../assets', filename);
const isGoogleAccountsUrl = (url) => /https:\/\/accounts\.google\.com/.test(url);

// Window management
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 500,
    minHeight: 400,
    frame: false,
    icon: getAssetPath('nikoIcon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      allowRunningInsecureContent: false,
      webviewTag: true,
      nativeWindowOpen: true
    }
  });

  mainWindow.loadFile('src/flicker.html');
  mainWindow.on('close', handleWindowClose);
  
  setupGlobalShortcuts();
  setupTray();
}

function handleWindowClose(e) {
  if (!app.isQuiting) {
    e.preventDefault();
    mainWindow.webContents.send('play-exit-sound');
    mainWindow.hide();
  }
}

// Global shortcuts setup
function setupGlobalShortcuts() {
  const shortcuts = [
    { keys: 'CommandOrControl+R', channel: 'reload-active-tab' },
    { keys: 'F5', channel: 'reload-active-tab' },
    { keys: 'CommandOrControl+T', channel: 'open-new-tab' },
    { keys: 'CommandOrControl+Shift+T', channel: 'reopen-last-tab' }
  ];

  shortcuts.forEach(({ keys, channel }) => {
    globalShortcut.register(keys, () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(channel);
      }
    });
  });
}

// Tray setup
function setupTray() {
  tray = new Tray(getAssetPath('nikoIcon.png'));
  const contextMenu = Menu.buildFromTemplate([
    { 
      label: 'Show', 
      click: () => mainWindow.show() 
    },
    { 
      label: 'Quit', 
      click: () => {
        app.isQuiting = true;
        mainWindow.webContents.send('play-exit-sound');
        mainWindow.close();
      } 
    }
  ]);
  tray.setToolTip('Flicker');
  tray.setContextMenu(contextMenu);
}

// Fallback window for Google sign-in
function createFallbackWindow(url) {
  if (fallbackWindow && !fallbackWindow.isDestroyed()) {
    fallbackWindow.loadURL(url);
    fallbackWindow.show();
    return;
  }

  fallbackWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      partition: 'persist:main'
    }
  });

  fallbackWindow.loadURL(url);
  fallbackWindow.on('closed', () => {
    fallbackWindow = null;
  });

  fallbackWindow.webContents.on('did-navigate', (e, navigatedUrl) => {
    if (!isGoogleAccountsUrl(navigatedUrl) && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('open-url-in-new-tab', navigatedUrl);
      setTimeout(() => {
        if (fallbackWindow && !fallbackWindow.isDestroyed()) {
          fallbackWindow.close();
        }
      }, 2000);
    }
  });
}

// Window content handling
function handleWebContentsCreated(event, contents) {
  contents.setWindowOpenHandler(({ url, disposition }) => {
    const allowedDispositions = ['new-window', 'foreground-tab', 'background-tab'];
    if (allowedDispositions.includes(disposition)) {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('open-url-in-new-tab', url);
      }
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
}

// IPC handlers
function setupIpcHandlers() {
  ipcMain.on('window-minimize', () => mainWindow.minimize());
  
  ipcMain.on('window-maximize', () => {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });
  
  ipcMain.on('window-close', () => {
    mainWindow.webContents.send('play-exit-sound');
    mainWindow.hide();
  });
  
  ipcMain.on('close-window-okay', () => {
    app.isQuiting = true;
    if (mainWindow) mainWindow.close();
  });
  
  ipcMain.on('create-tab', (event, url) => {
    mainWindow.webContents.send('open-url-in-new-tab', url);
  });
  
  ipcMain.on('open-fallback-window', (event, url) => {
    createFallbackWindow(url);
  });
}

// App event handlers
app.on('web-contents-created', handleWebContentsCreated);

app.whenReady().then(() => {
  createWindow();
  setupIpcHandlers();
  
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});