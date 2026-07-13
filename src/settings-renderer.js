/**
 * CialloForDesktop - 设置面板渲染器
 *
 * 设置面板的 UI 渲染和交互逻辑
 */

// ======== 全局状态 ========

let currentSettings = null;
let appVersion = '1.0.0'; // fallback

// ======== DOM 引用 ========

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

// ======== 工具函数 ========

function showToast(message, isError = false) {
  const old = document.querySelector('.toast');
  if (old) old.remove();
  const toast = document.createElement('div');
  toast.className = 'toast' + (isError ? ' toast-error' : '');
  toast.textContent = message;
  toast.style.cssText = `
    position: fixed; bottom: 20px; left: 50%; transform: translateX(-50%);
    padding: 10px 20px; border-radius: 8px; font-size: 13px; z-index: 100;
    background: ${isError ? '#ff6b6b' : 'var(--pink)'}; color: white;
    box-shadow: 0 2px 10px rgba(255,100,150,0.3); transition: opacity 0.3s;
  `;
  document.body.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 2000);
}

// ======== Tab 导航 ========

function switchTab(tabId) {
  $$('.sidebar-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.tab === tabId);
  });
  renderContent(tabId);
}

// ======== 渲染各 Tab ========

function renderContent(tabId) {
  const content = $('#content');
  switch (tabId) {
    case 'window': renderWindow(content); break;
    case 'size': renderSize(content); break;
    case 'general': renderGeneral(content); break;
    case 'hud': renderHud(content); break;
    case 'sessionHud': renderSessionHud(content); break;
    case 'claude': renderClaude(content); break;
    case 'ssh': renderSsh(content); break;
    case 'agents': renderAgents(content); break;
    case 'shortcuts': renderShortcuts(content); break;
    case 'tray': renderTray(content); break;
    case 'about': renderAbout(content); break;
  }
}

// ---- 📌 置顶/窗口 ----

function renderWindow(container) {
  container.innerHTML = `
    <div class="tab-page">
      <div class="tab-title">📌 窗口设置</div>
      <div class="tab-subtitle">控制丛雨酱窗口的显示行为</div>

      <div class="section">
        <div class="row">
          <div class="row-info">
            <div class="row-label">始终置顶</div>
            <div class="row-desc">让丛雨酱一直显示在所有窗口最前面</div>
          </div>
          <button class="switch ${currentSettings.alwaysOnTop ? 'on' : ''}" data-key="alwaysOnTop"></button>
        </div>
        <div class="row">
          <div class="row-info">
            <div class="row-label">点击穿透</div>
            <div class="row-desc">鼠标事件穿透到下层窗口</div>
          </div>
          <button class="switch ${currentSettings.clickThrough ? 'on' : ''}" data-key="clickThrough"></button>
        </div>
      </div>

      <div class="section">
        <div class="section-title">透明度</div>
        <div class="slider-row">
          <div class="row-info">
            <div class="row-label">窗口透明度</div>
            <div class="row-desc">调整窗口不透明度 (100% = 不透明)</div>
          </div>
          <input type="range" min="30" max="100" value="${Math.round(currentSettings.windowOpacity * 100)}" id="opacitySlider">
          <span class="slider-value" id="opacityValue">${Math.round(currentSettings.windowOpacity * 100)}%</span>
        </div>
      </div>

      <div class="section">
        <div class="row">
          <div class="row-info">
            <div class="row-label">设置窗口置顶</div>
            <div class="row-desc">让设置面板窗口保持在所有窗口最前面</div>
          </div>
          <button class="switch ${currentSettings.settingsWindowAlwaysOnTop ? 'on' : ''}" data-key="settingsWindowAlwaysOnTop"></button>
        </div>
      </div>
    </div>
  `;

  setupOpacitySlider();
  setupSwitches(container);
}

function setupOpacitySlider() {
  const slider = $('#opacitySlider');
  const value = $('#opacityValue');
  if (!slider) return;
  slider.addEventListener('input', () => {
    const val = parseInt(slider.value);
    value.textContent = val + '%';
  });
  slider.addEventListener('change', () => {
    const val = parseInt(slider.value) / 100;
    window.settingsAPI.update('windowOpacity', val).then((res) => {
      if (!res.success) showToast('保存失败', true);
    });
  });
}

