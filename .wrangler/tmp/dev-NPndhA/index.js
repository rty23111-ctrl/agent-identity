var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-zlzHMP/checked-fetch.js
var urls = /* @__PURE__ */ new Set();
function checkURL(request, init) {
  const url = request instanceof URL ? request : new URL(
    (typeof request === "string" ? new Request(request, init) : request).url
  );
  if (url.port && url.port !== "443" && url.protocol === "https:") {
    if (!urls.has(url.toString())) {
      urls.add(url.toString());
      console.warn(
        `WARNING: known issue with \`fetch()\` requests to custom HTTPS ports in published Workers:
 - ${url.toString()} - the custom port will be ignored when the Worker is published using the \`wrangler deploy\` command.
`
      );
    }
  }
}
__name(checkURL, "checkURL");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    const [request, init] = argArray;
    checkURL(request, init);
    return Reflect.apply(target, thisArg, argArray);
  }
});

// lib/utils.ts
async function readJson(request) {
  try {
    const text = await request.text();
    if (!text) return null;
    return JSON.parse(text);
  } catch {
    return null;
  }
}
__name(readJson, "readJson");
function pemToArrayBuffer(pem) {
  const lines = pem.trim().split("\n");
  const base64 = lines.filter((line) => !line.startsWith("-----")).join("");
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
__name(pemToArrayBuffer, "pemToArrayBuffer");

// lib/errors.ts
function error(code, message, meta = {}) {
  return new Response(
    JSON.stringify({
      ok: false,
      error: { code, message, ...meta }
    }),
    {
      status: 400,
      headers: { "Content-Type": "application/json" }
    }
  );
}
__name(error, "error");
function success(data = {}) {
  return new Response(
    JSON.stringify({
      ok: true,
      ...data
    }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" }
    }
  );
}
__name(success, "success");

// src/routes/register.ts
async function handleRegister(request, env) {
  const body = await readJson(request);
  if (!body || !body.clientId) {
    return error("CLIENT_ID_REQUIRED", "clientId is required");
  }
  return success({
    clientId: body.clientId,
    registered: true
  });
}
__name(handleRegister, "handleRegister");

// lib/crypto.ts
async function getKeyPair(env) {
  const privateKeyPem = env.PRIVATE_KEY;
  const publicKeyPem = env.PUBLIC_KEY;
  const privateKeyData = pemToArrayBuffer(privateKeyPem);
  const publicKeyData = pemToArrayBuffer(publicKeyPem);
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyData,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256"
    },
    false,
    ["sign"]
  );
  const publicKey = await crypto.subtle.importKey(
    "spki",
    publicKeyData,
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256"
    },
    false,
    ["verify"]
  );
  return { privateKey, publicKey };
}
__name(getKeyPair, "getKeyPair");

