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
const { createSettingsWindow, closeSettingsWindow, getSettingsWindow } = require('./settings-window');

// ======== 全局状态 ========
let mainWindow = null;
let tray = null;
let trayContextMenu = null; // 保存菜单引用，供右键弹出
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

  // 设置窗口置顶
  if (s.settingsWindowAlwaysOnTop !== undefined) {
    const sw = getSettingsWindow();
    if (sw) {
      sw.setAlwaysOnTop(s.settingsWindowAlwaysOnTop);
    }
  }

  // 托盘图标显示/隐藏
  if (s.showTrayIcon !== undefined) {
    if (s.showTrayIcon && !tray) {
      createTray();
    } else if (!s.showTrayIcon && tray) {
      tray.destroy();
      tray = null;
    }
  }
}

// ======== 窗口管理 ========

function createWindow() {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  const WINDOW_WIDTH = 540;
  const WINDOW_HEIGHT = 720;

  // 先创建一个小窗口，加载模型后会自动调整大小
  const initW = 300;
  const initH = 400;
  mainWindow = new BrowserWindow({
    width: initW,
    height: initH,
    x: Math.round((screenWidth - initW) / 2),
    y: Math.round((screenHeight - initH) / 2),
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

  // 最小化到托盘：拦截关闭按钮，隐藏到系统托盘
  mainWindow.on('close', (event) => {
    if (!isQuitting && currentSettings && currentSettings.minimizeToTray && currentSettings.closeButtonAction === 'minimize-to-tray') {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }
}

// ======== 系统托盘 ========

/**
 * 生成备用托盘图标（粉色圆形 + C 字母）
 * 在 app-icon.png 读取失败时使用
 */
function generateFallbackIcon() {
  // 内嵌的 base64 PNG: 64x64 粉色圆形 + 白色 C
  const b64 = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAACC0lEQVR4nO2bu43DMAyGs0VWSJs2pdvMkRvBZdq0aW+FlJ7Bc6T1Cu54FEQDhp+Srdf5F4G/SZCA/CzREkWdTtmyBTP6+b2w7qwHq2Q9RaV8pr67xPbTmXEwBevFqlktiwzVym/Ub4vYcVgZO3xlvVnNZHBrNg2kkf+8xo5v1uRpV6tPdxuAvqqkRoXM64/x8N4PoNMner6Q5GXjtEsAncoYgZ+NhnsYAN20OIcK/sb6bnTUFwASn26+g1fvaZvXWUgAJL7dfQa/10HfADq5hSDDft+TDwugdTYdSCe87XM+DgASn/cnRtqa7eMDUKr2Bm//nk8LgNK2dQLpFZ57h8IDULJfMZLN8jZ9AB/b4AtPjsQCoGS+gSLXiS8NAGYJkfR+3p8j8QAordcTSBcejgrgbQJgupJzDADNWvD+kl8aAJTmkyHpIuTRAbyWANQAAOolAG52fGkDaOeC97P0TQ+A0nhpTHMFD9cWJsA1jQsmpI+mUAA8pgBMb32PCWC8RSZ9SIkC4JkB5CmQk2B+DQ4BYC+EBALuUlgAwG+G4LfD2AURgYBbEhMA8EVR7LK4QMA9GBEA2EdjAgH3cFQAYB+PCwTcBokeBNwWGQGA3SQlEHDb5HoQcBslBxAwW2V7EHCbpXsQcNvlByAwL0wMIOBemekboV6aGhqhXpubMkK8OLlkhHZ1Nts/sD9C+sY7GiXvKwAAAABJRU5ErkJggg==';
  try {
    return nativeImage.createFromDataURL('data:image/png;base64,' + b64);
  } catch (e) {
    return nativeImage.createEmpty();
  }
}

function createTray() {
  // assets/app-icon.png 会被打包包含，作为托盘图标
  let trayIcon;

  try {
    const iconPath = path.join(__dirname, '..', 'assets', 'app-icon.png');
    if (require('fs').existsSync(iconPath)) {
      trayIcon = nativeImage.createFromPath(iconPath);
    } else {
      // 文件不存在时使用备用图标
      trayIcon = generateFallbackIcon();
    }
  } catch (e) {
    console.warn('[Main] Failed to load tray icon, using fallback:', e.message);
    trayIcon = generateFallbackIcon();
  }

  // 缩放到合适的托盘尺寸 (Windows 推荐 16x16 ~ 32x32)
  if (!trayIcon.isEmpty()) {
    trayIcon = trayIcon.resize({ width: 32, height: 32 });
  } else {
    // 仍然为空时再尝试一次备用
    trayIcon = generateFallbackIcon().resize({ width: 32, height: 32 });
  }

  try {
    tray = new Tray(trayIcon);
    tray.setToolTip('Ciallo～(∠?ω< )⌒★!');
  } catch (e) {
    console.error('[Main] Failed to create tray:', e.message);
  }

  if (tray) {
    updateTrayMenu();
  }
}

function updateTrayMenu() {
  if (!tray) return;
  const scale = currentSettings ? currentSettings.modelScale : 0.85;

  const sizeSubmenu = [
    { label: 'S',  type: 'radio', checked: Math.abs(scale - 0.50) < 0.05, click: () => setModelScale(0.50) },
    { label: 'M',  type: 'radio', checked: Math.abs(scale - 0.75) < 0.05, click: () => setModelScale(0.75) },
    { label: 'L',  type: 'radio', checked: Math.abs(scale - 0.85) < 0.05, click: () => setModelScale(0.85) },
    { label: 'XL', type: 'radio', checked: Math.abs(scale - 1.15) < 0.05, click: () => setModelScale(1.15) },
    { label: 'XXL',type: 'radio', checked: Math.abs(scale - 1.50) < 0.05, click: () => setModelScale(1.50) },
  ];

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Ciallo～(∠?ω< )⌒★!', enabled: false },
    { type: 'separator' },
    {
      label: mainWindow && mainWindow.isVisible() ? '隐藏' : '显示',
      click: () => {
        if (!mainWindow) return;
        if (mainWindow.isVisible()) { mainWindow.hide(); }
        else { mainWindow.show(); mainWindow.focus(); }
      },
    },
    {
      label: '打开设置',
      click: () => { createSettingsWindow(mainWindow, currentSettings || {}); },
    },
    { type: 'separator' },
    {
      label: '置顶',
      type: 'checkbox',
      checked: currentSettings ? currentSettings.alwaysOnTop : true,
      click: (menuItem) => {
        if (!currentSettings) return;
        currentSettings.alwaysOnTop = menuItem.checked;
        saveSettings(currentSettings);
      },
    },
    {
      label: 'HUD',
      type: 'checkbox',
      checked: currentSettings ? currentSettings.enableHUD : false,
      click: (menuItem) => {
        if (!currentSettings) return;
        currentSettings.enableHUD = menuItem.checked;
        saveSettings(currentSettings);
      },
    },
    {
      label: '点击穿透',
      type: 'checkbox',
      checked: isClickThrough,
      click: (menuItem) => {
        toggleClickThrough(menuItem.checked);
        if (currentSettings) {
          currentSettings.clickThrough = menuItem.checked;
          saveSettings(currentSettings);
        }
      },
    },
    { type: 'separator' },
    {
      label: '大小',
      submenu: sizeSubmenu,
    },
    { type: 'separator' },
    { label: '关于', click: showAboutDialog },
    {
      label: '退出',
      click: () => { isQuitting = true; app.quit(); },
    },
  ]);

  trayContextMenu = contextMenu;  // 保存供右键弹出
  tray.setContextMenu(contextMenu);
}

/**
 * 构建并弹出右键上下文菜单（独立于托盘图标是否可见）
 */
function buildAndPopupContextMenu() {
  const scale = currentSettings ? currentSettings.modelScale : 0.85;

  const sizeSubmenu = [
    { label: 'S',  type: 'radio', checked: Math.abs(scale - 0.50) < 0.05, click: () => setModelScale(0.50) },
    { label: 'M',  type: 'radio', checked: Math.abs(scale - 0.75) < 0.05, click: () => setModelScale(0.75) },
    { label: 'L',  type: 'radio', checked: Math.abs(scale - 0.85) < 0.05, click: () => setModelScale(0.85) },
    { label: 'XL', type: 'radio', checked: Math.abs(scale - 1.15) < 0.05, click: () => setModelScale(1.15) },
    { label: 'XXL',type: 'radio', checked: Math.abs(scale - 1.50) < 0.05, click: () => setModelScale(1.50) },
  ];

  const menu = Menu.buildFromTemplate([
    { label: '⚙️ 打开设置',
      click: () => { createSettingsWindow(mainWindow, currentSettings || {}); },
    },
    { type: 'separator' },
    { label: '显示/隐藏',
      click: () => {
        if (!mainWindow) return;
        if (mainWindow.isVisible()) { mainWindow.hide(); }
        else { mainWindow.show(); mainWindow.focus(); }
      },
    },
    { type: 'separator' },
    {
      label: '置顶',
      type: 'checkbox',
      checked: currentSettings ? currentSettings.alwaysOnTop : true,
      click: (menuItem) => {
        if (!currentSettings) return;
        currentSettings.alwaysOnTop = menuItem.checked;
        saveSettings(currentSettings);
      },
    },
    {
      label: 'HUD',
      type: 'checkbox',
      checked: currentSettings ? currentSettings.enableHUD : false,
      click: (menuItem) => {
        if (!currentSettings) return;
        currentSettings.enableHUD = menuItem.checked;
        saveSettings(currentSettings);
      },
    },
    {
      label: '点击穿透',
      type: 'checkbox',
      checked: isClickThrough,
      click: (menuItem) => {
        toggleClickThrough(menuItem.checked);
        if (currentSettings) {
          currentSettings.clickThrough = menuItem.checked;
          saveSettings(currentSettings);
        }
      },
    },
    { type: 'separator' },
    {
      label: '大小',
      submenu: sizeSubmenu,
    },
    { type: 'separator' },
    { label: '关于', click: showAboutDialog },
    { label: '退出',
      click: () => { isQuitting = true; app.quit(); },
    },
  ]);

  menu.popup({ window: mainWindow });
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

// ======== 模型大小快捷设置 ========

function setModelScale(scale) {
  if (!currentSettings) return;
  currentSettings.modelScale = scale;
  saveSettings(currentSettings);
}

// ======== 关于对话框 ========

function showAboutDialog() {
  dialog.showMessageBox(mainWindow, {
    type: 'info',
    title: '关于 CialloForDesktop',
    message: 'Ciallo～(∠?ω< )⌒★!',
    detail: [
      'CialloForDesktop v' + app.getVersion(),
      '',
      '一款基于 Live2D 的 Windows 桌面宠物',
      '模型: 浴衣丛雨 (Murasame Yukata)',
      '版权: © ゆずソフト (Yuzu-Soft) — 仅供个人使用',
      '',
      'Built with Electron + PixiJS + Live2D Cubism',
      '',
      '官方网站: https://m1f.cn',
      '项目地址: https://github.com/yttbz/ciallo-for-desktop',
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
  createSettingsWindow(mainWindow, currentSettings || {});
});

// 右键上下文菜单：在鼠标位置弹出托盘菜单
ipcMain.on('show-context-menu', () => {
  if (!mainWindow) return;
  // 构建菜单（独立于托盘存在与否）
  buildAndPopupContextMenu();
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

// 获取应用版本号
ipcMain.handle('app:get-version', () => {
  return app.getVersion();
});

// ======== 应用生命周期 ========

app.whenReady().then(() => {
  createWindow();
  // 如果 applySettingsToWindow 已经创建了托盘，就不要重复创建
  if (!tray) {
    createTray();
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}).catch((err) => {
  console.error('[Main] Fatal error during startup:', err);
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