// ---- ⚙️ 通用 ----

function renderGeneral(container) {
  container.innerHTML = `
    <div class="tab-page">
      <div class="tab-title">⚙️ 通用设置</div>
      <div class="tab-subtitle">应用基本行为和外观设置</div>

      <div class="section">
        <div class="section-title">语言</div>
        <div class="row">
          <div class="row-info">
            <div class="row-label">界面语言</div>
            <div class="row-desc">设置界面显示语言</div>
          </div>
          <select class="dropdown" id="langSelect">
            <option value="zh-CN" ${currentSettings.language === 'zh-CN' ? 'selected' : ''}>中文</option>
            <option value="en" ${currentSettings.language === 'en' ? 'selected' : ''}>English</option>
            <option value="ja" ${currentSettings.language === 'ja' ? 'selected' : ''}>日本語</option>
            <option value="ko" ${currentSettings.language === 'ko' ? 'selected' : ''}>한국어</option>
          </select>
        </div>
      </div>

      <div class="section">
        <div class="section-title">行为</div>
        <div class="row">
          <div class="row-info">
            <div class="row-label">开机自启</div>
            <div class="row-desc">系统启动时自动运行</div>
          </div>
          <button class="switch ${currentSettings.autoStart ? 'on' : ''}" data-key="autoStart"></button>
        </div>
        <div class="row">
          <div class="row-info">
            <div class="row-label">允许拖拽</div>
            <div class="row-desc">允许鼠标拖拽移动窗口</div>
          </div>
          <button class="switch ${currentSettings.dragEnabled !== false ? 'on' : ''}" data-key="dragEnabled"></button>
        </div>
        <div class="row">
          <div class="row-info">
            <div class="row-label">点击反应</div>
            <div class="row-desc">点击模型时切换表情</div>
          </div>
          <button class="switch ${currentSettings.clickReaction !== false ? 'on' : ''}" data-key="clickReaction"></button>
        </div>
      </div>

      <div class="section">
        <div class="section-title">通知</div>
        <div class="row">
          <div class="row-info">
            <div class="row-label">Ciallo 提示音</div>
            <div class="row-desc">Claude Code 完成/通知时播放提示音</div>
          </div>
          <button class="switch on" id="soundToggle">开</button>
        </div>
      </div>
    </div>
  `;
  setupSwitches(container);
  setupLangSelect();
}

function setupLangSelect() {
  const sel = document.getElementById('langSelect');
  if (sel) {
    sel.addEventListener('change', () => {
      window.settingsAPI.update('language', sel.value).then(r => {
        if (!r.success) showToast('保存失败', true);
      });
    });
  }
}

// ---- 🖥️ 会话 HUD ----

function renderSessionHud(container) {
  container.innerHTML = `
    <div class="tab-page">
      <div class="tab-title">🖥️ 会话 HUD</div>
      <div class="tab-subtitle">Claude Code 会话悬浮窗显示设置</div>

      <div class="section">
        <div class="row">
          <div class="row-info">
            <div class="row-label">启用会话 HUD</div>
            <div class="row-desc">在宠物旁显示会话状态悬浮窗</div>
          </div>
          <button class="switch ${currentSettings.sessionHudEnabled ? 'on' : ''}" data-key="sessionHudEnabled"></button>
        </div>
        <div class="row">
          <div class="row-info">
            <div class="row-label">固定显示</div>
            <div class="row-desc">HUD 始终可见，不自动隐藏</div>
          </div>
          <button class="switch ${currentSettings.sessionHudPinned ? 'on' : ''}" data-key="sessionHudPinned"></button>
        </div>
        <div class="row">
          <div class="row-info">
            <div class="row-label">显示状态标签</div>
            <div class="row-desc">在会话行上显示 Thinking/Working 等标签</div>
          </div>
          <button class="switch ${currentSettings.sessionHudShowLabels !== false ? 'on' : ''}" data-key="sessionHudShowLabels"></button>
        </div>
      </div>
    </div>
  `;
  setupSwitches(container);
}

// ---- 👤 Agent 管理 ----

