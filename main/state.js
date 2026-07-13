/**
 * CialloForDesktop - 会话状态机
 *
 * 跟踪 Claude Code 等 Agent 的会话状态。
 * 从 clawd-on-desk 的 state.js 移植/精简。
 */

const MAX_SESSIONS = 20;
const STALE_CHECK_INTERVAL = 10000; // 10 秒
const STALE_SESSION_MS = 300000;    // 5 分钟无更新视为陈旧

// 事件类型
const EVENTS = {
  USER_PROMPT: 'UserPromptSubmit',
  PRE_TOOL_USE: 'PreToolUse',
  POST_TOOL_USE: 'PostToolUse',
  POST_TOOL_FAIL: 'PostToolUseFailure',
  STOP: 'Stop',
  SESSION_END: 'SessionEnd',
  SUBAGENT_START: 'SubagentStart',
  SUBAGENT_STOP: 'SubagentStop',
  PERMISSION_REQ: 'PermissionRequest',
  NOTIFICATION: 'Notification',
};

// 状态优先级（数字越大优先级越高）
const STATE_PRIORITY = {
  'notification': 100,
  'attention': 90,
  'working': 80,
  'juggling': 75,
  'thinking': 70,
  'idle': 10,
  'sleeping': 0,
};

// 默认状态
const DEFAULT_STATE = 'idle';

/**
 * 创建状态管理器
 * @param {object} opts - { log, onStateChange(stateName) }
 */
