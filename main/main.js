/**
 * CialloForDesktop - Electron 主进程
 *
 * 管理透明窗口、系统托盘、IPC 通信、设置
 */

const {
  app,
  BrowserWindow,
  Tray,
  Menu,
  ipcMain,
  nativeImage,
  screen,
  dialog,
  shell,
} = require('electron');
const path = require('path');
const settings = require('./settings');
const { createSettingsWindow, closeSettingsWindow } = require('./settings-window');

// ======== 全局状态 ========
let mainWindow = null;
let tray = null;
let isClickThrough = false;
let isQuitting = false;

// 设置路径
const settingsPath = path.join(app.getPath('userData'), 'ciallo-settings.json');
let currentSettings = null;

// ======== 单实例锁 ========
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
}

// ======== 设置管理 ========

function loadSettings() {
  currentSettings = settings.load(settingsPath);
  applySettingsToWindow(currentSettings);
  return currentSettings;
}

function saveSettings(snapshot) {
  const result = settings.save(settingsPath, snapshot);
  if (result.success) {
    currentSettings = snapshot;
    // 广播到设置窗口
    if (mainWindow) {
      mainWindow.webContents.send('settings:changed', snapshot);
    }
  }
  return result;
}

function applySettingsToWindow(s) {
  if (!mainWindow) return;

  // 置顶
  if (s.alwaysOnTop !== undefined) {
    mainWindow.setAlwaysOnTop(s.alwaysOnTop);
  }

  // 透明度
  if (s.windowOpacity !== undefined) {
    mainWindow.setOpacity(s.windowOpacity);
  }

  // 点击穿透
  if (s.clickThrough !== undefined) {
    isClickThrough = s.clickThrough;
    if (s.clickThrough) {
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
    } else {
      mainWindow.setIgnoreMouseEvents(false);
    }
    updateTrayMenu();
  }

  // 开机自启
  if (s.autoStart !== undefined) {
    app.setLoginItemSettings({
      openAtLogin: s.autoStart,
      path: process.execPath,
    });
  }
}

// ======== 窗口管理 ========

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  const WINDOW_WIDTH = 540;
  const WINDOW_HEIGHT = 720;

  mainWindow = new BrowserWindow({
    width: WINDOW_WIDTH,
    height: WINDOW_HEIGHT,
    x: Math.round((screenWidth - WINDOW_WIDTH) / 2),
    y: Math.round((screenHeight - WINDOW_HEIGHT) / 2),
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    enableLargerThanScreen: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  // 应用已加载的设置
  loadSettings();

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

// ======== 系统托盘 ========

function createTray() {
  const iconPath = path.join(__dirname, '..', 'build', 'tray-icon.png');
  let trayIcon;
  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    trayIcon = trayIcon.resize({ width: 16, height: 16 });
  } catch (e) {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('Ciallo～(∠?ω< )⌒★!');
  updateTrayMenu();
}

function updateTrayMenu() {
  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Ciallo～(∠?ω< )⌒★!',
      enabled: false,
    },
    { type: 'separator' },
    {
      label: '显示/隐藏',
      click: () => {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: '打开设置',
      click: () => {
        createSettingsWindow(mainWindow);
      },
    },
    { type: 'separator' },
    {
      label: `点击穿透: ${isClickThrough ? '开' : '关'}`,
      type: 'checkbox',
      checked: isClickThrough,
      click: (menuItem) => {
        toggleClickThrough(menuItem.checked);
        // 更新设置
        if (currentSettings) {
          currentSettings.clickThrough = menuItem.checked;
          saveSettings(currentSettings);
        }
      },
    },
    { type: 'separator' },
    {
      label: '关于',
      click: showAboutDialog,
    },
    {
      label: '退出',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
}

// ======== 点击穿透切换 ========

function toggleClickThrough(enable) {
  isClickThrough = enable;
  if (mainWindow) {
    if (enable) {
      mainWindow.setIgnoreMouseEvents(true, { forward: true });
    } else {
      mainWindow.setIgnoreMouseEvents(false);
    }
  }
  updateTrayMenu();
}

// ======== 关于对话框 ========

function showAboutDialog() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: '关于 CialloForDesktop',
    message: 'Ciallo～(∠?ω< )⌒★!',
    detail: [
      'CialloForDesktop v1.0.0',
      '',
      '一款基于 Live2D 的桌面宠物',
      '模型: 浴衣丛雨 (Murasame Yukata)',
      '版权: © ゆずソフト (Yuzu-Soft)',
      '仅供个人使用',
      '',
      'Built with Electron + PixiJS + Live2D Cubism',
    ].join('\n'),
  });
}

// ======== IPC 处理器 ========

// 窗口 IPC
ipcMain.on('window-move-by', (event, { dx, dy }) => {
  if (!mainWindow || isClickThrough) return;
  const [x, y] = mainWindow.getPosition();
  mainWindow.setPosition(x + dx, y + dy);
});

ipcMain.on('window-set-position', (event, { x, y }) => {
  if (!mainWindow) return;
  mainWindow.setPosition(x, y);
});

ipcMain.handle('window-get-position', () => {
  if (!mainWindow) return { x: 0, y: 0 };
  const [x, y] = mainWindow.getPosition();
  return { x, y };
});

ipcMain.on('window-set-size', (event, { width, height }) => {
  if (!mainWindow) return;
  mainWindow.setSize(
    Math.max(100, Math.min(width, 800)),
    Math.max(100, Math.min(height, 1000))
  );
});

ipcMain.handle('window-get-size', () => {
  if (!mainWindow) return { width: 0, height: 0 };
  const [x, y] = mainWindow.getSize();
  return { width: x, height: y };
});

ipcMain.handle('screen-get-info', () => {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  return { screenWidth: width, screenHeight: height };
});

ipcMain.on('toggle-click-through', () => {
  toggleClickThrough(!isClickThrough);
  if (currentSettings) {
    currentSettings.clickThrough = isClickThrough;
    saveSettings(currentSettings);
  }
});

ipcMain.handle('is-click-through', () => {
  return isClickThrough;
});

ipcMain.on('window-ready', () => {
  if (mainWindow) mainWindow.show();
});

// 打开设置窗口
ipcMain.on('open-settings', () => {
  createSettingsWindow(mainWindow);
});

// ======== 设置 IPC ========

ipcMain.handle('settings:get', () => {
  return currentSettings || loadSettings();
});

ipcMain.handle('settings:update', (event, { key, value }) => {
  if (!currentSettings) loadSettings();

  const updated = {
    ...currentSettings,
    [key]: value,
  };

  const validated = settings.validate(updated);
  const result = settings.save(settingsPath, validated);

  if (result.success) {
    currentSettings = validated;
    applySettingsToWindow(validated);

    // 通知所有窗口
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('settings:changed', validated);
      }
    });
  }

  return result;
});

ipcMain.handle('settings:reset', () => {
  const defaults = settings.getDefaults();
  const result = saveSettings(defaults);
  if (result.success) {
    applySettingsToWindow(defaults);
    BrowserWindow.getAllWindows().forEach((win) => {
      if (!win.isDestroyed()) {
        win.webContents.send('settings:changed', defaults);
      }
    });
  }
  return result;
});

ipcMain.handle('settings:open-external', (event, url) => {
  shell.openExternal(url);
});

// ======== 应用生命周期 ========

app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isQuitting = true;
});

app.on('will-quit', () => {
  if (tray) {
    tray.destroy();
    tray = null;
  }
});