function renderAgents(container) {
  container.innerHTML = `
    <div class="tab-page">
      <div class="tab-title">👤 Agent 管理</div>
      <div class="tab-subtitle">管理和检测已安装的 AI 编码助手</div>

      <div class="section">
        <div class="row">
          <div class="row-info">
            <div class="row-label">自动检测 Agent</div>
            <div class="row-desc">检测系统中安装的 AI 编码助手并显示在此处</div>
          </div>
          <button class="switch ${currentSettings.agentDetectionEnabled !== false ? 'on' : ''}" data-key="agentDetectionEnabled"></button>
        </div>
      </div>

      <div class="section">
        <div class="section-title">已检测的 Agent</div>
        <div id="agentList" style="padding:14px;text-align:center;color:var(--text-muted);font-size:13px;">
          加载中...
        </div>
      </div>
    </div>
  `;
  setupSwitches(container);
  loadAgentList();
}

async function loadAgentList() {
  const list = document.getElementById('agentList');
  if (!list) return;
  // 简单显示已知 Agent
  const knownAgents = [
    { id: 'claude-code', name: 'Claude Code', icon: '🤖' },
    { id: 'codex', name: 'Codex CLI', icon: '📝' },
    { id: 'gemini-cli', name: 'Gemini CLI', icon: '✨' },
    { id: 'copilot-cli', name: 'GitHub Copilot', icon: '🎯' },
  ];
  list.innerHTML = knownAgents.map(a => `
    <div class="row" style="margin-bottom:4px;">
      <div class="row-info">
        <div class="row-label">${a.icon} ${a.name}</div>
        <div class="row-desc">${a.id}</div>
      </div>
      <span style="font-size:12px;padding:2px 8px;border-radius:4px;background:#e8f5e9;color:#4caf50;">已支持</span>
    </div>
  `).join('');
}

// ---- ⌨️ 快捷键 ----

function renderShortcuts(container) {
  container.innerHTML = `
    <div class="tab-page">
      <div class="tab-title">⌨️ 快捷键</div>
      <div class="tab-subtitle">桌面宠物的键盘快捷键</div>

      <div class="section">
        <div class="section-title">窗口控制</div>
        <div class="row">
          <div class="row-info"><div class="row-label">切换点击穿透</div></div>
          <span style="font-size:13px;color:var(--pink);font-weight:600;">Ctrl+T</span>
        </div>
        <div class="row">
          <div class="row-info"><div class="row-label">重置表情</div></div>
          <span style="font-size:13px;color:var(--pink);font-weight:600;">Esc</span>
        </div>
        <div class="row">
          <div class="row-info"><div class="row-label">打开设置</div></div>
          <span style="font-size:13px;color:var(--pink);font-weight:600;">Ctrl+,</span>
        </div>
      </div>

      <div class="section">
        <div class="section-title">表情切换</div>
        <div class="row">
          <div class="row-info"><div class="row-label">切换对应表情</div></div>
          <span style="font-size:13px;color:var(--pink);font-weight:600;">1 - 8</span>
        </div>
      </div>

      <div class="section">
        <div class="section-title">Claude Code</div>
        <div class="row">
          <div class="row-info"><div class="row-label">聚焦终端</div></div>
          <span style="font-size:13px;color:var(--text-muted);">点击 HUD 会话行</span>
        </div>
      </div>
    </div>
  `;
}

// ---- 📏 大小 ----

function renderSize(container) {
  container.innerHTML = `
    <div class="tab-page">
      <div class="tab-title">📏 大小设置</div>
      <div class="tab-subtitle">调整丛雨酱在屏幕上的显示大小</div>

      <div class="section">
        <div class="slider-row">
          <div class="row-info">
            <div class="row-label">模型缩放</div>
            <div class="row-desc">选择预设尺寸快速调整丛雨酱的大小</div>
          </div>
          <div class="size-picker" id="sizePicker">
            <button class="size-btn" data-scale="0.5">S</button>
            <button class="size-btn" data-scale="0.75">M</button>
            <button class="size-btn active" data-scale="0.85">L</button>
            <button class="size-btn" data-scale="1.15">XL</button>
            <button class="size-btn" data-scale="1.5">XXL</button>
          </div>
        </div>
      </div>
    </div>
  `;

  setupSizePicker();
}

