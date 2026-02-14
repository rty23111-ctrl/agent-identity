export const dashboardHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8" />
  <title>Agent Identity Dashboard</title>
  <style>
    :root {
      --bg-top: #f4f7ff;
      --bg-bottom: #f9fbff;
      --card-bg: #ffffff;
      --border: #dfe5f2;
      --text: #1d2a44;
      --subtle: #5a6780;
      --button: #2f6bff;
      --button-hover: #2553c7;
      --danger: #d64747;
      --danger-hover: #b93737;
      --radius: 14px;
      --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
      --shadow: 0 14px 36px rgba(22, 45, 90, 0.08);
    }

    * { box-sizing: border-box; }

    body {
      font-family: Inter, "Segoe UI", system-ui, -apple-system, sans-serif;
      background:
        radial-gradient(circle at 10% 0%, #e8efff 0%, transparent 40%),
        radial-gradient(circle at 90% 0%, #edf6ff 0%, transparent 36%),
        linear-gradient(180deg, var(--bg-top) 0%, var(--bg-bottom) 100%);
      color: var(--text);
      margin: 0;
      padding: 34px 22px 50px;
      max-width: 1120px;
      margin-left: auto;
      margin-right: auto;
    }

    .hero {
      margin-bottom: 22px;
    }

    h1 {
      margin: 0;
      font-size: clamp(1.6rem, 2vw + 1rem, 2.15rem);
      letter-spacing: -0.02em;
    }

    .subtitle {
      margin: 8px 0 0;
      color: var(--subtle);
      font-size: 0.98rem;
    }

    .api-info {
      margin-top: 14px;
      display: inline-flex;
      align-items: center;
      gap: 8px;
      padding: 9px 12px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: rgba(255, 255, 255, 0.8);
      color: var(--subtle);
      font-size: 0.88rem;
      backdrop-filter: blur(4px);
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(300px, 1fr));
      gap: 16px;
      align-items: start;
    }

    .card {
      background: var(--card-bg);
      border: 1px solid var(--border);
      border-radius: var(--radius);
      padding: 18px;
      box-shadow: var(--shadow);
    }

    .card h2 {
      margin: 0 0 12px;
      font-size: 1.05rem;
      letter-spacing: 0.01em;
    }

    input {
      width: 100%;
      padding: 10px 12px;
      margin: 0 0 12px;
      border: 1px solid var(--border);
      border-radius: 10px;
      font-size: 0.95rem;
      color: var(--text);
      background: #fff;
      transition: border-color 0.2s, box-shadow 0.2s;
    }

    input:focus {
      outline: none;
      border-color: #9fb7ff;
      box-shadow: 0 0 0 3px rgba(47, 107, 255, 0.16);
    }

    button {
      background: var(--button);
      color: white;
      border: none;
      padding: 9px 14px;
      border-radius: 10px;
      font-size: 0.92rem;
      font-weight: 600;
      letter-spacing: 0.01em;
      cursor: pointer;
      transition: transform 0.08s, background 0.18s;
    }

    button:hover {
      background: var(--button-hover);
    }

    button:active {
      transform: translateY(1px);
    }

    button.danger {
      background: var(--danger);
    }

    button.danger:hover {
      background: var(--danger-hover);
    }

    pre {
      background: #f8faff;
      border: 1px solid var(--border);
      padding: 10px 12px;
      border-radius: 10px;
      font-family: var(--mono);
      font-size: 0.82rem;
      line-height: 1.45;
      white-space: pre-wrap;
      overflow-wrap: anywhere;
      margin-top: 10px;
      min-height: 44px;
      color: #27334f;
    }

    @media (max-width: 820px) {
      body { padding: 20px 14px 34px; }
      .grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>

  <section class="hero">
    <h1>Agent Identity Dashboard</h1>
    <p class="subtitle">Manage clients and token lifecycle from one place.</p>
    <div class="api-info">
      <strong>API Base:</strong> <span id="api-base"></span>
    </div>
    <div class="card" style="margin-top: 14px;">
      <h2>API Authentication (optional)</h2>
      <input id="api-key" placeholder="x-api-key (saved in this browser)" />
      <pre id="auth-out">Leave empty if ADMIN_API_KEY is not configured on the service.</pre>
    </div>
  </section>

  <main class="grid">
    <div class="card">
      <h2>Register Client</h2>
      <input id="reg-client-id" placeholder="clientId" />
      <button id="reg-btn">Register</button>
      <pre id="reg-out"></pre>
    </div>

    <div class="card">
      <h2>Issue Token</h2>
      <input id="tok-client-id" placeholder="clientId" />
      <button id="tok-btn">Issue Token</button>
      <pre id="tok-out"></pre>
    </div>

    <div class="card">
      <h2>Validate Token</h2>
      <input id="val-token" placeholder="token JSON" />
      <button id="val-btn">Validate</button>
      <pre id="val-out"></pre>
    </div>

    <div class="card">
      <h2>List Clients</h2>
      <input id="clients-limit" placeholder="limit (1-100, default 25)" value="25" />
      <div style="display:flex; gap:8px; flex-wrap:wrap; margin-bottom:8px;">
        <button id="clients-btn">Load Clients</button>
        <button id="clients-next-btn">Next Page</button>
        <button id="clients-prev-btn">Previous Page</button>
        <button id="clients-clear-btn" class="danger">Clear All Clients</button>
      </div>
      <pre id="clients-page-info">No page loaded yet.</pre>
      <pre id="clients-out"></pre>
    </div>

    <div class="card">
      <h2>Delete Client</h2>
      <input id="del-client-id" placeholder="clientId" />
      <button id="del-btn" class="danger">Delete Client</button>
      <pre id="del-out"></pre>
    </div>

    <div class="card">
      <h2>Capabilities</h2>
      <button id="cap-btn">Load Capabilities</button>
      <pre id="cap-out"></pre>
    </div>

    <div class="card">
      <h2>Health</h2>
      <button id="health-btn">Check Health</button>
      <pre id="health-out"></pre>
    </div>
  </main>

  <script type="module">
    function fmt(str) {
      try { return JSON.stringify(JSON.parse(str), null, 2); }
      catch { return str; }
    }

    function getApiKey() {
      var el = document.getElementById("api-key");
      return (el && el.value ? el.value : "").trim();
    }

    function buildHeaders(includeJson) {
      var headers = {};
      if (includeJson) headers["Content-Type"] = "application/json";

      var apiKey = getApiKey();
      if (apiKey) headers["x-api-key"] = apiKey;

      return headers;
    }

    async function _postJson(base, path, body) {
      const url = base.replace(/\\/$/, "") + path;
      const res = await fetch(url, {
        method: "POST",
        headers: buildHeaders(true),
        body: JSON.stringify(body),
      });
      const text = await res.text();
      return { ok: res.ok, status: res.status, text };
    }

    async function _get(base, path) {
      const url = base.replace(/\\/$/, "") + path;
      const res = await fetch(url, { headers: buildHeaders(false) });
      const text = await res.text();
      return { ok: res.ok, status: res.status, text };
    }

    async function _delete(base, path) {
      const url = base.replace(/\\/$/, "") + path;
      const res = await fetch(url, { method: "DELETE", headers: buildHeaders(false) });
      const text = await res.text();
      return { ok: res.ok, status: res.status, text };
    }

    function createDashboardClient(base) {
      return {
        register: function(clientId) { return _postJson(base, "/api/register", { clientId: clientId }); },
        issueToken: function(clientId) { return _postJson(base, "/api/token", { clientId: clientId }); },
        validate: function(token) { return _postJson(base, "/api/validate", JSON.parse(token)); },
        health: function() { return _get(base, "/health"); },
        capabilities: function() { return _get(base, "/capabilities"); },
        listClients: function(limit, cursor) {
          var params = [];
          if (limit) params.push("limit=" + encodeURIComponent(String(limit)));
          if (cursor) params.push("cursor=" + encodeURIComponent(String(cursor)));
          var suffix = params.length ? "?" + params.join("&") : "";
          return _get(base, "/api/clients" + suffix);
        },
        clearClients: function() { return _delete(base, "/api/clients"); },
        deleteClient: function(clientId) { return _delete(base, "/api/clients/" + clientId); },
        fmt: fmt
      };
    }

    var DEPLOY_URL = "https://YOUR-WORKER-NAME.YOUR-SUBDOMAIN.workers.dev";

    var API_BASE =
      window.location.hostname.endsWith("app.github.dev")
        ? window.location.origin
        : DEPLOY_URL;

    document.getElementById("api-base").textContent = API_BASE;

    var savedApiKey = localStorage.getItem("agentIdentityApiKey") || "";
    document.getElementById("api-key").value = savedApiKey;
    document.getElementById("api-key").addEventListener("input", function(event) {
      var value = event && event.target && event.target.value ? event.target.value : "";
      localStorage.setItem("agentIdentityApiKey", value);
    });

    var client = createDashboardClient(API_BASE);
    var clientsPaginationState = {
      nextCursor: null,
      hasMore: false,
      cursorStack: [],
      currentCursor: null,
    };

    function getClientsLimit() {
      var raw = (document.getElementById("clients-limit").value || "").trim();
      var parsed = Number(raw || "25");
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) return null;
      return parsed;
    }

    function renderClientsPageInfo(limit) {
      var info = {
        limit: limit,
        currentCursor: clientsPaginationState.currentCursor,
        nextCursor: clientsPaginationState.nextCursor,
        hasMore: clientsPaginationState.hasMore,
      };
      document.getElementById("clients-page-info").textContent = client.fmt(JSON.stringify(info));
    }

    async function loadClientsPage(cursor, trackHistory) {
      var limit = getClientsLimit();
      if (limit === null) {
        document.getElementById("clients-page-info").textContent = "limit must be an integer between 1 and 100";
        return;
      }

      var res = await client.listClients(limit, cursor || undefined);
      document.getElementById("clients-out").textContent = client.fmt(res.text);

      try {
        var parsed = JSON.parse(res.text);
        var pagination = parsed.pagination || {};

        if (trackHistory && clientsPaginationState.currentCursor !== null) {
          clientsPaginationState.cursorStack.push(clientsPaginationState.currentCursor);
        }

        clientsPaginationState.currentCursor = cursor || null;
        clientsPaginationState.nextCursor = pagination.nextCursor || null;
        clientsPaginationState.hasMore = !!pagination.hasMore;
        renderClientsPageInfo(limit);
      } catch {
        document.getElementById("clients-page-info").textContent = "Unable to parse pagination response.";
      }
    }

    document.getElementById("reg-btn").onclick = async function() {
      var id = document.getElementById("reg-client-id").value;
      var res = await client.register(id);
      document.getElementById("reg-out").textContent = client.fmt(res.text);
      if (id) document.getElementById("tok-client-id").value = id;
    };

    document.getElementById("tok-btn").onclick = async function() {
      var id = document.getElementById("tok-client-id").value;
      var res = await client.issueToken(id);
      document.getElementById("tok-out").textContent = client.fmt(res.text);
      if (res.text) document.getElementById("val-token").value = client.fmt(res.text);
    };

    document.getElementById("val-btn").onclick = async function() {
      var tokenJson = document.getElementById("val-token").value;
      var res = await client.validate(tokenJson);
      document.getElementById("val-out").textContent = client.fmt(res.text);
    };

    document.getElementById("clients-btn").onclick = async function() {
      clientsPaginationState.cursorStack = [];
      clientsPaginationState.currentCursor = null;
      await loadClientsPage(null, false);
    };

    document.getElementById("clients-next-btn").onclick = async function() {
      if (!clientsPaginationState.hasMore || !clientsPaginationState.nextCursor) {
        document.getElementById("clients-page-info").textContent = "No next page available.";
        return;
      }
      await loadClientsPage(clientsPaginationState.nextCursor, true);
    };

    document.getElementById("clients-prev-btn").onclick = async function() {
      if (clientsPaginationState.cursorStack.length === 0) {
        document.getElementById("clients-page-info").textContent = "No previous page available.";
        return;
      }
      var prevCursor = clientsPaginationState.cursorStack.pop() || null;
      await loadClientsPage(prevCursor, false);
    };

    document.getElementById("clients-clear-btn").onclick = async function() {
      if (!confirm("Delete ALL clients? This cannot be undone.")) return;
      var res = await client.clearClients();
      document.getElementById("clients-out").textContent = client.fmt(res.text);
      clientsPaginationState = {
        nextCursor: null,
        hasMore: false,
        cursorStack: [],
        currentCursor: null,
      };
      document.getElementById("clients-page-info").textContent = "All clients cleared. Reload to confirm empty state.";
    };

    document.getElementById("del-btn").onclick = async function() {
      var id = document.getElementById("del-client-id").value;
      if (!id) {
        document.getElementById("del-out").textContent = "clientId is required";
        return;
      }
      if (!confirm("Delete client '" + id + "'?")) return;
      var res = await client.deleteClient(id);
      document.getElementById("del-out").textContent = client.fmt(res.text);
    };

    document.getElementById("cap-btn").onclick = async function() {
      var res = await client.capabilities();
      document.getElementById("cap-out").textContent = client.fmt(res.text);
    };

    document.getElementById("health-btn").onclick = async function() {
      var res = await client.health();
      document.getElementById("health-out").textContent = client.fmt(res.text);
    };
  </script>

</body>
</html>
`;
