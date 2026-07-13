/**
 * CialloForDesktop - 设置面板 Preload
 *
 * 通过 contextBridge 暴露设置 API 给设置窗口
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settingsAPI', {
  // 获取完整设置
  getSettings: () => ipcRenderer.invoke('settings:get'),

  // 更新单个设置项
  update: (key, value) => ipcRenderer.invoke('settings:update', { key, value }),

  // 重置设置
  reset: () => ipcRenderer.invoke('settings:reset'),

  // 监听设置变更
  onChanged: (cb) => {
    const handler = (_event, settings) => cb(settings);
    ipcRenderer.on('settings:changed', handler);
    // 返回取消监听的函数
    return () => ipcRenderer.removeListener('settings:changed', handler);
  },

  // 打开外部链接
  openExternal: (url) => ipcRenderer.invoke('settings:open-external', url),

  // 获取应用版本号
  getAppVersion: () => ipcRenderer.invoke('app:get-version'),

  // Claude Code 监控
  getClaudeStatus: () => ipcRenderer.invoke('claude-code:status'),
  onClaudeStatus: (cb) => {
    const handler = (_event, status) => cb(status);
    ipcRenderer.on('claude-code:status', handler);
    return () => ipcRenderer.removeListener('claude-code:status', handler);
  },

  // SSH 远程连接管理
  sshListStatuses: () => ipcRenderer.invoke('ssh:list-statuses'),
  sshConnect: (profileId) => ipcRenderer.invoke('ssh:connect', profileId),
  sshDisconnect: (profileId) => ipcRenderer.invoke('ssh:disconnect', profileId),
  sshSaveProfile: (profile) => ipcRenderer.invoke('ssh:save-profile', profile),
  sshDeleteProfile: (profileId) => ipcRenderer.invoke('ssh:delete-profile', profileId),
  onSshStatusChanged: (cb) => {
    const handler = (_event, status) => cb(status);
    ipcRenderer.on('ssh:status-changed', handler);
    return () => ipcRenderer.removeListener('ssh:status-changed', handler);
  },
});