function setupSizePicker() {
  const picker = $('#sizePicker');
  if (!picker) return;

  const currentScale = currentSettings.modelScale;
  picker.querySelectorAll('.size-btn').forEach((btn) => {
    const scale = parseFloat(btn.dataset.scale);
    btn.classList.toggle('active', Math.abs(scale - currentScale) < 0.05);
    btn.addEventListener('click', () => {
      picker.querySelectorAll('.size-btn').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');
      window.settingsAPI.update('modelScale', scale).then((res) => {
        if (!res.success) showToast('保存失败: ' + (res.error || ''), true);
      });
    });
  });
}

// ---- 📊 HUD ----

function renderHud(container) {
  const positionOptions = [
    { value: 'top-left', label: '左上' },
    { value: 'top-right', label: '右上' },
    { value: 'bottom-left', label: '左下' },
    { value: 'bottom-right', label: '右下' },
  ];

  container.innerHTML = `
    <div class="tab-page">
      <div class="tab-title">📊 HUD 设置</div>
      <div class="tab-subtitle">屏幕信息叠加层显示设置</div>

      <div class="section">
        <div class="row">
          <div class="row-info">
            <div class="row-label">启用 HUD</div>
            <div class="row-desc">在模型窗口上显示信息面板</div>
          </div>
          <button class="switch ${currentSettings.enableHUD ? 'on' : ''}" data-key="enableHUD"></button>
        </div>
      </div>

      <div class="section">
        <div class="section-title">显示内容</div>
        <div class="row">
          <div class="row-info">
            <div class="row-label">显示时钟</div>
            <div class="row-desc">显示当前时间</div>
          </div>
          <button class="switch ${currentSettings.hudShowClock ? 'on' : ''}" data-key="hudShowClock"></button>
        </div>
        <div class="row">
          <div class="row-info">
            <div class="row-label">显示表情名称</div>
            <div class="row-desc">显示当前表情名称</div>
          </div>
          <button class="switch ${currentSettings.hudShowExpressionName ? 'on' : ''}" data-key="hudShowExpressionName"></button>
        </div>
        <div class="row">
          <div class="row-info">
            <div class="row-label">显示状态指示</div>
            <div class="row-desc">显示点击穿透、鼠标追踪等状态</div>
          </div>
          <button class="switch ${currentSettings.hudShowStatusIndicators ? 'on' : ''}" data-key="hudShowStatusIndicators"></button>
        </div>
        <div class="row">
          <div class="row-info">
            <div class="row-label">随机问候语</div>
            <div class="row-desc">HUD 中每隔一段时间显示随机问候</div>
          </div>
          <button class="switch ${currentSettings.hudShowGreetings ? 'on' : ''}" data-key="hudShowGreetings"></button>
        </div>
      </div>

      <div class="section">
        <div class="section-title">外观</div>
        <div class="row">
          <div class="row-info">
            <div class="row-label">HUD 位置</div>
            <div class="row-desc">信息面板在窗口中的位置</div>
          </div>
          <select class="dropdown" id="hudPosition">
            ${positionOptions.map(opt =>
              `<option value="${opt.value}" ${currentSettings.hudPosition === opt.value ? 'selected' : ''}>${opt.label}</option>`
            ).join('')}
          </select>
        </div>
        <div class="slider-row">
          <div class="row-info">
            <div class="row-label">HUD 透明度</div>
            <div class="row-desc">调整 HUD 面板的透明度</div>
          </div>
          <input type="range" min="30" max="100" value="${Math.round(currentSettings.hudOpacity * 100)}" id="hudOpacitySlider">
          <span class="slider-value slider-value-wide" id="hudOpacityValue">${Math.round(currentSettings.hudOpacity * 100)}%</span>
        </div>
      </div>
    </div>
  `;

  setupSwitches(container);
  setupHudOpacitySlider();
  setupHudPositionDropdown();
}

function setupHudOpacitySlider() {
  const slider = $('#hudOpacitySlider');
  const value = $('#hudOpacityValue');
  if (!slider) return;
  slider.addEventListener('input', () => {
    const val = parseInt(slider.value);
    value.textContent = val + '%';
  });
  slider.addEventListener('change', () => {
    const val = parseInt(slider.value) / 100;
    window.settingsAPI.update('hudOpacity', val).then((res) => {
      if (!res.success) showToast('保存失败', true);
    });
  });
}

