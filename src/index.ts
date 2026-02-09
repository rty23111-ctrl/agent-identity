import { handleRegister } from "./routes/register";
import { handleToken } from "./routes/token";
import { handleValidate } from "./routes/validate";
import { handleHealth } from "./routes/health";
import { handleCapabilities } from "./routes/capabilities";
import { handleWellKnownAgentIdentity } from "./routes/wellKnownAgentIdentity";

const dashboardHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Agent Identity Dashboard</title>
  <style>
    body {
      font-family: system-ui, sans-serif;
      margin: 0;
      padding: 2rem;
      background: #f7f7f7;
      color: #222;
    }
    h1 { margin-top: 0; font-size: 1.8rem; }
    .card {
      background: white;
      padding: 1.5rem;
      border-radius: 8px;
      box-shadow: 0 2px 6px rgba(0,0,0,0.08);
      margin-bottom: 1.5rem;
      max-width: 600px;
    }
    label { display: block; margin-bottom: 0.4rem; font-weight: 600; }
    input {
      width: 100%;
      padding: 0.5rem;
      margin-bottom: 1rem;
      border-radius: 4px;
      border: 1px solid #ccc;
      font-size: 1rem;
    }
    button {
      padding: 0.6rem 1.2rem;
      background: #0078ff;
      color: white;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      font-size: 1rem;
    }
    button:hover { background: #005fcc; }
    pre {
      background: #eee;
      padding: 1rem;
      border-radius: 6px;
      overflow-x: auto;
      font-size: 0.9rem;
    }
  </style>
</head>

<body>
  <h1>Agent Identity Dashboard</h1>

  <div class="card">
    <h2>Register Client</h2>
    <label for="registerId">Client ID</label>
    <input id="registerId" placeholder="e.g. bruce-test" />
    <button onclick="registerClient()">Register</button>
    <pre id="registerOutput"></pre>
  </div>

  <div class="card">
    <h2>Issue Token</h2>
    <label for="tokenId">Client ID</label>
    <input id="tokenId" placeholder="e.g. bruce-test" />
    <button onclick="issueToken()">Issue Token</button>
    <pre id="tokenOutput"></pre>
  </div>

  <div class="card">
    <h2>Validate Token</h2>
    <label for="validateToken">Token</label>
    <input id="validateToken" placeholder="Paste token here" />
    <button onclick="validateToken()">Validate</button>
    <pre id="validateOutput"></pre>
  </div>

  <div class="card">
    <h2>Health Check</h2>
    <button onclick="checkHealth()">Run Health Check</button>
    <pre id="healthOutput"></pre>
  </div>

  <div class="card">
    <h2>Capabilities</h2>
    <button onclick="checkCapabilities()">Get Capabilities</button>
    <pre id="capabilitiesOutput"></pre>
  </div>

  <script>
    async function registerClient() {
      const id = document.getElementById("registerId").value;
      const res = await fetch("/api/register", {
        method: "POST",
        body: JSON.stringify({ clientId: id }),
      });
      document.getElementById("registerOutput").textContent =
        await res.text();
    }

    async function issueToken() {
      const id = document.getElementById("tokenId").value;
      const res = await fetch("/api/token", {
        method: "POST",
        body: JSON.stringify({ clientId: id }),
      });
      const text = await res.text();
      document.getElementById("tokenOutput").textContent = text;

      try {
        const json = JSON.parse(text);
        if (json.token) {
          document.getElementById("validateToken").value = json.token;
        }
      } catch {}
    }

    async function validateToken() {
      const token = document.getElementById("validateToken").value;
      const res = await fetch("/api/validate", {
        method: "POST",
        body: JSON.stringify({ token }),
      });
      document.getElementById("validateOutput").textContent =
        await res.text();
    }

    async function checkHealth() {
      const res = await fetch("/health");
      document.getElementById("healthOutput").textContent =
        await res.text();
    }

    async function checkCapabilities() {
      const res = await fetch("/capabilities");
      document.getElementById("capabilitiesOutput").textContent =
        await res.text();
    }
  </script>
</body>
</html>
`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(
      request.url,
      request.url.startsWith("http") ? undefined : "http://localhost"
    );

    switch (url.pathname) {
      case "/.well-known/agent-identity":
        return handleWellKnownAgentIdentity(request, env);

      case "/api/register":
        return handleRegister(request, env);

      case "/api/token":
        return handleToken(request, env);

      case "/api/validate":
        return handleValidate(request, env);

      case "/health":
        return handleHealth();

      case "/capabilities":
        return handleCapabilities(request, env);

      case "/dashboard":
        return new Response(dashboardHtml, {
          headers: { "Content-Type": "text/html" },
        });

      case "/dashboard.html":
        return Response.redirect(url.origin + "/dashboard", 302);

      case "/favicon.ico":
        return new Response("", { status: 204 });

      default:
        return new Response("Not found", { status: 404 });
    }
  },
};
