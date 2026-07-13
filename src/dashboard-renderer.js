/**
 * CialloForDesktop - Dashboard 渲染器
 *
 * 负责从状态快照渲染会话卡片、分组、配额汇总，
 * 以及处理所有用户交互（聚焦、隐藏、标记已读、标题编辑等）。
 *
 * 数据来源：window.dashboardAPI（通过 preload-dashboard.js 注入）
 */

// ====================================================================
//  常量 & 状态
// ====================================================================

/** 当前快照缓存，供增量更新和定时器使用 */
let currentSnapshot = null;

/** 被用户隐藏的会话 ID 集合（仅本地隐藏，不持久化） */
const hiddenSessions = new Set();

/** 1 秒定时器句柄，用于刷新经过时间 */
let elapsedTimer = null;

/** 清理函数数组（onSnapshot / onLangChange 的取消函数） */
const cleanupFns = [];

/** DOM 快捷引用（延迟初始化） */
let $sessionList = null;
let $emptyState = null;
let $sessionCount = null;
let $quotaSummary = null;
let $quotaFill = null;
let $quotaValue = null;

// ====================================================================
//  工具函数
// ====================================================================

/**
 * 格式化经过时间（相对于当前时间）。
 * @param {number} timestamp - Unix 毫秒时间戳
 * @returns {string} 可读的时间描述（如 "3m 12s"）
 */
function formatElapsed(timestamp) {
  const diff = Date.now() - timestamp;
  if (diff < 0) return 'now';
  if (diff < 1000) return 'now';
  const totalSec = Math.floor(diff / 1000);
  if (totalSec < 60) return totalSec + 's';
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return min + 'm ' + sec + 's';
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  if (hr < 24) return hr + 'h ' + remMin + 'm';
  const day = Math.floor(hr / 24);
  return day + 'd ' + (hr % 24) + 'h';
}

/**
 * 取会话 ID 末尾 3 字符作为简短标识。
 * @param {string} id
 * @returns {string}
 */
function shortId(id) {
  if (!id) return '???';
  return id.slice(-3).toUpperCase();
}

/**
 * 获取会话标题（优先使用 sessionTitle，回退为短 ID）。
 * @param {object} session
 * @returns {string}
 */
function getTitle(session) {
  return session.sessionTitle || 'Session ' + shortId(session.id);
}

/**
 * 安全截断字符串。
 * @param {string} str
 * @param {number} maxLen
 * @returns {string}
 */
function truncate(str, maxLen) {
  if (!str) return '';
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen) + '…';
}

/**
 * 格式化路径（过长时截取末尾）。
 * @param {string} p
 * @returns {string}
 */
function formatPath(p) {
  if (!p) return '';
  if (p.length <= 65) return p;
  return '…' + p.slice(-64);
}

/**
 * 获取状态徽章的 CSS 类名。
 * @param {string} badge
 * @returns {string}
 */
function badgeClass(badge) {
  switch (badge) {
    case 'running':     return 'badge-running';
    case 'done':        return 'badge-done';
    case 'interrupted': return 'badge-interrupted';
    default:            return 'badge-idle';
  }
}

/**
 * 获取状态徽章的显示文本。
 * @param {string} badge
 * @returns {string}
 */
function badgeLabel(badge) {
  switch (badge) {
    case 'running':     return '● Running';
    case 'done':        return '✓ Done';
    case 'interrupted': return '⚠ Interrupted';
    default:            return '○ Idle';
  }
}

/**
 * 获取上下文用量对应的颜色。
 * @param {number} percent 0-100
 * @returns {string} CSS 颜色值
 */
function contextColor(percent) {
  if (percent > 80) return 'var(--context-high)';
  if (percent > 50) return 'var(--context-mid)';
  return 'var(--context-low)';
}

// ====================================================================
//  会话分组
// ====================================================================