// lib/token.ts
function base64UrlEncode(bytes) {
  let str = "";
  for (let i = 0; i < bytes.length; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
__name(base64UrlEncode, "base64UrlEncode");
function base64UrlDecode(input) {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((input.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}
__name(base64UrlDecode, "base64UrlDecode");
async function signToken(clientId, env) {
  const { privateKey } = await getKeyPair(env);
  const ttlSeconds = Number(env.TOKEN_TTL_SECONDS);
  const now = Math.floor(Date.now() / 1e3);
  const exp = now + ttlSeconds;
  const payload = { sub: clientId, exp };
  const payloadJson = JSON.stringify(payload);
  const payloadBytes = new TextEncoder().encode(payloadJson);
  const payloadB64 = base64UrlEncode(payloadBytes);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    payloadBytes
  );
  const sigBytes = new Uint8Array(signature);
  const sigB64 = base64UrlEncode(sigBytes);
  return {
    token: `${payloadB64}.${sigB64}`,
    expiresAt: exp
  };
}
__name(signToken, "signToken");
async function validateToken(token, env) {
  const { publicKey } = await getKeyPair(env);
  const parts = token.split(".");
  if (parts.length !== 2) {
    return { valid: false, reason: "MALFORMED_TOKEN" };
  }
  const [payloadB64, sigB64] = parts;
  const payloadBytes = base64UrlDecode(payloadB64);
  const sigBytes = base64UrlDecode(sigB64);
  const payloadJson = new TextDecoder().decode(payloadBytes);
  let payload;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    return { valid: false, reason: "MALFORMED_PAYLOAD" };
  }
  if (typeof payload.exp !== "number") {
    return { valid: false, reason: "MISSING_EXP" };
  }
  const now = Math.floor(Date.now() / 1e3);
  if (payload.exp < now) {
    return { valid: false, reason: "EXPIRED", expiresAt: payload.exp };
  }
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    publicKey,
    sigBytes,
    payloadBytes
  );
  if (!ok) {
    return {
      valid: false,
      reason: "INVALID_SIGNATURE",
      expiresAt: payload.exp
    };
  }
  return { valid: true, expiresAt: payload.exp };
}
__name(validateToken, "validateToken");

// src/routes/token.ts
async function handleToken(request, env) {
  const body = await readJson(request);
  if (!body || !body.clientId) {
    return error("CLIENT_ID_REQUIRED", "clientId is required");
  }
  const { token, expiresAt } = await signToken(body.clientId, env);
  return success({
    token,
    expiresAt
  });
}
__name(handleToken, "handleToken");

// src/routes/validate.ts
async function handleValidate(request, env) {
  const body = await readJson(request);
  if (!body || !body.token) {
    return error("TOKEN_REQUIRED", "token is required");
  }
  const result = await validateToken(body.token, env);
  if (!result.valid) {
    return error(result.reason ?? "INVALID_TOKEN", "Token validation failed", {
      expiresAt: result.expiresAt
    });
  }
  return success({
    valid: true,
    expiresAt: result.expiresAt
  });
}
__name(handleValidate, "handleValidate");

// src/routes/health.ts
async function handleHealth() {
  return success({
    status: "ok",
    timestamp: Date.now()
  });
}
__name(handleHealth, "handleHealth");

// src/routes/capabilities.ts
async function handleCapabilities(request, env) {
  const capabilities = {
    service: "agent-identity",
    version: "1.0.0",
    endpoints: {
      register: "/api/register",
      token: "/api/token",
      validate: "/api/validate",
      health: "/health",
      capabilities: "/capabilities",
      discovery: "/.well-known/agent-identity"
    },
    token: {
      algorithm: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
      ttlSeconds: Number(env.TOKEN_TTL_SECONDS),
      format: "base64url(payload).base64url(signature)"
    }
  };
  return success({ capabilities });
}
__name(handleCapabilities, "handleCapabilities");

// src/routes/wellKnownAgentIdentity.ts
async function handleWellKnownAgentIdentity(request, env) {
  const doc = {
    service: "agent-identity",
    version: "1.0.0",
    capabilitiesUrl: "/capabilities",
    endpoints: {
      register: "/api/register",
      token: "/api/token",
      validate: "/api/validate",
      health: "/health",
      capabilities: "/capabilities"
    }
  };
  return success({ discovery: doc });
}
__name(handleWellKnownAgentIdentity, "handleWellKnownAgentIdentity");

// src/index.ts
var dashboardHtml = `
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
  <\/script>
</body>
</html>
`;
var src_default = {
  async fetch(request, env) {
    const url = new URL(
      request.url,
      request.url.startsWith("http") ? void 0 : "http://localhost"
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
          headers: { "Content-Type": "text/html" }
        });
      case "/dashboard.html":
        return Response.redirect(url.origin + "/dashboard", 302);
      case "/favicon.ico":
        return new Response("", { status: 204 });
      default:
        return new Response("Not found", { status: 404 });
    }
  }
};

// ../../home/codespace/.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../home/codespace/.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error2 = reduceError(e);
    return Response.json(error2, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-zlzHMP/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../../home/codespace/.npm/_npx/32026684e21afda6/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-zlzHMP/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