function setupHudPositionDropdown() {
  const select = $('#hudPosition');
  if (!select) return;
  select.addEventListener('change', () => {
    window.settingsAPI.update('hudPosition', select.value).then((res) => {
      if (!res.success) showToast('保存失败', true);
    });
  });
}

// ---- 🤖 Claude Code ----

function renderClaude(container) {
  container.innerHTML = `
    <div class="tab-page">
      <div class="tab-title">🤖 Claude Code 监控</div>
      <div class="tab-subtitle">监控本地和远程 Claude Code 会话状态</div>

      <div class="section">
        <div class="row">
          <div class="row-info">
            <div class="row-label">启用 Claude Code 监控</div>
            <div class="row-desc">检测 Claude Code 进程并在 HUD 中显示状态</div>
          </div>
          <button class="switch ${currentSettings.enableClaudeMonitor ? 'on' : ''}" data-key="enableClaudeMonitor"></button>
        </div>
      </div>

      <div class="section">
        <div class="section-title">HUD 显示</div>
        <div class="row">
          <div class="row-info">
            <div class="row-label">显示 Claude 状态</div>
            <div class="row-desc">在 HUD 面板中显示 Claude Code 运行状态</div>
          </div>
          <button class="switch ${currentSettings.hudShowClaudeStatus !== false ? 'on' : ''}" data-key="hudShowClaudeStatus"></button>
        </div>
      </div>

      <div class="section" id="claudeStatusSection" style="display:none;">
        <div class="section-title">当前状态</div>
        <div class="row" id="claudeStatusRow">
          <div class="row-info">
            <div class="row-label" id="claudeStatusLabel">等待检测...</div>
            <div class="row-desc">Claude Code 会话状态</div>
          </div>
        </div>
      </div>
    </div>
  `;

  setupSwitches(container);

  // 拉取当前 Claude 状态
  if (window.settingsAPI.getClaudeStatus) {
    window.settingsAPI.getClaudeStatus().then(status => {
      const section = document.getElementById('claudeStatusSection');
      const label = document.getElementById('claudeStatusLabel');
      if (section && label) {
        section.style.display = 'block';
        if (status && status.running) {
          label.innerHTML = '🟢 运行中 (' + status.sessions + ' 会话)';
        } else {
          label.innerHTML = '⚪ 未检测到 Claude Code 会话';
        }
      }
    }).catch(() => {});
  }
}

// ---- 🔌 SSH 远程连接 ----

let sshStatusTimer = null;

function renderSsh(container) {
  container.innerHTML = `
    <div class="tab-page">
      <div class="tab-title">🔌 SSH 远程连接</div>
      <div class="tab-subtitle">管理远程服务器的 SSH 连接，监控远程 Claude Code</div>

      <div class="section">
        <div class="row">
          <div class="row-info">
            <div class="row-label">启用 SSH 远程</div>
            <div class="row-desc">允许通过 SSH 连接远程服务器</div>
          </div>
          <button class="switch ${currentSettings.enableSshRemote ? 'on' : ''}" data-key="enableSshRemote"></button>
        </div>
      </div>

      <div class="section">
        <div class="section-title">SSH 配置</div>
        <div id="sshProfileList"></div>
        <div style="margin-top:10px;">
          <button class="btn btn-primary" id="addSshBtn">+ 添加配置</button>
        </div>
      </div>

      <div class="section" id="sshFormSection" style="display:none;">
        <div class="section-title" id="sshFormTitle">添加 SSH 配置</div>
        <div style="background:var(--bg-white);padding:14px;border-radius:var(--radius);box-shadow:var(--shadow-sm);">
          <div style="margin-bottom:8px;">
            <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:2px;">名称</label>
            <input type="text" id="sshFormName" style="width:100%;padding:6px 8px;border:2px solid var(--pink-lighter);border-radius:var(--radius-sm);font-size:13px;outline:none;">
          </div>
          <div style="display:flex;gap:8px;margin-bottom:8px;">
            <div style="flex:3;">
              <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:2px;">主机</label>
              <input type="text" id="sshFormHost" placeholder="192.168.1.100" style="width:100%;padding:6px 8px;border:2px solid var(--pink-lighter);border-radius:var(--radius-sm);font-size:13px;outline:none;">
            </div>
            <div style="flex:1;">
              <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:2px;">端口</label>
              <input type="number" id="sshFormPort" value="22" style="width:100%;padding:6px 8px;border:2px solid var(--pink-lighter);border-radius:var(--radius-sm);font-size:13px;outline:none;">
            </div>
          </div>
          <div style="margin-bottom:8px;">
            <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:2px;">用户名</label>
            <input type="text" id="sshFormUser" value="root" style="width:100%;padding:6px 8px;border:2px solid var(--pink-lighter);border-radius:var(--radius-sm);font-size:13px;outline:none;">
          </div>
          <div style="margin-bottom:8px;">
            <label style="font-size:12px;color:var(--text-secondary);display:block;margin-bottom:2px;">SSH 密钥路径（可选）</label>
            <input type="text" id="sshFormKey" placeholder="~/.ssh/id_rsa" style="width:100%;padding:6px 8px;border:2px solid var(--pink-lighter);border-radius:var(--radius-sm);font-size:13px;outline:none;">
          </div>
          <div style="display:flex;gap:8px;justify-content:flex-end;">
            <button class="btn" id="sshFormCancel">取消</button>
            <button class="btn btn-primary" id="sshFormSave">保存</button>
          </div>
        </div>
      </div>
    </div>
  `;

  setupSwitches(container);
  setupSshForm();
  refreshSshProfileList();
  startSshStatusPolling();
}