/**
 * 将会话按 host 分组。
 * 空 host 归入 'local' 组。排除 hiddenSessions 中的会话。
 *
 * @param {object<string,object>} sessions - 会话 ID → 会话对象
 * @returns {Array<{host:string, sessions:object[]}>}
 */
function groupByHost(sessions) {
  /** @type {object<string,object[]>} */
  const groups = {};
  for (const [id, sess] of Object.entries(sessions)) {
    if (hiddenSessions.has(id)) continue;
    const host = sess.host || 'local';
    if (!groups[host]) groups[host] = [];
    groups[host].push(sess);
  }
  // 排序: local 优先，其次按字母序
  const keys = Object.keys(groups).sort((a, b) => {
    if (a === 'local') return -1;
    if (b === 'local') return 1;
    return a.localeCompare(b);
  });
  return keys.map((k) => ({ host: k, sessions: groups[k] }));
}

// ====================================================================
//  渲染函数
// ====================================================================

/**
 * 主渲染入口。传入快照数据，全量更新 UI。
 *
 * @param {object} snapshot - { sessions, orderedIds, groups, petState }
 */
function render(snapshot) {
  if (!snapshot) return;
  currentSnapshot = snapshot;

  const sessions = snapshot.sessions || {};
  const orderedIds = snapshot.orderedIds || [];
  const count = orderedIds.length;

  // ── 更新计数 ──────────────────────────────────
  if ($sessionCount) {
    $sessionCount.textContent = String(count);
  }

  // ── 空状态 ──────────────────────────────────
  const hasVisible = count > 0 && orderedIds.some((id) => !hiddenSessions.has(id));

  if (count === 0 || !hasVisible) {
    if ($emptyState) $emptyState.style.display = '';
    if ($sessionList) $sessionList.innerHTML = '';
    if ($quotaSummary) $quotaSummary.classList.add('hidden');
    return;
  }
  if ($emptyState) $emptyState.style.display = 'none';

  // ── 配额汇总 ────────────────────────────────
  renderQuotaSummary(Object.values(sessions));

  // ── 分组渲染 ────────────────────────────────
  const groups = groupByHost(sessions);
  let html = '';
  for (const group of groups) {
    html += renderGroup(group);
  }
  if ($sessionList) {
    $sessionList.innerHTML = html;
  }

  // ── 绑定事件处理器 ──────────────────────────
  // 使用 setTimeout 确保 DOM 已更新
  setTimeout(() => {
    for (const group of groups) {
      for (const sess of group.sessions) {
        setupCardHandlers(sess);
      }
    }
  }, 0);
}

// ─── 主机分组渲染 ─────────────────────────────────

/**
 * 渲染一个主机分组（含组标题和该组下所有会话卡片）。
 * @param {{host:string, sessions:object[]}} group
 * @returns {string} HTML
 */
function renderGroup(group) {
  const isLocal = group.host === 'local';
  const hostLabel = isLocal
    ? '💻 Local'
    : '🖥️ ' + group.host;

  const cardsHtml = group.sessions.map((s) => renderSessionCard(s)).join('');
  return [
    '<div class="host-group">',
    '  <div class="host-header">',
    '    <span>' + hostLabel + '</span>',
    '    <span class="host-count">' + group.sessions.length + '</span>',
    '  </div>',
    '  <div class="session-cards">' + cardsHtml + '</div>',
    '</div>',
  ].join('');
}

// ─── 会话卡片渲染 ─────────────────────────────────

/**
 * 渲染单个会话卡片的 HTML。
 * @param {object} session - 会话状态对象
 * @returns {string} HTML
 */
