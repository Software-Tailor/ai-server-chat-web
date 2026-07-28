# AI Server chat (web)

A complete streaming chat UI for **[Software Tailor AI Server](https://softwaretailor.com/docs/ai-server/index.htm)**
in three files and **zero dependencies** — no npm, no bundler, no framework.

- Streams replies token by token
- Lists the models installed on *your* server and lets you switch between them
- Keeps the whole conversation as context, with **Stop** and **Clear**
- Turns AI Server's error responses into plain advice instead of a spinner that never ends
- **Your API key never reaches the browser**

```
python serve.py     →     http://localhost:8800
```

*(Add a screenshot or short GIF here.)*

---

## Run it

**Prerequisites:** AI Server running, an API key from **AI Server → API keys**, and Python 3.8+
(no packages needed).

```bash
export AISERVER_BASE_URL="http://192.168.1.42:11436/v1"   # from AI Server's Server page
export AISERVER_API_KEY="ai-suite_..."                     # from AI Server -> API keys
python serve.py
```

PowerShell:

```powershell
$env:AISERVER_BASE_URL = "http://192.168.1.42:11436/v1"
$env:AISERVER_API_KEY  = "ai-suite_..."
python serve.py
```

Then open <http://localhost:8800>. Use `PORT=9000 python serve.py` to move it.

| Variable | Required | Meaning |
| --- | --- | --- |
| `AISERVER_BASE_URL` | yes | Base URL **including `/v1`** |
| `AISERVER_API_KEY` | yes | Key from AI Server → API keys |
| `PORT` | no | Local port (default `8800`) |

---

## Why there's a `serve.py` and not just an HTML file

The honest answer, because it's the first thing you'll wonder:

**AI Server doesn't send CORS headers**, and its `OPTIONS` preflight requires authentication — which
browsers never send on a preflight. A page opened from `file://` or hosted on a different origin is
therefore blocked by the browser before the request is even made.

`serve.py` (≈150 lines, standard library only) fixes that by serving the page and the API from the
**same origin**: it hosts `index.html` and forwards `/v1/*` to your server.

That turns out to be the better design anyway:

| | Key in the browser | Key in `serve.py` |
| --- | --- | --- |
| Visible in devtools / `localStorage` | ⚠️ yes | ✅ no |
| Leaks in a screenshot or screen-share | ⚠️ easily | ✅ no |
| Reaches page JavaScript at all | ⚠️ yes | ✅ no |

The proxy binds **loopback only** — it holds your key, so it must not be reachable from the network.
It is a local convenience, not a shared gateway. To give other people access, point them at AI Server
itself with their own keys.

## How it works

| File | Role |
| --- | --- |
| [`serve.py`](serve.py) | Serves the page; forwards `/v1/*` upstream with the key; streams responses through unbuffered |
| [`index.html`](index.html) | Markup + CSS (light/dark follows your OS) |
| [`app.js`](app.js) | Model discovery, SSE streaming, conversation state, error messages |

Worth reading if you're writing your own client:

- **Streaming is SSE.** Lines of `data: {json}` ending with `data: [DONE]`. `app.js` reads the body as a
  stream and keeps partial lines between chunks — the usual bug is a client that splits on `\n` and
  loses a frame cut mid-way.
- **Don't buffer the proxy.** `serve.py` flushes each chunk; without that the UI sits silent and then
  dumps the entire answer at once.
- **Model ids are per-installation** (`enginea/llama3.2/3b`, `cloud-anthropic/…`), so the picker is
  filled from `GET /v1/models`. Local, non-reasoning models sort first — reasoning models emit
  `<think>` monologues that read as broken in a plain chat window, though you can still select them.
- **Errors are explained, not swallowed:** `401` (bad key), `429` + `X-AISuite-Upgrade` (free-tier cap
  for generic clients — retrying won't help), `429`/`503` + `Retry-After` (busy), `502` (proxy can't
  reach the server).

## Troubleshooting

**"serve.py could not reach AI Server."** Check `AISERVER_BASE_URL` ends in `/v1`. If the server is on
another machine it must serve your network (**Server settings → Access → This network**) and be allowed
through its firewall — **Network diagnostics → Test connectivity** on that machine checks all of it.

**"The server rejected the API key (401)."** Issue a fresh key in **API keys** and restart `serve.py`.
Keys apply immediately on the server side; `serve.py` only reads yours at startup.

**Model list is empty.** Install a model from AI Server's **Models** page.

## Learn more

- [AI Server API & clients](https://softwaretailor.com/docs/ai-server/api-clients.htm)
- [ai-server-quickstarts](https://github.com/Software-Tailor/ai-server-quickstarts) — the same API in
  curl, Python, Node.js, C# and PowerShell

## Licence

[MIT](LICENSE) — copy any of this into your own project.
