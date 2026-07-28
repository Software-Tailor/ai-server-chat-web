// AI Server chat — browser side. No framework, no build step.
//
// Calls /v1/* on THIS origin; serve.py forwards it to your AI Server and attaches the
// API key. That's why there's no key field in this UI: the browser never sees it.

const log = document.getElementById('log');
const form = document.getElementById('composer');
const input = document.getElementById('input');
const sendBtn = document.getElementById('send');
const stopBtn = document.getElementById('stop');
const modelSelect = document.getElementById('model');
const backendLabel = document.getElementById('backend');

/** Full conversation, so the model has context on every turn. */
const messages = [];
let controller = null; // lets Stop abort an in-flight completion

// ── rendering ──────────────────────────────────────────────────────────────────
/**
 * Render the small amount of Markdown chat models actually emit — **bold** and `code` —
 * by building DOM NODES rather than assigning innerHTML. Models produce text, and text
 * from a model must never be treated as markup: an innerHTML shortcut here would be a
 * script-injection hole in every client that copied this file.
 */
function renderInline(target, text) {
  target.textContent = '';
  // Alternation over the two forms; capture groups tell us which matched.
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let lastIndex = 0;
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    if (m.index > lastIndex) {
      target.appendChild(document.createTextNode(text.slice(lastIndex, m.index)));
    }
    const el = document.createElement(m[1] !== undefined ? 'strong' : 'code');
    el.textContent = m[1] !== undefined ? m[1] : m[2];
    target.appendChild(el);
    lastIndex = pattern.lastIndex;
  }
  if (lastIndex < text.length) {
    target.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
}

function addMessage(who, text, cls = '') {
  const el = document.createElement('div');
  el.className = `msg ${cls}`;
  el.innerHTML = '<div class="who"></div><div class="body"></div>';   // static markup, no data
  el.querySelector('.who').textContent = who;
  renderInline(el.querySelector('.body'), text);
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el.querySelector('.body');
}

function showError(text) {
  addMessage('Error', text, 'error');
}

// ── model discovery ────────────────────────────────────────────────────────────
// Model ids are specific to each installation, so ask the server rather than guessing.
async function loadModels() {
  try {
    const res = await fetch('/v1/models');
    if (!res.ok) throw new Error(await describeError(res));
    const ids = (await res.json()).data.map((m) => m.id);
    if (!ids.length) { showError('No models installed. Add one in AI Server → Models.'); return; }

    // Local models first (no cloud key needed), and skip reasoning models by default —
    // they emit <think> monologues that read as broken in a plain chat window.
    const isReasoning = (id) => /-r1|r1-|qwq|reasoner|thinking/i.test(id);
    const rank = (id) =>
      (id.startsWith('cloud-') ? 2 : 0) + (isReasoning(id) ? 1 : 0);
    ids.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

    modelSelect.innerHTML = '';
    for (const id of ids) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = id;
      modelSelect.appendChild(opt);
    }
  } catch (e) {
    showError(`Couldn't load models. ${e.message}`);
  }
}

/** Turn an error response into something the user can act on. */
async function describeError(res) {
  if (res.status === 401) {
    return 'The server rejected the API key (401). Issue one in AI Server → API keys and restart serve.py with AISERVER_API_KEY set.';
  }
  if (res.status === 429) {
    return res.headers.get('X-AISuite-Upgrade') === '1'
      ? 'Free-tier limit reached for generic API clients (429). Upgrade the server to Pro to lift it.'
      : `Rate limited (429). Try again in ${res.headers.get('Retry-After') ?? 'a few'} seconds.`;
  }
  if (res.status === 503) {
    return `The server is busy or loading a model (503). Try again in ${res.headers.get('Retry-After') ?? 'a few'} seconds.`;
  }
  if (res.status === 502) {
    return 'serve.py could not reach AI Server. Check it is running and that AISERVER_BASE_URL is right (it must end in /v1).';
  }
  try {
    const body = await res.json();
    return body?.error?.message ?? `HTTP ${res.status}`;
  } catch { return `HTTP ${res.status}`; }
}

// ── chat ───────────────────────────────────────────────────────────────────────
async function send(text) {
  addMessage('You', text, 'user');
  messages.push({ role: 'user', content: text });

  const target = addMessage('AI', '');
  let answer = '';
  controller = new AbortController();
  setBusy(true);

  try {
    const res = await fetch('/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelSelect.value,
        messages,
        stream: true,
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      target.closest('.msg').remove();
      showError(await describeError(res));
      messages.pop();                     // don't keep a turn that never got an answer
      return;
    }

    const backend = res.headers.get('X-AISuite-Backend');
    backendLabel.textContent = backend ? `served by ${backend}` : '';

    // Server-sent events: lines of "data: {json}", ending with "data: [DONE]".
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';         // keep any partial line for the next chunk
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const payload = trimmed.slice(5).trim();
        if (payload === '[DONE]') break;
        try {
          const delta = JSON.parse(payload).choices?.[0]?.delta?.content;
          if (delta) {
            answer += delta;
            renderInline(target, answer);   // re-render so **bold** closes as it streams
            log.scrollTop = log.scrollHeight;
          }
        } catch { /* ignore keep-alive / partial frames */ }
      }
    }

    if (answer) messages.push({ role: 'assistant', content: answer });
    else target.textContent = '(no response)';   // plain text: not model output
  } catch (e) {
    if (e.name === 'AbortError') {
      // Keep whatever streamed before Stop so the context stays coherent.
      if (answer) messages.push({ role: 'assistant', content: answer });
      else target.closest('.msg').remove();
    } else {
      target.closest('.msg').remove();
      showError(e.message);
      messages.pop();
    }
  } finally {
    controller = null;
    setBusy(false);
  }
}

function setBusy(busy) {
  sendBtn.disabled = busy;
  input.disabled = busy;
  stopBtn.hidden = !busy;
  if (!busy) input.focus();
}

// ── wiring ─────────────────────────────────────────────────────────────────────
form.addEventListener('submit', (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = '';
  send(text);
});

// Enter sends, Shift+Enter makes a new line — what people expect from a chat box.
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    form.requestSubmit();
  }
});

stopBtn.addEventListener('click', () => controller?.abort());

document.getElementById('clear').addEventListener('click', () => {
  messages.length = 0;
  log.innerHTML = '';
  backendLabel.textContent = '';
  addMessage('AI', 'Conversation cleared. Ask me anything.');
});

loadModels();