function setupSshForm() {
  let editingId = null;

  document.getElementById('addSshBtn').addEventListener('click', () => {
    editingId = null;
    document.getElementById('sshFormTitle').textContent = '添加 SSH 配置';
    document.getElementById('sshFormName').value = '';
    document.getElementById('sshFormHost').value = '';
    document.getElementById('sshFormPort').value = '22';
    document.getElementById('sshFormUser').value = 'root';
    document.getElementById('sshFormKey').value = '';
    document.getElementById('sshFormSection').style.display = 'block';
  });

  document.getElementById('sshFormCancel').addEventListener('click', () => {
    document.getElementById('sshFormSection').style.display = 'none';
  });

  document.getElementById('sshFormSave').addEventListener('click', async () => {
    const name = document.getElementById('sshFormName').value.trim();
    const host = document.getElementById('sshFormHost').value.trim();
    const port = parseInt(document.getElementById('sshFormPort').value) || 22;
    const user = document.getElementById('sshFormUser').value.trim() || 'root';
    const keyPath = document.getElementById('sshFormKey').value.trim();

    if (!host) {
      showToast('请输入主机地址', true);
      return;
    }

    const profile = {
      id: editingId || 'ssh_' + Date.now(),
      name: name || host,
      host,
      port,
      user,
      keyPath,
    };

    if (window.settingsAPI.sshSaveProfile) {
      const result = await window.settingsAPI.sshSaveProfile(profile);
      if (result.success) {
        showToast('保存成功');
        document.getElementById('sshFormSection').style.display = 'none';
        refreshSshProfileList();
      } else {
        showToast('保存失败: ' + (result.error || ''), true);
      }
    }
  });
}