function renderSessionCard(session) {
  const id = session.id;
  const title = getTitle(session);
  const badge = session.badge || 'idle';
  const agentIcon = (session.agentId || '?')[0].toUpperCase();
  const cu = session.contextUsage || {};
  const cuPercent = typeof cu.percent === 'number' ? cu.percent : 0;
  const cuUsed = typeof cu.used === 'number' ? cu.used : 0;
  const cuLimit = typeof cu.limit === 'number' ? cu.limit : 0;
  const cColor = contextColor(cuPercent);

  // 最近事件
  const events = session.recentEvents || [];
  const lastEvent = events.length > 0 ? events[events.length - 1] : null;
  let eventLabel = '';
  if (lastEvent) {
    const type = lastEvent.type || '';
    const msg =
      lastEvent.data && lastEvent.data.message
        ? truncate(lastEvent.data.message, 60)
        : '';
    eventLabel = msg ? type + ': ' + msg : type;
  }

  // 源标签
  const sourceTags = [];
  if (session.provider) sourceTags.push(session.provider);
  if (session.wslDistro) sourceTags.push('WSL:' + session.wslDistro);
  if (session.headless) sourceTags.push('headless');
  if (session.platform && session.platform !== process.platform) {
    sourceTags.push(session.platform);
  }

  const sourceHtml = sourceTags
    .map((t) => '<span class="card-source">' + t + '</span>')
    .join('');

  // 需要确认完成时显示 Mark Read 按钮
  const showAck = !!session.requiresCompletionAck;

  // 格式化上下文用量显示
  let contextLabel = Math.round(cuPercent) + '%';
  if (cuUsed > 0 || cuLimit > 0) {
    contextLabel =
      Math.round(cuUsed).toLocaleString() +
      ' / ' +
      Math.round(cuLimit).toLocaleString() +
      ' (' +
      Math.round(cuPercent) +
      '%)';
  }

  return [
    '<div class="session-card" data-session-id="' + id + '" data-badge="' + badge + '">',

    // ── 头部 ──
    '  <div class="card-header">',
    '    <div class="card-id-badge">' + shortId(id) + '</div>',
    '    <div class="card-agent-icon">' + agentIcon + '</div>',
    '    <div class="card-title" data-editable="true">' + escapeHtml(title) + '</div>',
    '  </div>',

    // ── 元数据行 ──
    '  <div class="card-meta">',
    '    <span class="card-agent">' + escapeHtml(session.agentId || 'agent') + '</span>',
    '    <span class="card-status ' + badgeClass(badge) + '">' + badgeLabel(badge) + '</span>',
    '    <span class="card-elapsed" data-timestamp="' + session.updatedAt + '">' + formatElapsed(session.updatedAt) + '</span>',
    sourceHtml,
    '  </div>',

    // ── 路径 ──
    (session.cwd
      ? '  <div class="card-path" title="' + escapeHtml(session.cwd) + '">' + escapeHtml(formatPath(session.cwd)) + '</div>'
      : ''),

    // ── 最近事件 ──
    (eventLabel
      ? '  <div class="card-event">' + escapeHtml(eventLabel) + '</div>'
      : ''),

    // ── 上下文用量 ──
    '  <div class="card-context">',
    '    <div class="context-bar"><div class="context-fill" style="width:' + cuPercent + '%;background:' + cColor + ';"></div></div>',
    '    <span class="context-label">' + contextLabel + '</span>',
    '  </div>',

    // ── 操作按钮 ──
    '  <div class="card-actions">',
    '    <button class="action-btn action-focus" data-action="focus">Jump to Terminal</button>',
    (showAck ? '    <button class="action-btn action-ack" data-action="ack">Mark Read</button>' : ''),
    '    <button class="action-btn action-hide" data-action="hide">Hide</button>',
    '  </div>',

    '</div>',
  ].join('');
}

// ─── 配额汇总渲染 ─────────────────────────────────

/**
 * 渲染全局上下文用量汇总（取所有会话中的最高值）。
 * @param {object[]} sessions - 所有会话对象数组
 */
