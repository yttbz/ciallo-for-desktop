/**
 * CialloForDesktop - Dashboard Preload
 *
 * 通过 contextBridge 暴露 Dashboard API 给监控面板窗口
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dashboardAPI', {
  // ── invoke (请求-响应) ──────────────────────────────────

  /** 获取会话状态快照 */
  getSnapshot: () => ipcRenderer.invoke('dashboard:get-snapshot'),

  /** 获取国际化资源 */
  getI18n: () => ipcRenderer.invoke('dashboard:get-i18n'),

  /** 隐藏/关闭会话 */
  hideSession: (sessionId) => ipcRenderer.invoke('dashboard:hide-session', sessionId),

  /** 设置会话别名 */
  setSessionAlias: (sessionId, alias) =>
    ipcRenderer.invoke('dashboard:set-session-alias', { sessionId, alias }),

  /** 确认会话完成 */
  ackCompletion: (sessionId) => ipcRenderer.invoke('session:ack-completion', sessionId),

  // ── send (单向通知) ──────────────────────────────────────

  /** 聚焦会话（跳转到终端） */
  focusSession: (sessionId) => ipcRenderer.send('dashboard:focus-session', sessionId),

  // ── on (主进程 → 渲染进程) ──────────────────────────────

  /** 监听会话快照更新（返回取消监听的函数） */
  onSessionSnapshot: (cb) => {
    const handler = (_event, snapshot) => cb(snapshot);
    ipcRenderer.on('dashboard:session-snapshot', handler);
    return () => ipcRenderer.removeListener('dashboard:session-snapshot', handler);
  },

  /** 监听语言变更（返回取消监听的函数） */
  onLangChange: (cb) => {
    const handler = (_event, lang) => cb(lang);
    ipcRenderer.on('dashboard:lang-changed', handler);
    return () => ipcRenderer.removeListener('dashboard:lang-changed', handler);
  },
});
