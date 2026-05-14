(function () {
  'use strict';

  // @ts-ignore - injected by VSCode
  const vscode = acquireVsCodeApi();

  const messagesEl = document.getElementById('messages');
  const statusEl = document.getElementById('status-bar');
  const configEl = document.getElementById('config-view');
  const typingEl = document.getElementById('typing-indicator');
  const inputEl = document.getElementById('input');
  const sendBtn = document.getElementById('send');
  const suggestionsEl = document.getElementById('suggestions');

  let commands = [];
  let visibleSuggestions = [];
  let selectedIdx = 0;
  let configOpen = false;
  let typingTimer = null;
  const TYPING_TIMEOUT_MS = 6500;
  const pendingByTempId = new Map();
  const displayedIds = new Set();

  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, function (c) {
      return ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c];
    });
  }


  function formatTime(ts) {
    const d = new Date(ts);
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    return h + ':' + m;
  }

  function makeMessageEl(msg) {
    const wrap = document.createElement('div');
    wrap.className = 'msg-wrap ' + (msg.outgoing ? 'outgoing' : 'incoming');

    const el = document.createElement('div');
    el.className = 'msg ' + (msg.outgoing ? 'outgoing' : 'incoming');
    if (msg.pending) el.classList.add('pending');
    if (msg.error) el.classList.add('error');
    const body = document.createElement('div');
    body.className = 'body';
    if (!msg.outgoing && msg.renderedHtml) {
      body.classList.add('md-body');
      body.innerHTML = msg.renderedHtml;
    } else {
      body.innerHTML = escapeHtml(msg.text || '');
    }
    const time = document.createElement('div');
    time.className = 'time';
    let timeText = formatTime(msg.timestamp);
    if (msg.error) timeText += ' - failed: ' + msg.error;
    time.textContent = timeText;
    el.appendChild(body);
    el.appendChild(time);
    wrap.appendChild(el);

    if (msg.buttons && msg.buttons.length && typeof msg.id === 'number') {
      wrap.appendChild(makeButtonsEl(msg.id, msg.buttons));
    }
    return wrap;
  }

  function makeButtonsEl(messageId, rows) {
    const container = document.createElement('div');
    container.className = 'msg-buttons';
    for (let r = 0; r < rows.length; r++) {
      const rowEl = document.createElement('div');
      rowEl.className = 'btn-row';
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        rowEl.appendChild(makeButtonEl(messageId, row[c]));
      }
      container.appendChild(rowEl);
    }
    return container;
  }

  function makeButtonEl(messageId, btn) {
    const b = document.createElement('button');
    b.className = 'inline-btn kind-' + btn.kind;
    b.textContent = btn.text || '?';
    if (btn.kind === 'unsupported') {
      b.disabled = true;
      b.title = 'This button type is not supported';
      return b;
    }
    if (btn.kind === 'url') {
      b.title = btn.url || '';
      b.addEventListener('click', function () {
        if (btn.url) {
          vscode.postMessage({ type: 'openExternal', url: btn.url });
        }
      });
      return b;
    }
    b.addEventListener('click', function () {
      if (b.disabled) return;
      b.disabled = true;
      b.classList.add('clicked');
      vscode.postMessage({
        type: 'clickButton',
        messageId: messageId,
        row: btn.row,
        col: btn.col,
      });
      // Re-enable after a short window so the user can retry if no response arrives
      setTimeout(function () {
        b.disabled = false;
        b.classList.remove('clicked');
      }, 4000);
    });
    return b;
  }

  function scrollToBottom() {
    requestAnimationFrame(function () {
      messagesEl.scrollTop = messagesEl.scrollHeight;
    });
  }

  messagesEl.addEventListener('click', function (e) {
    const a = e.target && e.target.closest && e.target.closest('a[href]');
    if (a && a.closest('.md-body')) {
      e.preventDefault();
      const url = a.getAttribute('href');
      if (url && /^(https?|tg):\/\//i.test(url)) {
        vscode.postMessage({ type: 'openExternal', url: url });
      }
    }
  });

  function clearEmpty() {
    const empty = messagesEl.querySelector('.empty');
    if (empty) empty.remove();
  }

  function showEmpty() {
    messagesEl.innerHTML = '<div class="empty">No messages yet. Say hi to your agent.</div>';
  }

  function appendPending(tempId, text) {
    clearEmpty();
    const el = makeMessageEl({
      tempId: tempId,
      text: text,
      outgoing: true,
      timestamp: Date.now(),
      pending: true,
    });
    pendingByTempId.set(tempId, el);
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  function appendMessage(msg) {
    if (typeof msg.id === 'number') {
      if (displayedIds.has(msg.id)) return;
      displayedIds.add(msg.id);
    }
    if (!msg.outgoing) {
      setTyping(false);
    }
    clearEmpty();
    const el = makeMessageEl(msg);
    messagesEl.appendChild(el);
    scrollToBottom();
  }

  function handleSendOk(tempId, msg) {
    const pendingEl = pendingByTempId.get(tempId);
    pendingByTempId.delete(tempId);
    if (typeof msg.id === 'number' && displayedIds.has(msg.id)) {
      // Live event already added the real message — drop the pending placeholder.
      if (pendingEl) pendingEl.remove();
      return;
    }
    if (typeof msg.id === 'number') displayedIds.add(msg.id);
    const newEl = makeMessageEl(msg);
    if (pendingEl) {
      pendingEl.replaceWith(newEl);
    } else {
      clearEmpty();
      messagesEl.appendChild(newEl);
      scrollToBottom();
    }
  }

  function handleSendError(tempId, error) {
    const pendingEl = pendingByTempId.get(tempId);
    if (!pendingEl) return;
    pendingByTempId.delete(tempId);
    const inner = pendingEl.querySelector('.msg') || pendingEl;
    inner.classList.remove('pending');
    inner.classList.add('error');
    const timeEl = pendingEl.querySelector('.time');
    if (timeEl) timeEl.textContent += ' - failed: ' + error;
  }

  function setState(state, detail) {
    const connected = state === 'connected';
    inputEl.disabled = !connected;
    sendBtn.disabled = !connected;

    if (state === 'noCredentials' || state === 'noBot') {
      renderStatusBar(state, detail);
      renderOnboarding(state);
      return;
    }

    // leaving onboarding -> clear it if present
    if (messagesEl.querySelector('.onboarding')) {
      messagesEl.innerHTML = '';
    }

    renderStatusBar(state, detail);
  }

  function renderStatusBar(state, detail) {
    statusEl.innerHTML = '';

    const connected = state === 'connected';
    let text = '';
    let actionBtn = null;
    switch (state) {
      case 'loggedOut':
        text = detail ? 'Not logged in: ' + detail : 'Not logged in.';
        actionBtn = { label: 'Login', action: 'login' };
        break;
      case 'connecting':
        text = (detail || 'Connecting') + '...';
        break;
      case 'noCredentials':
      case 'noBot':
        text = '';
        break;
      case 'connected':
        text = '';
        break;
      default:
        text = state;
    }

    const span = document.createElement('span');
    span.textContent = text;
    span.style.flex = '1';
    statusEl.appendChild(span);

    if (actionBtn) {
      const b = document.createElement('button');
      b.textContent = actionBtn.label;
      b.addEventListener('click', function () {
        vscode.postMessage({ type: actionBtn.action });
      });
      statusEl.appendChild(b);
    }

    const cfg = document.createElement('button');
    cfg.textContent = 'Config';
    cfg.className = 'config-btn';
    cfg.title = 'Edit API ID, API hash, and bot username';
    cfg.addEventListener('click', function () {
      vscode.postMessage({ type: 'openConfig' });
    });
    statusEl.appendChild(cfg);

    // Always visible so Config is reachable. When connected with no text/action,
    // the bar stays slim and only shows the Config button.
    statusEl.classList.add('visible');
    if (connected && !text) {
      statusEl.classList.add('slim');
    } else {
      statusEl.classList.remove('slim');
    }
  }

  function openConfigView(values) {
    configOpen = true;
    messagesEl.classList.add('hidden');
    configEl.classList.remove('hidden');
    renderConfigView(values);
  }

  function closeConfigView() {
    configOpen = false;
    configEl.classList.add('hidden');
    configEl.innerHTML = '';
    messagesEl.classList.remove('hidden');
  }

  function renderConfigView(values) {
    const apiId = values && values.apiId ? values.apiId : '';
    const apiHash = values && values.apiHash ? values.apiHash : '';
    const botUsername = values && values.botUsername ? values.botUsername : '';

    configEl.innerHTML =
      '<div class="config">' +
        '<h2>Settings</h2>' +
        '<p class="lead">Edit your Telegram credentials and bot username, then Save. ' +
        'Changing API ID or hash will clear the saved session and require a new login.</p>' +

        '<div class="field">' +
          '<label for="cfg-api-id">API ID</label>' +
          '<input id="cfg-api-id" type="text" inputmode="numeric" autocomplete="off" spellcheck="false" />' +
          '<p class="hint">Numeric, from my.telegram.org/apps</p>' +
        '</div>' +

        '<div class="field">' +
          '<label for="cfg-api-hash">API hash</label>' +
          '<div class="input-row">' +
            '<input id="cfg-api-hash" type="password" autocomplete="off" spellcheck="false" />' +
            '<button type="button" class="reveal-btn" id="cfg-api-hash-reveal">Show</button>' +
          '</div>' +
          '<p class="hint">From my.telegram.org/apps</p>' +
        '</div>' +

        '<div class="field">' +
          '<label for="cfg-bot">Bot username</label>' +
          '<input id="cfg-bot" type="text" autocomplete="off" spellcheck="false" />' +
          '<p class="hint">Without the @ prefix</p>' +
        '</div>' +

        '<div class="config-error hidden" id="cfg-error"></div>' +

        '<div class="config-actions">' +
          '<button class="primary" id="cfg-save">Save</button>' +
          '<button id="cfg-cancel">Cancel</button>' +
        '</div>' +
      '</div>';

    const apiIdInput = document.getElementById('cfg-api-id');
    const apiHashInput = document.getElementById('cfg-api-hash');
    const botInput = document.getElementById('cfg-bot');
    apiIdInput.value = apiId;
    apiHashInput.value = apiHash;
    botInput.value = botUsername;

    const revealBtn = document.getElementById('cfg-api-hash-reveal');
    revealBtn.addEventListener('click', function () {
      if (apiHashInput.type === 'password') {
        apiHashInput.type = 'text';
        revealBtn.textContent = 'Hide';
      } else {
        apiHashInput.type = 'password';
        revealBtn.textContent = 'Show';
      }
    });

    const saveBtn = document.getElementById('cfg-save');
    saveBtn.addEventListener('click', function () {
      hideConfigError();
      saveBtn.disabled = true;
      saveBtn.textContent = 'Saving...';
      vscode.postMessage({
        type: 'saveConfig',
        values: {
          apiId: apiIdInput.value,
          apiHash: apiHashInput.value,
          botUsername: botInput.value,
        },
      });
    });

    const cancelBtn = document.getElementById('cfg-cancel');
    cancelBtn.addEventListener('click', function () {
      closeConfigView();
    });
  }

  function showConfigError(msg) {
    const errEl = document.getElementById('cfg-error');
    if (!errEl) return;
    errEl.textContent = msg;
    errEl.classList.remove('hidden');
    const saveBtn = document.getElementById('cfg-save');
    if (saveBtn) {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save';
    }
  }

  function hideConfigError() {
    const errEl = document.getElementById('cfg-error');
    if (!errEl) return;
    errEl.textContent = '';
    errEl.classList.add('hidden');
  }

  function renderOnboarding(state) {
    const needsCreds = state === 'noCredentials';
    const intro = needsCreds
      ? 'Three things to get connected.'
      : 'Almost there. You just need the bot username.';

    messagesEl.innerHTML =
      '<div class="onboarding">' +
        '<h2>Welcome to Telegram Agent Console</h2>' +
        '<p class="lead">' + intro + '</p>' +

        (needsCreds ? (
          '<section class="card">' +
            '<h3><span class="step">1</span> Get Telegram API credentials</h3>' +
            '<p>Telegram requires a personal <code>api_id</code> and ' +
            '<code>api_hash</code>. Get them once at <a href="#" data-url="https://my.telegram.org/apps">my.telegram.org/apps</a>.</p>' +
            '<ol>' +
              '<li>Log in with your phone number (Telegram will send a code to your app).</li>' +
              '<li>Click <em>API development tools</em>.</li>' +
              '<li>Fill in any app name and short name; "Desktop" platform is fine.</li>' +
              '<li>Copy <code>api_id</code> (a number) and <code>api_hash</code> (long string).</li>' +
            '</ol>' +
            '<button class="link-btn" data-action="openExternal" data-url="https://my.telegram.org/apps">' +
              'Open my.telegram.org/apps' +
            '</button>' +
          '</section>'
        ) : '') +

        '<section class="card">' +
          '<h3><span class="step">' + (needsCreds ? '2' : '1') + '</span> Your bot\'s username</h3>' +
          '<p>You only need the <strong>username</strong> here (not the bot token). ' +
          'This extension talks to the bot AS you, using your account.</p>' +
          '<p>Don\'t have a bot yet?</p>' +
          '<ol>' +
            '<li>Open <a href="#" data-url="https://t.me/BotFather">@BotFather</a> in Telegram.</li>' +
            '<li>Send <code>/newbot</code> and follow the prompts.</li>' +
            '<li>Pick a username ending in <code>bot</code> (e.g. <code>my_agent_bot</code>).</li>' +
          '</ol>' +
          '<button class="link-btn" data-action="openExternal" data-url="https://t.me/BotFather">' +
            'Open @BotFather' +
          '</button>' +
        '</section>' +

        '<section class="card">' +
          '<h3><span class="step">' + (needsCreds ? '3' : '2') + '</span> Save and log in</h3>' +
          '<p>Click below to save your credentials. Right after, you\'ll be ' +
          'asked to log in with your phone number and a one-time code Telegram sends to your app.</p>' +
          '<button class="primary" data-action="setup">Start Setup</button>' +
        '</section>' +
      '</div>';

    // wire buttons
    const buttons = messagesEl.querySelectorAll('button[data-action]');
    for (let i = 0; i < buttons.length; i++) {
      const btn = buttons[i];
      btn.addEventListener('click', function () {
        const action = btn.getAttribute('data-action');
        if (action === 'openExternal') {
          vscode.postMessage({ type: 'openExternal', url: btn.getAttribute('data-url') });
        } else if (action === 'setup') {
          vscode.postMessage({ type: 'setup' });
        }
      });
    }
    // wire inline links
    const links = messagesEl.querySelectorAll('a[data-url]');
    for (let i = 0; i < links.length; i++) {
      const a = links[i];
      a.addEventListener('click', function (e) {
        e.preventDefault();
        vscode.postMessage({ type: 'openExternal', url: a.getAttribute('data-url') });
      });
    }
  }

  function init(messages) {
    messagesEl.innerHTML = '';
    displayedIds.clear();
    pendingByTempId.clear();
    if (!messages || messages.length === 0) {
      showEmpty();
      return;
    }
    for (let i = 0; i < messages.length; i++) {
      const m = messages[i];
      if (typeof m.id === 'number') displayedIds.add(m.id);
      messagesEl.appendChild(makeMessageEl(m));
    }
    scrollToBottom();
  }

  function updateSuggestions() {
    const text = inputEl.value;
    // only suggest if input starts with a single slash on first line
    if (!text.startsWith('/') || text.indexOf(' ') !== -1 || text.indexOf('\n') !== -1) {
      hideSuggestions();
      return;
    }
    const q = text.slice(1).toLowerCase();
    visibleSuggestions = commands.filter(function (c) {
      return c.command.toLowerCase().startsWith(q);
    });
    if (visibleSuggestions.length === 0) {
      hideSuggestions();
      return;
    }
    selectedIdx = Math.min(selectedIdx, visibleSuggestions.length - 1);
    if (selectedIdx < 0) selectedIdx = 0;
    renderSuggestions();
    suggestionsEl.classList.remove('hidden');
  }

  function renderSuggestions() {
    suggestionsEl.innerHTML = '';
    for (let i = 0; i < visibleSuggestions.length; i++) {
      const c = visibleSuggestions[i];
      const el = document.createElement('div');
      el.className = 'suggestion' + (i === selectedIdx ? ' selected' : '');
      const cmd = document.createElement('span');
      cmd.className = 'cmd';
      cmd.textContent = '/' + c.command;
      const desc = document.createElement('span');
      desc.className = 'desc';
      desc.textContent = c.description;
      el.appendChild(cmd);
      el.appendChild(desc);
      el.addEventListener('mousedown', function (e) {
        e.preventDefault();
        applySuggestion(i);
      });
      suggestionsEl.appendChild(el);
    }
  }

  function hideSuggestions() {
    suggestionsEl.classList.add('hidden');
    visibleSuggestions = [];
    selectedIdx = 0;
  }

  function applySuggestion(i) {
    const c = visibleSuggestions[i];
    if (!c) return;
    inputEl.value = '/' + c.command + ' ';
    hideSuggestions();
    inputEl.focus();
    autoResize();
  }

  function autoResize() {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 200) + 'px';
  }

  function send() {
    const text = inputEl.value;
    const trimmed = text.replace(/\s+$/g, '');
    if (!trimmed) return;
    const tempId = 't_' + Date.now() + '_' + Math.random().toString(36).slice(2, 7);
    appendPending(tempId, trimmed);
    vscode.postMessage({ type: 'send', tempId: tempId, text: trimmed });
    inputEl.value = '';
    autoResize();
    hideSuggestions();
  }

  inputEl.addEventListener('input', function () {
    autoResize();
    updateSuggestions();
  });

  inputEl.addEventListener('keydown', function (e) {
    if (!suggestionsEl.classList.contains('hidden') && visibleSuggestions.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIdx = (selectedIdx + 1) % visibleSuggestions.length;
        renderSuggestions();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIdx = (selectedIdx - 1 + visibleSuggestions.length) % visibleSuggestions.length;
        renderSuggestions();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        applySuggestion(selectedIdx);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        hideSuggestions();
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  });

  sendBtn.addEventListener('click', send);

  window.addEventListener('message', function (event) {
    const msg = event.data;
    switch (msg.type) {
      case 'state':
        setState(msg.state, msg.detail);
        break;
      case 'init':
        commands = msg.commands || [];
        init(msg.messages || []);
        setState('connected');
        break;
      case 'newMessage':
        appendMessage(msg.message);
        break;
      case 'sendOk':
        handleSendOk(msg.tempId, msg.message);
        break;
      case 'sendError':
        handleSendError(msg.tempId, msg.error);
        break;
      case 'commands':
        commands = msg.commands || [];
        break;
      case 'configValues':
        openConfigView(msg.values);
        break;
      case 'configSaved':
        closeConfigView();
        break;
      case 'configError':
        showConfigError(msg.error || 'Could not save settings.');
        break;
      case 'typing':
        setTyping(msg.isTyping);
        break;
      case 'buttonResult':
        handleButtonResult(msg);
        break;
    }
  });

  function setTyping(isTyping) {
    if (typingTimer) {
      clearTimeout(typingTimer);
      typingTimer = null;
    }
    if (isTyping) {
      typingEl.classList.remove('hidden');
      scrollToBottom();
      // Telegram resends typing every few seconds; clear if the stream stops.
      typingTimer = setTimeout(function () {
        typingEl.classList.add('hidden');
        typingTimer = null;
      }, TYPING_TIMEOUT_MS);
    } else {
      typingEl.classList.add('hidden');
    }
  }

  function handleButtonResult(msg) {
    // Bot returned a callback answer — show inline below the message.
    // No-op for now beyond the error path; alert text is shown via vscode notification on host side.
    if (msg.error) {
      const note = document.createElement('div');
      note.className = 'btn-note error';
      note.textContent = 'Button failed: ' + msg.error;
      messagesEl.appendChild(note);
      scrollToBottom();
    }
  }

  vscode.postMessage({ type: 'ready' });
})();