function renderQuotaSummary(sessions) {
  if (!sessions || sessions.length === 0) {
    if ($quotaSummary) $quotaSummary.classList.add('hidden');
    return;
  }

  // 取最高上下文用量
  let maxPercent = 0;
  let maxUsed = 0;
  let maxLimit = 0;
  for (const s of sessions) {
    if (hiddenSessions.has(s.id)) continue;
    const cu = s.contextUsage || {};
    const pct = typeof cu.percent === 'number' ? cu.percent : 0;
    if (pct > maxPercent) {
      maxPercent = pct;
      maxUsed = typeof cu.used === 'number' ? cu.used : 0;
      maxLimit = typeof cu.limit === 'number' ? cu.limit : 0;
    }
  }

  if (maxPercent === 0) {
    if ($quotaSummary) $quotaSummary.classList.add('hidden');
    return;
  }

  if ($quotaSummary) $quotaSummary.classList.remove('hidden');
  if ($quotaFill) {
    $quotaFill.style.width = maxPercent + '%';
    $quotaFill.style.background = contextColor(maxPercent);
  }
  if ($quotaValue) {
    let label = Math.round(maxPercent) + '%';
    if (maxUsed > 0 || maxLimit > 0) {
      label =
        Math.round(maxUsed).toLocaleString() +
        ' / ' +
        Math.round(maxLimit).toLocaleString() +
        ' (' +
        Math.round(maxPercent) +
        '%)';
    }
    $quotaValue.textContent = label;
  }
}

// ====================================================================
//  事件处理器绑定
// ====================================================================

/**
 * 为一张会话卡片绑定所有交互事件。
 * @param {object} session
 */
function setupCardHandlers(session) {
  const card = document.querySelector(
    '.session-card[data-session-id="' + CSS.escape(session.id) + '"]'
  );
  if (!card) return;

  // ── Focus ──────────────────────────────────
  const focusBtn = card.querySelector('[data-action="focus"]');
  if (focusBtn) {
    focusBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.dashboardAPI.focusSession(session.id);
    });
  }

  // ── Hide ────────────────────────────────────
  const hideBtn = card.querySelector('[data-action="hide"]');
  if (hideBtn) {
    hideBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      hiddenSessions.add(session.id);
      // 从 DOM 中移除卡片（带动画）
      card.style.transition = 'opacity 0.2s, transform 0.2s';
      card.style.opacity = '0';
      card.style.transform = 'scale(0.95)';
      setTimeout(() => {
        // 通知主进程
        window.dashboardAPI.hideSession(session.id).catch(() => {});
        // 重新渲染（如果还有快照的话）
        if (currentSnapshot) render(currentSnapshot);
      }, 200);
    });
  }

  // ── Mark Read (Ack) ─────────────────────────
  const ackBtn = card.querySelector('[data-action="ack"]');
  if (ackBtn) {
    ackBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      window.dashboardAPI.ackCompletion(session.id).then(() => {
        // 按钮移除 + 视觉反馈
        ackBtn.textContent = '✓ Read';
        ackBtn.disabled = true;
        ackBtn.style.opacity = '0.5';
        ackBtn.style.cursor = 'default';
      });
    });
  }

  // ── 标题双击编辑 ────────────────────────────
  const titleEl = card.querySelector('.card-title[data-editable]');
  if (titleEl) {
    titleEl.addEventListener('dblclick', (e) => {
      e.stopPropagation();
      startTitleEdit(titleEl, session);
    });
  }
}

/**
 * 行内编辑会话标题。
 * 双击标题 → 替换为 input → Enter/Escape/blur 确认或取消。
 *
 * @param {HTMLElement} el - .card-title 元素
 * @param {object} session
 */