async function refreshSshProfileList() {
  const list = document.getElementById('sshProfileList');
  if (!list) return;

  let profiles = [];
  let statuses = [];
  if (window.settingsAPI.sshListStatuses) {
    try {
      statuses = await window.settingsAPI.sshListStatuses();
    } catch (_) {}
  }

  // 从当前设置中获取 profiles
  if (currentSettings && Array.isArray(currentSettings.sshProfiles)) {
    profiles = currentSettings.sshProfiles;
  }

  if (profiles.length === 0) {
    list.innerHTML = '<div style="padding:14px;text-align:center;color:var(--text-muted);font-size:13px;">还没有 SSH 配置，点击上方按钮添加</div>';
    return;
  }

  list.innerHTML = profiles.map(p => {
    const st = statuses.find(s => s.profileId === p.id);
    const statusText = st ? getStatusText(st.status) : '⚪ 未连接';
    const statusClass = st ? st.status : 'disconnected';
    return `
      <div class="row" style="flex-wrap:wrap;">
        <div class="row-info">
          <div class="row-label">${p.name}</div>
          <div class="row-desc">${p.user}@${p.host}:${p.port}</div>
        </div>
        <div style="font-size:12px;padding:2px 8px;border-radius:4px;background:var(--pink-lighter);margin-right:8px;">${statusText}</div>
        <div style="display:flex;gap:4px;">
          <button class="btn ssh-connect-btn" data-profile-id="${p.id}" style="font-size:12px;padding:4px 10px;">
            ${st && st.status === 'connected' ? '断开' : '连接'}
          </button>
          <button class="btn ssh-delete-btn" data-profile-id="${p.id}" style="font-size:12px;padding:4px 10px;color:#ff6b6b;">删除</button>
        </div>
      </div>
    `;
  }).join('');

  // 连接/断开按钮
  list.querySelectorAll('.ssh-connect-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const pid = btn.dataset.profileId;
      const st = statuses.find(s => s.profileId === pid);
      if (st && st.status === 'connected') {
        if (window.settingsAPI.sshDisconnect) {
          await window.settingsAPI.sshDisconnect(pid);
          showToast('已断开连接');
        }
      } else {
        if (window.settingsAPI.sshConnect) {
          const result = await window.settingsAPI.sshConnect(pid);
          if (result.success) {
            showToast('正在连接...');
          } else {
            showToast('连接失败: ' + (result.error || ''), true);
          }
        }
      }
    });
  });

  // 删除按钮
  list.querySelectorAll('.ssh-delete-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const pid = btn.dataset.profileId;
      if (window.settingsAPI.sshDeleteProfile) {
        const result = await window.settingsAPI.sshDeleteProfile(pid);
        if (result.success) {
          showToast('已删除');
          refreshSshProfileList();
        }
      }
    });
  });
}

function getStatusText(status) {
  switch (status) {
    case 'connected': return '🟢 已连接';
    case 'connecting': return '🟡 连接中';
    case 'failed': return '🔴 失败';
    case 'disconnected': return '⚪ 未连接';
    default: return '⚪ 未知';
  }
}

function startSshStatusPolling() {
  stopSshStatusPolling();
  if (window.settingsAPI.sshListStatuses) {
    sshStatusTimer = setInterval(refreshSshProfileList, 3000);
  }
}

function stopSshStatusPolling() {
  if (sshStatusTimer) {
    clearInterval(sshStatusTimer);
    sshStatusTimer = null;
  }
}

// ---- 🧩 系统托盘 ----

function renderTray(container) {
  container.innerHTML = `
    <div class="tab-page">
      <div class="tab-title">🧩 系统托盘设置</div>
      <div class="tab-subtitle">控制系统托盘图标和窗口关闭行为</div>

      <div class="section">
        <div class="row">
          <div class="row-info">
            <div class="row-label">显示托盘图标</div>
            <div class="row-desc">在系统托盘中显示应用图标</div>
          </div>
          <button class="switch ${currentSettings.showTrayIcon !== false ? 'on' : ''}" data-key="showTrayIcon"></button>
        </div>
        <div class="row">
          <div class="row-info">
            <div class="row-label">最小化到系统托盘</div>
            <div class="row-desc">关闭窗口时将应用隐藏到系统托盘而不是退出</div>
          </div>
          <button class="switch ${currentSettings.minimizeToTray ? 'on' : ''}" data-key="minimizeToTray"></button>
        </div>
        <div class="row">
          <div class="row-info">
            <div class="row-label">关闭按钮操作</div>
            <div class="row-desc">点击关闭时执行的操作</div>
          </div>
          <select class="dropdown" id="closeAction">
            <option value="minimize-to-tray" ${currentSettings.closeButtonAction === 'minimize-to-tray' ? 'selected' : ''}>最小化到托盘</option>
            <option value="quit" ${currentSettings.closeButtonAction === 'quit' ? 'selected' : ''}>退出程序</option>
          </select>
        </div>
      </div>

      <div class="section">
        <div class="section-title">启动</div>
        <div class="row">
          <div class="row-info">
            <div class="row-label">开机自启</div>
            <div class="row-desc">系统启动时自动运行 CialloForDesktop</div>
          </div>
          <button class="switch ${currentSettings.autoStart ? 'on' : ''}" data-key="autoStart"></button>
        </div>
      </div>
    </div>
  `;

  setupSwitches(container);
  setupCloseActionDropdown();
}

function setupCloseActionDropdown() {
  const select = $('#closeAction');
  if (!select) return;
  select.addEventListener('change', () => {
    window.settingsAPI.update('closeButtonAction', select.value).then((res) => {
      if (!res.success) showToast('保存失败', true);
    });
  });
}

