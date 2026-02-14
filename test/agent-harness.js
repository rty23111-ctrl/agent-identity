#!/usr/bin/env node

/*
 * Autonomous Agent Harness for agent-identity
 *
 * Usage:
 *   AUTH_BASE_URL=https://<worker>.workers.dev node test/agent-harness.js
 *   AUTH_BASE_URL=http://127.0.0.1:8787 AUTH_ADMIN_KEY=<key> node test/agent-harness.js
 *
 * Optional env:
 *   AUTH_BASE_URL            default: http://127.0.0.1:8787
 *   AUTH_ADMIN_KEY           API key for /api/* when ADMIN_API_KEY is enabled
 *   AUTH_CLEAR_ALL_ON_START  true|false (default: false)
 *   AUTH_TEST_BYO_KEYS       true|false (default: true)
 *   AUTH_TEST_PAID           true|false (default: false)
 *   AUTH_TEST_PAID_TOKEN     token used for paid webhook simulation (default: local-paid-test-token)
 */

const BASE_URL = (process.env.AUTH_BASE_URL || "http://127.0.0.1:8787").replace(/\/$/, "");
const ADMIN_KEY = (process.env.AUTH_ADMIN_KEY || "").trim();
const CLEAR_ALL_ON_START = /^true$/i.test(process.env.AUTH_CLEAR_ALL_ON_START || "false");
const TEST_BYO_KEYS = !/^false$/i.test(process.env.AUTH_TEST_BYO_KEYS || "true");
const TEST_PAID = /^true$/i.test(process.env.AUTH_TEST_PAID || "false");
const TEST_PAID_TOKEN = (process.env.AUTH_TEST_PAID_TOKEN || "local-paid-test-token").trim();

const { generateKeyPairSync } = require("crypto");

if (typeof fetch !== "function") {
  console.error("❌ Global fetch is not available. Use Node 18+.");
  process.exit(1);
}

function nowIso() {
  return new Date().toISOString();
}

function randomClientId() {
  return `agent-harness-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function joinUrl(path) {
  return `${BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

function withAuthHeaders(headers = {}) {
  if (!ADMIN_KEY) return headers;
  return { ...headers, "x-api-key": ADMIN_KEY };
}

async function request(method, path, body, extraHeaders = {}) {
  const headers = withAuthHeaders(
    body === undefined ? {} : { "Content-Type": "application/json" }
  );
  Object.assign(headers, extraHeaders);

  const targetUrl = joinUrl(path);

  let res;
  try {
    res = await fetch(targetUrl, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new Error(
      [
        `Network request failed for ${method} ${targetUrl}`,
        `Reason: ${reason}`,
        `Hint: ensure the service is running and AUTH_BASE_URL is correct.`,
      ].join("\n")
    );
  }

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = null;
  }

  return { res, text, json };
}

async function expectOk(step, method, path, body, validate, extraHeaders) {
  const { res, json, text } = await request(method, path, body, extraHeaders);
  if (!res.ok) {
    throw new Error(`${step} failed (${res.status}) ${method} ${path}\n${text}`);
  }
  if (validate) validate(json, text);
  console.log(`✅ ${step}`);
  return { res, json, text };
}

async function discover() {
  const discoveryPaths = ["/.well-known/agent.json", "/.well-known/ai-plugin.json"];

  for (const path of discoveryPaths) {
    const { res, json } = await request("GET", path);
    if (res.ok && json && json.api && json.api.openapi) {
      return { path, discovery: json };
    }
  }

  throw new Error("Discovery failed: no .well-known agent metadata endpoint returned usable JSON");
}

function parseOpenApiPathFromDiscovery(discovery) {
  const openapiUrl = discovery?.api?.openapi;
  if (typeof openapiUrl !== "string" || !openapiUrl.trim()) {
    throw new Error("Discovery missing api.openapi URL");
  }

  const parsed = new URL(openapiUrl);
  const base = new URL(BASE_URL);
  if (parsed.origin !== base.origin) {
    throw new Error(`Discovered openapi origin mismatch: ${parsed.origin} != ${base.origin}`);
  }

  return parsed.pathname + parsed.search;
}

function assertEndpoint(openapi, endpoint, method) {
  const op = openapi?.paths?.[endpoint]?.[method.toLowerCase()];
  if (!op) throw new Error(`OpenAPI missing ${method.toUpperCase()} ${endpoint}`);
}

async function maybeClearAllClients() {
  if (!CLEAR_ALL_ON_START) return;
  const { res, text } = await request("DELETE", "/api/clients");
  if (!res.ok) {
    throw new Error(`Clear all clients failed (${res.status}): ${text}`);
  }
  console.log("✅ Optional reset: cleared all clients");
}

function generateRsaPemPair() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });

  return {
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  };
}

