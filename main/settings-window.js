/**
 * CialloForDesktop - 设置窗口管理
 *
 * 创建和管理设置窗口
 */

const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');

let settingsWindow = null;

function createSettingsWindow(parentWindow) {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 480,
    height: 620,
    resizable: false,
    minimizable: false,
    maximizable: false,
    parent: parentWindow,
    modal: true,
    frame: true,
    title: 'CialloForDesktop 设置',
    backgroundColor: '#fff5f5',
    webPreferences: {
      preload: path.join(__dirname, 'preload-settings.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  settingsWindow.loadFile(path.join(__dirname, '..', 'src', 'settings.html'));

  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });

  // 阻止窗口被关闭后还引用
  settingsWindow.on('close', () => {
    if (parentWindow && !parentWindow.isDestroyed()) {
      parentWindow.focus();
    }
  });
}

function closeSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.close();
  }
}

module.exports = { createSettingsWindow, closeSettingsWindow };