// ---- 关于 ----

function renderAbout(container) {
  container.innerHTML = `
    <div class="tab-page">
      <div class="about-header">
        <div class="about-title">Ciallo～(∠?ω< )⌒★!</div>
        <div class="about-version">v${appVersion}</div>
        <div class="about-model">一款基于 Live2D 的桌面宠物</div>
      </div>

      <div class="about-section">
        <div class="about-section-title">💝 感谢使用</div>
        <div class="about-credit">
          模型: <strong>浴衣丛雨 (Murasame Yukata)</strong><br>
          版权: <strong>© ゆずソフト (Yuzu-Soft)</strong><br>
          仅供个人使用，请勿用于直播或商业用途<br>
          <br>
          <span class="about-link" id="officialSiteLink" style="font-size:13px;">
            🌐 官方网站 · m1f.cn →
          </span>
          <br>
          <span class="about-link" id="githubLink" style="font-size:13px;">
            📂 源代码 · GitHub →
          </span>
        </div>
      </div>

      <div class="about-section">
        <div class="about-section-title">🛠️ 技术栈</div>
        <div class="about-credit">
          Electron · PixiJS · Live2D Cubism 4<br>
          pixi-live2d-display · electron-builder
        </div>
      </div>

      <div class="about-section">
        <div class="about-section-title">⌨️ 快捷键</div>
        <div class="about-credit">
          <strong>Ctrl+T</strong> — 切换点击穿透<br>
          <strong>Esc</strong> — 重置表情<br>
          <strong>1-8</strong> — 直接切换对应表情
        </div>
      </div>

      <div class="footer-actions">
        <button class="btn" id="resetBtn">重置所有设置</button>
      </div>
    </div>
  `;

  // m1f.cn 官网链接
  document.getElementById('officialSiteLink').addEventListener('click', () => {
    window.settingsAPI.openExternal('https://m1f.cn');
  });

  // GitHub 链接
  document.getElementById('githubLink').addEventListener('click', () => {
    window.settingsAPI.openExternal('https://github.com/yttbz/ciallo-for-desktop');
  });

  // 重置按钮
  document.getElementById('resetBtn').addEventListener('click', async () => {
    const result = await window.settingsAPI.reset();
    if (result.success) {
      showToast('已重置为默认设置');
    } else {
      showToast('重置失败', true);
    }
  });

  // 设置窗口置顶开关
  setupSwitches(container);
}

// ======== 通用开关组件 ========

function setupSwitches(container) {
  container.querySelectorAll('.switch').forEach((sw) => {
    sw.addEventListener('click', async () => {
      const key = sw.dataset.key;
      const newState = !sw.classList.contains('on');

      // 即时视觉反馈
      sw.classList.toggle('on');

      const result = await window.settingsAPI.update(key, newState);
      if (!result.success) {
        // 失败回滚
        sw.classList.toggle('on');
        showToast('保存失败', true);
      }

      // 表情切换间隔的特殊处理
      if (key === 'expressionCycle') {
        const row = document.getElementById('expressionIntervalRow');
        if (row) {
          row.style.opacity = newState ? '1' : '0.4';
        }
      }
    });
  });
}

// ======== 设置变更监听 ========

function onSettingsChanged(settings) {
  currentSettings = settings;
  const activeTab = document.querySelector('.sidebar-item.active');
  if (activeTab) {
    renderContent(activeTab.dataset.tab);
  }
}

// ======== 启动 ========

async function init() {
  // 获取初始设置
  currentSettings = await window.settingsAPI.getSettings();

  // 获取应用版本号
  try {
    if (window.settingsAPI.getAppVersion) {
      appVersion = await window.settingsAPI.getAppVersion();
    }
  } catch (e) {
    console.warn('[Settings] Failed to get app version:', e.message);
  }

  // 监听变更
  window.settingsAPI.onChanged(onSettingsChanged);

  // 标签页切换
  $$('.sidebar-item').forEach((item) => {
    item.addEventListener('click', () => {
      switchTab(item.dataset.tab);
    });
  });

  // 渲染默认 Tab
  renderContent('window');
}

document.addEventListener('DOMContentLoaded', init);
