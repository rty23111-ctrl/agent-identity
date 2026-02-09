var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-vcgnJj/checked-fetch.js
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
    return await request.json();
  } catch {
    return null;
  }
}
__name(readJson, "readJson");

// src/routes/register.ts
async function handleRegister(request, env) {
  const body = await readJson(request);
  if (!body || !body.clientId) {
    return new Response(JSON.stringify({ error: "clientId required" }), { status: 400 });
  }
  const id = body.clientId;
  return new Response(JSON.stringify({ clientId: id }), { status: 201 });
}
__name(handleRegister, "handleRegister");

// lib/crypto.ts
async function getKeyPair(env) {
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    Uint8Array.from(atob(env.PRIVATE_KEY), (c) => c.charCodeAt(0)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const publicKey = await crypto.subtle.importKey(
    "spki",
    Uint8Array.from(atob(env.PUBLIC_KEY), (c) => c.charCodeAt(0)),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
  return { privateKey, publicKey };
}
__name(getKeyPair, "getKeyPair");

// lib/token.ts
async function signToken(clientId, env) {
  const { privateKey } = await getKeyPair(env);
  const iat = Math.floor(Date.now() / 1e3);
  const exp = iat + Number(env.TOKEN_TTL_SECONDS);
  const payload = JSON.stringify({ cid: clientId, iat, exp });
  const encoded = new TextEncoder().encode(payload);
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privateKey,
    encoded
  );
  const token = btoa(payload) + "." + btoa(String.fromCharCode(...new Uint8Array(signature)));
  return { token, expiresAt: exp };
}
__name(signToken, "signToken");
async function validateToken(token, env) {
  const { publicKey } = await getKeyPair(env);
  const [payloadB64, sigB64] = token.split(".");
  if (!payloadB64 || !sigB64) return { valid: false, reason: "Malformed token" };
  const payloadJson = atob(payloadB64);
  const payload = JSON.parse(payloadJson);
  const now = Math.floor(Date.now() / 1e3);
  if (payload.exp < now) return { valid: false, reason: "Expired", expiresAt: payload.exp };
  const signature = Uint8Array.from(atob(sigB64), (c) => c.charCodeAt(0));
  const encodedPayload = new TextEncoder().encode(payloadJson);
  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    publicKey,
    signature,
    encodedPayload
  );
  return ok ? { valid: true, expiresAt: payload.exp } : { valid: false, reason: "Invalid signature" };
}
__name(validateToken, "validateToken");

// src/routes/token.ts
async function handleToken(request, env) {
  const body = await readJson(request);
  if (!body || !body.clientId) {
    return new Response(JSON.stringify({ error: "clientId required" }), { status: 400 });
  }
  const { token, expiresAt } = await signToken(body.clientId, env);
  return new Response(JSON.stringify({ token, expiresAt }), { status: 200 });
}
__name(handleToken, "handleToken");

// src/routes/validate.ts
async function handleValidate(request, env) {
  const body = await readJson(request);
  if (!body || !body.token) {
    return new Response(JSON.stringify({ error: "token required" }), { status: 400 });
  }
  const result = await validateToken(body.token, env);
  return new Response(JSON.stringify(result), {
    status: result.valid ? 200 : 401
  });
}
__name(handleValidate, "handleValidate");

// src/routes/health.ts
function handleHealth() {
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
}
__name(handleHealth, "handleHealth");

// src/routes/capabilities.ts
function handleCapabilities(env) {
  return new Response(
    JSON.stringify({
      name: "agent-identity",
      version: env.VERSION || "0.1.0",
      ttl: env.TOKEN_TTL_SECONDS
    }),
    { status: 200 }
  );
}
__name(handleCapabilities, "handleCapabilities");

// src/index.ts
var dashboardHtml = `
<!DOCTYPE html>
<html>
  <head><title>Dashboard</title></head>
  <body>
    <h1>Agent Identity Dashboard</h1>
    <p>Dashboard loaded.</p>
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
      case "/api/register":
        return handleRegister(request, env);
      case "/api/token":
        return handleToken(request, env);
      case "/api/validate":
        return handleValidate(request, env);
      case "/health":
        return handleHealth(request, env);
      case "/capabilities":
        return handleCapabilities(request, env);
      // ⭐ Serve the dashboard
      case "/dashboard":
        return new Response(dashboardHtml, {
          headers: { "Content-Type": "text/html" }
        });
      // ⭐ Redirect /dashboard.html → /dashboard
      case "/dashboard.html":
        return Response.redirect(url.origin + "/dashboard", 302);
      // ⭐ Silence browser favicon requests
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
    const error = reduceError(e);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-vcgnJj/middleware-insertion-facade.js
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

// .wrangler/tmp/bundle-vcgnJj/middleware-loader.entry.ts
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