function startTitleEdit(el, session) {
  const originalText = el.textContent;
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'card-title-input';
  input.value = originalText;
  input.maxLength = 128;

  // 清空并插入输入框
  el.textContent = '';
  el.appendChild(input);
  input.focus();
  input.select();

  let finished = false;

  function finish(save) {
    if (finished) return;
    finished = true;

    if (save && input.value.trim() && input.value.trim() !== originalText) {
      const newTitle = input.value.trim();
      el.textContent = newTitle;
      // 异步存储
      window.dashboardAPI.setSessionAlias(session.id, newTitle).catch(() => {});
      // 更新缓存的会话标题
      if (currentSnapshot && currentSnapshot.sessions[session.id]) {
        currentSnapshot.sessions[session.id].sessionTitle = newTitle;
      }
    } else {
      el.textContent = originalText;
    }
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finish(true);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      finish(false);
    }
  });

  input.addEventListener('blur', () => {
    // 小延迟防止点击按钮时误取消
    setTimeout(() => finish(true), 150);
  });
}

// ====================================================================
//  HTML 转义（防止 XSS）
// ====================================================================

/**
 * 基本的 HTML 实体转义。
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ====================================================================
//  经过时间刷新定时器
// ====================================================================

/**
 * 启动 1 秒间隔的经过时间刷新。
 * 遍历所有 .card-elapsed 元素，更新其显示文本。
 */
function startElapsedTimer() {
  stopElapsedTimer();
  elapsedTimer = setInterval(() => {
    const els = document.querySelectorAll('.card-elapsed');
    for (const el of els) {
      const ts = parseInt(el.dataset.timestamp, 10);
      if (!isNaN(ts)) {
        el.textContent = formatElapsed(ts);
      }
    }
  }, 1000);
}

function stopElapsedTimer() {
  if (elapsedTimer) {
    clearInterval(elapsedTimer);
    elapsedTimer = null;
  }
}

// ====================================================================
//  初始化
// ====================================================================

/**
 * 应用启动入口。
 * 1. 缓存 DOM 引用
 * 2. 获取初始快照并渲染
 * 3. 启动经过时间定时器
 * 4. 监听快照更新和语言变更
 */
async function init() {
  // ── DOM 引用 ──────────────────────────────
  $sessionList = document.getElementById('sessionList');
  $emptyState = document.getElementById('emptyState');
  $sessionCount = document.getElementById('sessionCount');
  $quotaSummary = document.getElementById('quotaSummary');
  $quotaFill = document.getElementById('quotaFill');
  $quotaValue = document.getElementById('quotaValue');

  // ── 刷新按钮 ──────────────────────────────
  const refreshBtn = document.getElementById('refreshBtn');
  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      if (window.dashboardAPI.getSnapshot) {
        window.dashboardAPI.getSnapshot().then((snap) => render(snap));
      }
    });
  }

  // ── 获取初始快照 ──────────────────────────
  try {
    if (window.dashboardAPI.getSnapshot) {
      const snapshot = await window.dashboardAPI.getSnapshot();
      render(snapshot);
    }
  } catch (err) {
    console.error('[Dashboard] Failed to get initial snapshot:', err);
  }

  // ── 启动经过时间刷新 ──────────────────────
  startElapsedTimer();

  // ── 监听快照更新 ──────────────────────────
  if (window.dashboardAPI.onSessionSnapshot) {
    const unsub = window.dashboardAPI.onSessionSnapshot((snapshot) => {
      render(snapshot);
    });
    cleanupFns.push(unsub);
  }

  // ── 监听语言变更 ──────────────────────────
  if (window.dashboardAPI.onLangChange) {
    const unsub = window.dashboardAPI.onLangChange(() => {
      // 简单的重新渲染，后续可以扩展为真正的 i18n 切换
      if (currentSnapshot) render(currentSnapshot);
    });
    cleanupFns.push(unsub);
  }
}

// ─── DOM 就绪后启动 ──────────────────────────
document.addEventListener('DOMContentLoaded', init);

// ─── 页面卸载时清理 ──────────────────────────
window.addEventListener('beforeunload', () => {
  stopElapsedTimer();
  for (const fn of cleanupFns) {
    if (typeof fn === 'function') fn();
  }
  cleanupFns.length = 0;
});