function createStateManager(opts = {}) {
  const log = opts.log || console.log;
  const onStateChange = opts.onStateChange || (() => {});
  const sessions = new Map();
  let currentPetState = DEFAULT_STATE;
  let staleTimer = null;
  let snapshotSig = '';

  /**
   * 检查进程是否存活
   */
  function isProcessAlive(pid) {
    if (!pid || pid <= 0) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch (e) {
      return e.code === 'EPERM'; // 进程存在但权限不足
    }
  }

  /**
   * 从事件中派生 badge
   */
  function deriveBadge(recentEvents) {
    if (!recentEvents || recentEvents.length === 0) return 'idle';
    const last = recentEvents[recentEvents.length - 1];
    if (!last) return 'idle';
    switch (last.type) {
      case EVENTS.STOP:
      case EVENTS.SESSION_END:
        return 'done';
      case EVENTS.POST_TOOL_FAIL:
        return 'interrupted';
      case EVENTS.PRE_TOOL_USE:
      case EVENTS.POST_TOOL_USE:
      case EVENTS.USER_PROMPT:
        return 'running';
      default:
        return 'idle';
    }
  }

  /**
   * 派生会话显示状态
   */
  function deriveSessionState(session) {
    if (!session || !session.recentEvents || session.recentEvents.length === 0) {
      return DEFAULT_STATE;
    }
    const last = session.recentEvents[session.recentEvents.length - 1];
    if (!last) return DEFAULT_STATE;

    if (session.badge === 'done' || session.badge === 'interrupted') {
      return 'idle';
    }

    switch (last.type) {
      case EVENTS.PRE_TOOL_USE:
        return 'working';
      case EVENTS.POST_TOOL_USE:
        return 'thinking';
      case EVENTS.USER_PROMPT:
        return 'idle';
      case EVENTS.SUBAGENT_START:
        return 'juggling';
      case EVENTS.PERMISSION_REQ:
        return 'notification';
      case EVENTS.NOTIFICATION:
        return 'notification';
      default:
        return 'idle';
    }
  }

  /**
   * 解析所有会话中最高优先级的宠物显示状态
   */
  function resolvePetState() {
    let highestState = DEFAULT_STATE;
    let highestPriority = STATE_PRIORITY[DEFAULT_STATE] || 0;

    for (const session of sessions.values()) {
      const s = deriveSessionState(session);
      const p = STATE_PRIORITY[s] || 0;
      if (p > highestPriority) {
        highestPriority = p;
        highestState = s;
      }
    }

    return highestState;
  }

  /**
   * 应用宠物状态（发生变化时通知）
   */
  function applyPetState(newState) {
    if (newState !== currentPetState) {
      const old = currentPetState;
      currentPetState = newState;
      log(`[State] ${old} → ${newState}`);
      onStateChange(newState);
    }
  }

  /**
   * 更新或创建会话
   */
  function updateSession(sessionId, state, event, opts = {}) {
    const now = Date.now();
    let session = sessions.get(sessionId);

    if (!session) {
      if (sessions.size >= MAX_SESSIONS) {
        log(`[State] Max sessions (${MAX_SESSIONS}) reached, dropping ${sessionId}`);
        return;
      }
      session = {
        id: sessionId,
        agentId: opts.agent_id || 'claude-code',
        state: DEFAULT_STATE,
        badge: 'idle',
        sessionTitle: opts.session_title || '',
        cwd: opts.cwd || '',
        model: opts.model || '',
        provider: opts.provider || '',
        host: opts.host || '',
        wslDistro: opts.wsl_distro || '',
        headless: !!opts.headless,
        platform: opts.platform || '',
        contextUsage: opts.context_usage || { used: 0, limit: 0, percent: 0 },
        recentEvents: [],
        agentPid: opts.agent_pid || 0,
        sourcePid: opts.source_pid || 0,
        pidReachable: true,
        updatedAt: now,
        createdAt: now,
        requiresCompletionAck: false,
        displayHint: '',
        resumeState: null,
      };
      sessions.set(sessionId, session);
      log(`[State] New session: ${sessionId} (agent: ${session.agentId})`);
    }

    // 更新 metadata
    if (opts.session_title) session.sessionTitle = opts.session_title;
    if (opts.cwd) session.cwd = opts.cwd;
    if (opts.model) session.model = opts.model;
    if (opts.provider) session.provider = opts.provider;
    if (opts.host) session.host = opts.host;
    if (opts.wsl_distro) session.wslDistro = opts.wsl_distro;
    if (opts.headless !== undefined) session.headless = opts.headless;
    if (opts.platform) session.platform = opts.platform;
    if (opts.context_usage) session.contextUsage = opts.context_usage;
    if (opts.agent_pid) session.agentPid = opts.agent_pid;
    if (opts.source_pid) session.sourcePid = opts.source_pid;

    // 处理事件
    const evt = { type: event, timestamp: now, data: opts };
    session.recentEvents.push(evt);
    if (session.recentEvents.length > 20) {
      session.recentEvents.shift();
    }

    // 特殊事件处理
    if (event === EVENTS.SESSION_END) {
      sessions.delete(sessionId);
      log(`[State] Session ended: ${sessionId}`);
      applyPetState(resolvePetState());
      return;
    }

    if (event === EVENTS.SUBAGENT_START) {
      session.resumeState = session.state;
      session.state = 'juggling';
    } else if (event === EVENTS.SUBAGENT_STOP && session.resumeState) {
      session.state = session.resumeState;
      session.resumeState = null;
    } else if (event === EVENTS.PERMISSION_REQ) {
      session.state = 'notification';
    } else if (event === EVENTS.STOP) {
      // Stop 完成门控: 如果有后台任务，不立即设为 idle
      const bgTasks = opts.background_tasks_count || 0;
      const stopHook = opts.stop_hook_active || false;
      if (bgTasks > 0 || stopHook) {
        session.state = 'working';
        session.requiresCompletionAck = true;
      } else {
        session.state = 'idle';
        session.badge = 'done';
      }
    } else {
      session.state = state || DEFAULT_STATE;
    }

    session.badge = deriveBadge(session.recentEvents);
    session.updatedAt = now;

    // 更新宠物显示状态
    applyPetState(resolvePetState());
  }

  /**
   * 清理陈旧会话
   */
  function cleanStaleSessions() {
    const now = Date.now();
    let changed = false;

    for (const [id, session] of sessions.entries()) {
      // 检查进程存活
      const alive = isProcessAlive(session.agentPid) || isProcessAlive(session.sourcePid);
      session.pidReachable = alive;

      // 检查超时
      const elapsed = now - session.updatedAt;
      if (!alive && elapsed > STALE_SESSION_MS) {
        sessions.delete(id);
        log(`[State] Stale session removed: ${id} (no process, ${Math.round(elapsed/1000)}s inactive)`);
        changed = true;
      } else if (!alive && session.badge === 'done') {
        sessions.delete(id);
        log(`[State] Completed session cleaned: ${id}`);
        changed = true;
      }
    }

    if (changed) {
      applyPetState(resolvePetState());
    }
  }

  /**
   * 启动陈旧清理定时器
   */
  function startStaleCleanup() {
    stopStaleCleanup();
    staleTimer = setInterval(cleanStaleSessions, STALE_CHECK_INTERVAL);
  }

  function stopStaleCleanup() {
    if (staleTimer) {
      clearInterval(staleTimer);
      staleTimer = null;
    }
  }

  /**
   * 获取会话快照（序列化用）
   */
  function getSnapshot() {
    const result = {};
    const orderedIds = [];
    for (const [id, session] of sessions.entries()) {
      orderedIds.push(id);
      result[id] = {
        id: session.id,
        agentId: session.agentId,
        state: session.state,
        badge: session.badge,
        sessionTitle: session.sessionTitle,
        cwd: session.cwd,
        model: session.model,
        provider: session.provider,
        host: session.host,
        wslDistro: session.wslDistro,
        headless: session.headless,
        platform: session.platform,
        contextUsage: session.contextUsage,
        updatedAt: session.updatedAt,
        createdAt: session.createdAt,
        recentEventsCount: session.recentEvents.length,
        pidReachable: session.pidReachable,
        requiresCompletionAck: session.requiresCompletionAck,
        displayHint: session.displayHint,
      };
    }
    return {
      sessions: result,
      orderedIds,
      petState: currentPetState,
      sessionCount: orderedIds.length,
    };
  }

  /**
   * 获取所有会话
   */
  function getAllSessions() {
    return Array.from(sessions.values());
  }

  /**
   * 获取单个会话
   */
  function getSession(sessionId) {
    return sessions.get(sessionId) || null;
  }

  /**
   * 获取当前宠物状态
   */
  function getPetState() {
    return currentPetState;
  }

  return {
    updateSession,
    getSnapshot,
    cleanStaleSessions,
    startStaleCleanup,
    stopStaleCleanup,
    getAllSessions,
    getSession,
    getPetState,
    isProcessAlive,
  };
}

module.exports = { createStateManager, EVENTS, STATE_PRIORITY };