async function runPaidFlowTest(openapi) {
  const hasCheckout = !!openapi?.paths?.["/api/paid/checkout"]?.post;
  const hasWebhook = !!openapi?.paths?.["/api/paid/webhook"]?.post;
  const hasStatus = !!openapi?.paths?.["/api/paid/instances/{agentId}"]?.get;
  if (!hasCheckout || !hasWebhook || !hasStatus) {
    throw new Error("Paid test requested but OpenAPI missing paid endpoints");
  }

  const paidAgentId = `paid-${randomClientId()}`.slice(0, 64);

  // Registration should require payment
  const regResp = await request("POST", "/api/register", { clientId: paidAgentId }, { "x-paid-test-token": TEST_PAID_TOKEN });
  if (regResp.json?.paymentRequired) {
    if (!regResp.json?.checkoutUrl) throw new Error("Registration paymentRequired but missing checkoutUrl");
    console.log(`✅ Registration payment required, checkoutUrl: ${regResp.json.checkoutUrl}`);
  } else {
    throw new Error("Registration did not require payment for paid agent");
  }

  // Simulate payment completion via webhook
  const sessionId = regResp.json.checkoutSessionId || `sess_${Date.now()}`;
  await expectOk(
    "Paid webhook simulate checkout completion",
    "POST",
    "/api/paid/webhook",
    {
      id: `evt_${Date.now()}`,
      type: "checkout.session.completed",
      data: {
        object: {
          id: sessionId,
          client_reference_id: paidAgentId,
          customer: `cus_test_${Date.now()}`,
          subscription: `sub_test_${Date.now()}`,
          metadata: { agentId: paidAgentId },
        },
      },
    },
    undefined,
    {
      "x-paid-test-token": TEST_PAID_TOKEN,
    }
  );

  // Removed duplicate sessionId declaration

  await expectOk(
    "Paid webhook simulate checkout completion",
    "POST",
    "/api/paid/webhook",
    {
      id: `evt_${Date.now()}`,
      type: "checkout.session.completed",
      data: {
        object: {
          id: sessionId,
          client_reference_id: paidAgentId,
          customer: `cus_test_${Date.now()}`,
          subscription: `sub_test_${Date.now()}`,
          metadata: { agentId: paidAgentId },
        },
      },
    },
    undefined,
    {
      "x-paid-test-token": TEST_PAID_TOKEN,
    }
  );

  let finalStatus = "unknown";
  for (let i = 0; i < 10; i++) {
    const status = await expectOk(
      `Paid instance status poll ${i + 1}`,
      "GET",
      `/api/paid/instances/${encodeURIComponent(paidAgentId)}`,
      undefined,
      undefined,
      {
        "x-paid-test-token": TEST_PAID_TOKEN,
      }
    );
    finalStatus = status?.json?.status || "unknown";
    if (finalStatus === "active") break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  if (finalStatus !== "active") {
    throw new Error(`Paid instance did not become active (final status: ${finalStatus})`);
  }
}

(async () => {
  try {
    console.log(`\n🤖 Agent Harness starting at ${nowIso()}`);
    console.log(`🌐 Base URL: ${BASE_URL}`);
    if (!process.env.AUTH_BASE_URL) {
      console.log("ℹ️  AUTH_BASE_URL not set; using default http://127.0.0.1:8787");
    }

    const { path: discoveryPath, discovery } = await discover();
    console.log(`✅ Discovery loaded from ${discoveryPath}`);

    const openApiPath = parseOpenApiPathFromDiscovery(discovery);
    const openApiResp = await expectOk("OpenAPI fetch", "GET", openApiPath);
    const openapi = openApiResp.json;

    assertEndpoint(openapi, "/health", "get");
    assertEndpoint(openapi, "/capabilities", "get");
    assertEndpoint(openapi, "/api/register", "post");
    assertEndpoint(openapi, "/api/token", "post");
    assertEndpoint(openapi, "/api/validate", "post");
    assertEndpoint(openapi, "/api/clients", "get");
    assertEndpoint(openapi, "/api/clients/{clientId}", "delete");
    console.log("✅ OpenAPI contract includes required endpoints");

    if (TEST_PAID) {
      await runPaidFlowTest(openapi);
      console.log("✅ Paid extension test flow completed");
    }

    await maybeClearAllClients();

    await expectOk("Health", "GET", "/health", undefined, (json) => {
      if (json?.status !== "ok") throw new Error("Health response missing status=ok");
    });

    await expectOk("Capabilities", "GET", "/capabilities", undefined, (json) => {
      if (!Array.isArray(json?.capabilities)) throw new Error("Capabilities not returned as array");
    });

    const clientId = randomClientId();

    await expectOk("Register client", "POST", "/api/register", { clientId }, (json) => {
      if (json?.registered !== clientId) throw new Error("Register response mismatch");
    });

    const issue = await expectOk("Issue token", "POST", "/api/token", { clientId }, (json) => {
      if (!json?.payload || typeof json?.sig !== "string") {
        throw new Error("Token response missing payload/sig");
      }
    });

    await expectOk("Validate token", "POST", "/api/validate", issue.json, (json) => {
      if (json?.valid !== true) throw new Error("Token should validate as true");
      if (json?.payload?.clientId !== clientId) throw new Error("Validated payload clientId mismatch");
    });

    if (TEST_BYO_KEYS) {
      const clientByo = randomClientId();
      const { privateKeyPem, publicKeyPem } = generateRsaPemPair();

      await expectOk("Register client (BYO key)", "POST", "/api/register", { clientId: clientByo });

      const byoIssue = await expectOk(
        "Issue token (BYO key)",
        "POST",
        "/api/token",
        {
          clientId: clientByo,
          privateKey: privateKeyPem,
          publicKey: publicKeyPem,
        },
        (json) => {
          if (!json?.payload || typeof json?.sig !== "string") {
            throw new Error("BYO issue response missing payload/sig");
          }
        }
      );

      await expectOk(
        "Validate token (BYO key)",
        "POST",
        "/api/validate",
        {
          token: byoIssue.json,
          publicKey: publicKeyPem,
        },
        (json) => {
          if (json?.valid !== true) throw new Error("BYO token should validate as true");
          if (json?.payload?.clientId !== clientByo) throw new Error("BYO validated payload clientId mismatch");
        }
      );

      await expectOk("Delete client (BYO key)", "DELETE", `/api/clients/${encodeURIComponent(clientByo)}`);
    }

    let nextCursor = null;
    const listFirst = await expectOk("List clients page 1", "GET", "/api/clients?limit=10", undefined, (json) => {
      if (!Array.isArray(json?.clients)) throw new Error("Clients list missing clients[]");
      if (!json?.pagination) throw new Error("Clients list missing pagination");
    });

    nextCursor = listFirst.json?.pagination?.nextCursor || null;
    const listed = listFirst.json?.clients || [];
    if (!listed.find((item) => item.clientId === clientId)) {
      throw new Error("Newly created client not present in list response");
    }

    if (nextCursor) {
      await expectOk("List clients page 2", "GET", `/api/clients?limit=10&cursor=${encodeURIComponent(nextCursor)}`);
    }

    await expectOk("Delete client", "DELETE", `/api/clients/${encodeURIComponent(clientId)}`, undefined, (json) => {
      if (json?.deleted !== clientId) throw new Error("Delete response mismatch");
    });

    console.log("\n✅ Autonomous harness completed successfully.");
    process.exit(0);
  } catch (error) {
    console.error("\n❌ Harness failed:");
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
})();
