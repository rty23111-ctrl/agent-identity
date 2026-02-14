import { dashboardHtml } from "./dashboard-page";
import { markdownViewerHtml } from "./markdown-viewer-page";
import { getMarkdownDocById, markdownDocs } from "./markdown-docs";

export interface Env {
  PRIVATE_KEY?: string;
  PUBLIC_KEY?: string;
  CLIENTS: KVNamespace;          // <-- your real KV binding
  TOKEN_TTL_SECONDS?: string;
  ADMIN_API_KEY?: string;
  AUDIT_WEBHOOK_URL?: string;
  AUDIT_WEBHOOK_AUTH_TOKEN?: string;
  AUDIT_WEBHOOK_TIMEOUT_MS?: string;
  RATE_LIMIT_WINDOW_SECONDS?: string;
  RATE_LIMIT_MAX_REGISTER?: string;
  RATE_LIMIT_MAX_TOKEN?: string;
  RATE_LIMIT_MAX_VALIDATE?: string;
  RATE_LIMIT_MAX_CLIENTS?: string;
  PAID_EXTENSION_ENABLED?: string;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_ID?: string;
  PAID_SUCCESS_URL?: string;
  PAID_CANCEL_URL?: string;
  PAID_PROVISIONER_URL?: string;
  PAID_PROVISIONER_AUTH_TOKEN?: string;
  PAID_TEST_MODE?: string;
  PAID_TEST_TOKEN?: string;
}

// ---------- RSA helpers ----------

function pemToArrayBuffer(pem: string): ArrayBuffer {
  const b64 = pem
    .replace(/-----BEGIN [A-Z ]+-----/g, "")
    .replace(/-----END [A-Z ]+-----/g, "")
    .replace(/\s+/g, "");
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

async function importPrivateKeyRSA(pem: string): Promise<CryptoKey> {
  const keyData = pemToArrayBuffer(pem);
  return crypto.subtle.importKey(
    "pkcs8",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

async function importPublicKeyRSA(pem: string): Promise<CryptoKey> {
  const keyData = pemToArrayBuffer(pem);
  return crypto.subtle.importKey(
    "spki",
    keyData,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"]
  );
}

function normalizePem(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function isLikelyPem(value: string): boolean {
  return /-----BEGIN [A-Z ]+-----/.test(value) && /-----END [A-Z ]+-----/.test(value);
}

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function canonicalJson(obj: unknown): string {
  return JSON.stringify(obj, Object.keys(obj as any).sort());
}

// ---------- Token model ----------

type TokenPayload = {
  clientId: string;
  iat: number;
  exp: number;
  cap: string[];
};

type SignedToken = {
  payload: TokenPayload;
  sig: string;
};

// ---------- KV helpers ----------

type StoredClient = {
  clientId: string;
  createdAt: number;
  cap: string[];
};

const CLIENT_PREFIX = "client:";
const RATE_PREFIX = "rate:";
const PAID_INSTANCE_PREFIX = "paid:instance:";
const PAID_SESSION_PREFIX = "paid:session:";
const PAID_SUBSCRIPTION_PREFIX = "paid:subscription:";

type PaidInstanceStatus =
  | "pending_payment"
  | "provisioning"
  | "active"
  | "past_due"
  | "canceled"
  | "provision_failed";

type PaidInstanceRecord = {
  agentId: string;
  status: PaidInstanceStatus;
  createdAt: number;
  updatedAt: number;
  checkoutSessionId?: string;
  checkoutUrl?: string;
  customerId?: string;
  subscriptionId?: string;
  planId?: string;
  instanceUrl?: string;
  provisionJobId?: string;
  lastError?: string;
};

function clientKey(clientId: string) {
  return `${CLIENT_PREFIX}${clientId}`;
}

function paidInstanceKey(agentId: string) {
  return `${PAID_INSTANCE_PREFIX}${agentId}`;
}

function paidSessionKey(sessionId: string) {
  return `${PAID_SESSION_PREFIX}${sessionId}`;
}

function paidSubscriptionKey(subscriptionId: string) {
  return `${PAID_SUBSCRIPTION_PREFIX}${subscriptionId}`;
}

function isStoredClient(value: unknown): value is StoredClient {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.clientId === "string" &&
    typeof obj.createdAt === "number" &&
    Array.isArray(obj.cap) &&
    obj.cap.every((item) => typeof item === "string")
  );
}

async function getClient(env: Env, clientId: string): Promise<StoredClient | null> {
  const prefixed = await env.CLIENTS.get(clientKey(clientId));
  if (prefixed) {
    const parsed = safeJsonParse(prefixed);
    return isStoredClient(parsed) ? parsed : null;
  }

  const legacy = await env.CLIENTS.get(clientId);
  if (!legacy) return null;
  const parsed = safeJsonParse(legacy);
  return isStoredClient(parsed) ? parsed : null;
}

async function putClient(env: Env, client: StoredClient): Promise<void> {
  await env.CLIENTS.put(clientKey(client.clientId), JSON.stringify(client));
}

async function deleteClient(env: Env, clientId: string): Promise<boolean> {
  const [prefixed, legacy] = await Promise.all([
    env.CLIENTS.get(clientKey(clientId)),
    env.CLIENTS.get(clientId),
  ]);

  if (!prefixed && !legacy) return false;

  await Promise.all([
    env.CLIENTS.delete(clientKey(clientId)),
    env.CLIENTS.delete(clientId),
  ]);
  return true;
}

async function listClients(env: Env): Promise<StoredClient[]> {
  const list = await env.CLIENTS.list();
  const out: StoredClient[] = [];
  const seen = new Set<string>();

  for (const entry of list.keys) {
    if (entry.name.startsWith(RATE_PREFIX)) continue;

    const raw = await env.CLIENTS.get(entry.name);
    if (!raw) continue;

    const parsed = safeJsonParse(raw);
    if (!isStoredClient(parsed)) continue;
    if (seen.has(parsed.clientId)) continue;

    seen.add(parsed.clientId);
    out.push(parsed);
  }

  out.sort((a, b) => a.clientId.localeCompare(b.clientId));
  return out;
}

async function listClientsPage(
  env: Env,
  limit: number,
  cursor?: string
): Promise<{ clients: StoredClient[]; nextCursor: string | null; hasMore: boolean }> {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit || 25)));
  const allClients = await listClients(env);
  const offset = decodeClientsCursor(cursor);

  const clients = allClients.slice(offset, offset + safeLimit);
  const nextOffset = offset + clients.length;
  const hasMore = nextOffset < allClients.length;

  return {
    clients,
    nextCursor: hasMore ? encodeClientsCursor(nextOffset) : null,
    hasMore,
  };
}

function isPaidInstanceRecord(value: unknown): value is PaidInstanceRecord {
  if (!isObjectRecord(value)) return false;
  if (typeof value.agentId !== "string") return false;
  if (typeof value.createdAt !== "number") return false;
  if (typeof value.updatedAt !== "number") return false;
  if (typeof value.status !== "string") return false;
  return true;
}

async function getPaidInstance(env: Env, agentId: string): Promise<PaidInstanceRecord | null> {
  const raw = await env.CLIENTS.get(paidInstanceKey(agentId));
  if (!raw) return null;
  const parsed = safeJsonParse(raw);
  return isPaidInstanceRecord(parsed) ? parsed : null;
}

async function putPaidInstance(env: Env, record: PaidInstanceRecord): Promise<void> {
  await env.CLIENTS.put(paidInstanceKey(record.agentId), JSON.stringify(record));
}

async function getAgentIdByCheckoutSession(env: Env, sessionId: string): Promise<string | null> {
  return env.CLIENTS.get(paidSessionKey(sessionId));
}

async function putCheckoutSessionAgent(env: Env, sessionId: string, agentId: string): Promise<void> {
  await env.CLIENTS.put(paidSessionKey(sessionId), agentId);
}

async function getAgentIdBySubscription(env: Env, subscriptionId: string): Promise<string | null> {
  return env.CLIENTS.get(paidSubscriptionKey(subscriptionId));
}

async function putSubscriptionAgent(env: Env, subscriptionId: string, agentId: string): Promise<void> {
  await env.CLIENTS.put(paidSubscriptionKey(subscriptionId), agentId);
}

function randomId(prefix: string): string {
  const suffix = typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID().replace(/-/g, "").slice(0, 16)
    : `${Date.now()}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}${suffix}`;
}

// ---------- Token signing ----------

async function resolvePrivateSigningKey(env: Env, privateKeyOverride?: string): Promise<CryptoKey> {
  const privatePem = normalizePem(privateKeyOverride) || normalizePem(env.PRIVATE_KEY);
  if (!privatePem) throw new Error("PRIVATE_KEY must be set or provided in request");
  return importPrivateKeyRSA(privatePem);
}

async function resolvePublicVerifyKey(env: Env, publicKeyOverride?: string): Promise<CryptoKey> {
  const publicPem = normalizePem(publicKeyOverride) || normalizePem(env.PUBLIC_KEY);
  if (!publicPem) throw new Error("PUBLIC_KEY must be set or provided in request");
  return importPublicKeyRSA(publicPem);
}

async function signToken(
  env: Env,
  payload: TokenPayload,
  keyMaterial?: { privateKey?: string }
): Promise<SignedToken> {
  const privKey = await resolvePrivateSigningKey(env, keyMaterial?.privateKey);
  const canon = canonicalJson(payload);
  const sigBuf = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    privKey,
    new TextEncoder().encode(canon)
  );
  return { payload, sig: bytesToB64(new Uint8Array(sigBuf)) };
}

async function verifyToken(
  env: Env,
  token: SignedToken,
  keyMaterial?: { publicKey?: string }
): Promise<boolean> {
  const pubKey = await resolvePublicVerifyKey(env, keyMaterial?.publicKey);
  const canon = canonicalJson(token.payload);
  const sigBytes = Uint8Array.from(atob(token.sig), c => c.charCodeAt(0));
  return crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    pubKey,
    sigBytes,
    new TextEncoder().encode(canon)
  );
}

// ---------- HTTP router ----------

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const requestId = newRequestId();

    const audit = (
      action: string,
      outcome: "success" | "failure" | "denied",
      status: number,
      details?: Record<string, unknown>,
      clientId?: string
    ) => {
      emitAuditEvent(ctx, env, {
        requestId,
        timestamp: new Date().toISOString(),
        action,
        outcome,
        status,
        clientId,
        ip: getClientIp(request),
        method: request.method,
        path: new URL(request.url).pathname,
        details: details ?? null,
      });
    };

    try {
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method;

      // Dashboard
      if (path === "/dashboard") {
        return new Response(dashboardHtml, {
          headers: { "Content-Type": "text/html" },
        });
      }

      // Markdown viewer
      if (path === "/markdown") {
        return new Response(markdownViewerHtml, {
          headers: { "Content-Type": "text/html" },
        });
      }

      if (path === "/api/markdown-docs" && method === "GET") {
        return json({
          documents: markdownDocs.map((doc) => ({
            id: doc.id,
            title: doc.title,
            fileName: doc.fileName,
          })),
        });
      }

      if (path.startsWith("/api/markdown-docs/") && method === "GET") {
        const id = decodeURIComponent(path.replace("/api/markdown-docs/", "")).trim();
        if (!id) return err("MARKDOWN_DOC_ID_REQUIRED", "Document id is required", 400);

        const doc = getMarkdownDocById(id);
        if (!doc) return err("MARKDOWN_DOC_NOT_FOUND", "Unknown markdown document", 404, { id });

        return json({
          id: doc.id,
          title: doc.title,
          fileName: doc.fileName,
          content: doc.content,
        });
      }

      // Health
      if (path === "/health") {
        return json({ status: "ok" });
      }

      // Capabilities
      if (path === "/capabilities") {
        return json({
          capabilities: [
            "client:register",
            "client:delete",
            "client:purge",
            "token:issue",
            "token:validate",
            "clients:list",
            "audit:webhook",
            "instance:paid-provision",
          ],
        });
      }

      // OpenAPI description
      if (path === "/openapi.json") {
        return json(openApiSpec(url.origin));
      }

      // Well-known discovery (agent/LLM-friendly)
      if (path === "/.well-known/agent.json" || path === "/.well-known/ai-plugin.json") {
        return json(agentDiscovery(url.origin, env));
      }

      // Paid extension: start checkout for dedicated instance
      if (path === "/api/paid/checkout" && method === "POST") {
        const paidTestRequest = isPaidTestRequest(request, env);
        if (!isPaidExtensionEnabled(env) && !paidTestRequest) {
          return err("PAID_EXTENSION_DISABLED", "Paid extension is not enabled", 404);
        }

        const limited = await checkRateLimit(
          env,
          request,
          "paid-checkout",
          Number(env.RATE_LIMIT_MAX_REGISTER || "30"),
          Number(env.RATE_LIMIT_WINDOW_SECONDS || "60")
        );
        if (limited) return limited;

        const body = await readJson(request);
        if (!body || !isObjectRecord(body)) {
          return err("INVALID_JSON", "Body must be valid JSON", 400);
        }

        const allowed = new Set(["agentId", "email", "successUrl", "cancelUrl"]);
        if (Object.keys(body).some((key) => !allowed.has(key))) {
          return err("INVALID_REQUEST_SCHEMA", "Body supports only agentId, email, successUrl, cancelUrl", 400);
        }

        const agentId = typeof body.agentId === "string" ? body.agentId.trim() : "";
        if (!isValidClientId(agentId)) {
          return err("INVALID_AGENT_ID", "agentId must match ^[A-Za-z0-9._-]{3,64}$", 400);
        }

        const email = typeof body.email === "string" ? body.email.trim() : undefined;
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return err("INVALID_EMAIL", "email must be valid", 400);
        }

        const successUrl = typeof body.successUrl === "string" ? body.successUrl.trim() : undefined;
        const cancelUrl = typeof body.cancelUrl === "string" ? body.cancelUrl.trim() : undefined;

        try {
          const session = await createStripeCheckoutSession(env, {
            origin: url.origin,
            agentId,
            email,
            successUrl,
            cancelUrl,
          }, paidTestRequest);

          const now = Date.now();
          const existing = await getPaidInstance(env, agentId);
          const record: PaidInstanceRecord = {
            agentId,
            status: "pending_payment",
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
            checkoutSessionId: session.id,
            checkoutUrl: session.url,
            customerId: existing?.customerId,
            subscriptionId: existing?.subscriptionId,
            planId: env.STRIPE_PRICE_ID,
            instanceUrl: existing?.instanceUrl,
            provisionJobId: existing?.provisionJobId,
            lastError: undefined,
          };

          await Promise.all([
            putPaidInstance(env, record),
            putCheckoutSessionAgent(env, session.id, agentId),
          ]);

          return json({
            agentId,
            status: record.status,
            checkoutSessionId: session.id,
            checkoutUrl: session.url,
          });
        } catch (error) {
          return err(
            "CHECKOUT_CREATE_FAILED",
            error instanceof Error ? error.message : "Unable to create checkout session",
            500
          );
        }
      }

      // Paid extension: Stripe webhook
      if (path === "/api/paid/webhook" && method === "POST") {
        const paidTestRequest = isPaidTestRequest(request, env);
        if (!isPaidExtensionEnabled(env) && !paidTestRequest) {
          return err("PAID_EXTENSION_DISABLED", "Paid extension is not enabled", 404);
        }

        const bodyText = await request.text();
        const isValid = await verifyStripeWebhookSignature(request, env, bodyText);
        if (!isValid) {
          return err("INVALID_WEBHOOK_SIGNATURE", "Invalid webhook signature", 401);
        }

        const event = safeJsonParse(bodyText);
        if (!isObjectRecord(event) || typeof event.type !== "string" || !isObjectRecord(event.data)) {
          return err("INVALID_WEBHOOK_PAYLOAD", "Webhook payload is invalid", 400);
        }

        const obj = isObjectRecord(event.data.object) ? event.data.object : null;
        if (!obj) {
          return err("INVALID_WEBHOOK_PAYLOAD", "Webhook event object is missing", 400);
        }

        await handleStripeWebhookEvent(ctx, env, event.type, obj, paidTestRequest);
        return json({ received: true });
      }

      // Paid extension: status lookup
      if (path.startsWith("/api/paid/instances/") && method === "GET") {
        const paidTestRequest = isPaidTestRequest(request, env);
        if (!isPaidExtensionEnabled(env) && !paidTestRequest) {
          return err("PAID_EXTENSION_DISABLED", "Paid extension is not enabled", 404);
        }

        const agentId = decodeURIComponent(path.replace("/api/paid/instances/", "")).trim();
        if (!isValidClientId(agentId)) {
          return err("INVALID_AGENT_ID", "agentId must match ^[A-Za-z0-9._-]{3,64}$", 400);
        }

        const record = await getPaidInstance(env, agentId);
        if (!record) {
          return err("INSTANCE_NOT_FOUND", "Unknown paid instance", 404);
        }

        return json({
          agentId: record.agentId,
          status: record.status,
          createdAt: record.createdAt,
          updatedAt: record.updatedAt,
          instanceUrl: record.instanceUrl ?? null,
          checkoutUrl: record.checkoutUrl ?? null,
          lastError: record.lastError ?? null,
        });
      }

      // Paid extension: optional provisioner callback for async status updates
      if (path === "/api/paid/provisioning/callback" && method === "POST") {
        if (!isPaidExtensionEnabled(env) && !isPaidTestRequest(request, env)) {
          return err("PAID_EXTENSION_DISABLED", "Paid extension is not enabled", 404);
        }

        const expected = env.PAID_PROVISIONER_AUTH_TOKEN?.trim();
        const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
        if (!expected || !bearer || bearer !== expected) {
          return err("UNAUTHORIZED", "Valid provisioner bearer token required", 401);
        }

        const body = await readJson(request);
        if (!body || !isObjectRecord(body)) {
          return err("INVALID_JSON", "Body must be valid JSON", 400);
        }

        const allowed = new Set(["agentId", "status", "instanceUrl", "provisionJobId", "error"]);
        if (Object.keys(body).some((key) => !allowed.has(key))) {
          return err("INVALID_REQUEST_SCHEMA", "Body supports only agentId, status, instanceUrl, provisionJobId, error", 400);
        }

        const agentId = typeof body.agentId === "string" ? body.agentId.trim() : "";
        if (!isValidClientId(agentId)) {
          return err("INVALID_AGENT_ID", "agentId must match ^[A-Za-z0-9._-]{3,64}$", 400);
        }

        const status = typeof body.status === "string" ? body.status.trim() : "";
        const allowedStatuses = new Set<PaidInstanceStatus>([
          "provisioning",
          "active",
          "past_due",
          "canceled",
          "provision_failed",
          "pending_payment",
        ]);
        if (!allowedStatuses.has(status as PaidInstanceStatus)) {
          return err("INVALID_STATUS", "status must be one of pending_payment, provisioning, active, past_due, canceled, provision_failed", 400);
        }

        const existing = await getPaidInstance(env, agentId);
        if (!existing) {
          return err("INSTANCE_NOT_FOUND", "Unknown paid instance", 404);
        }

        const next: PaidInstanceRecord = {
          ...existing,
          status: status as PaidInstanceStatus,
          updatedAt: Date.now(),
          instanceUrl: typeof body.instanceUrl === "string" && body.instanceUrl.trim() ? body.instanceUrl.trim() : existing.instanceUrl,
          provisionJobId: typeof body.provisionJobId === "string" && body.provisionJobId.trim() ? body.provisionJobId.trim() : existing.provisionJobId,
          lastError: typeof body.error === "string" && body.error.trim() ? body.error.trim() : undefined,
        };

        await putPaidInstance(env, next);
        return json({ ok: true, agentId: next.agentId, status: next.status, updatedAt: next.updatedAt });
      }

      if (path.startsWith("/api/")) {
        const authError = isPaidPublicRoute(path, method) ? null : requireApiKey(request, env);
        if (authError) {
          audit("auth.api", "denied", 401, { reason: "missing-or-invalid-api-key" });
          return authError;
        }
      }

      // Register client (with payment enforcement)
      if (path === "/api/register" && method === "POST") {
        const limited = await checkRateLimit(
          env,
          request,
          "register",
          Number(env.RATE_LIMIT_MAX_REGISTER || "30"),
          Number(env.RATE_LIMIT_WINDOW_SECONDS || "60")
        );
        if (limited) {
          audit("client.register", "denied", 429, { reason: "rate-limited" });
          return limited;
        }

        const body = await readJson(request);
        if (!body) {
          audit("client.register", "failure", 400, { reason: "invalid-json" });
          return err("INVALID_JSON", "Body must be valid JSON", 400);
        }

        const parsedClientId = parseClientIdFromBody(body);
        if (!parsedClientId.ok) {
          audit("client.register", "failure", 400, { reason: "invalid-client-id-body" });
          return parsedClientId.response;
        }
        const clientId = parsedClientId.clientId;

        // Payment enforcement for new client registration
        if (isPaidExtensionEnabled(env)) {
          // Check if paid instance exists and is active
          const paidInstance = await getPaidInstance(env, clientId);
          if (!paidInstance || paidInstance.status !== "active") {
            // Start Stripe checkout session
            try {
              const session = await createStripeCheckoutSession(env, {
                origin: url.origin,
                agentId: clientId,
                successUrl: body.successUrl || env.PAID_SUCCESS_URL,
                cancelUrl: body.cancelUrl || env.PAID_CANCEL_URL,
              }, isPaidTestRequest(request, env));

              const now = Date.now();
              const record: PaidInstanceRecord = {
                agentId: clientId,
                status: "pending_payment",
                createdAt: now,
                updatedAt: now,
                checkoutSessionId: session.id,
                checkoutUrl: session.url,
                planId: env.STRIPE_PRICE_ID,
              };
              await Promise.all([
                putPaidInstance(env, record),
                putCheckoutSessionAgent(env, session.id, clientId),
              ]);
              audit("client.register", "pending_payment", 200, { checkoutUrl: session.url }, clientId);
              return json({
                registered: null,
                paymentRequired: true,
                checkoutUrl: session.url,
                agentId: clientId,
              });
            } catch (error) {
              audit("client.register", "failure", 500, { reason: "checkout-create-failed", message: error instanceof Error ? error.message : String(error) }, clientId);
              return err("CHECKOUT_CREATE_FAILED", error instanceof Error ? error.message : "Unable to create checkout session", 500);
            }
          }
        }

        // Register client after payment
        const existing = await getClient(env, clientId);
        if (!existing) {
          await putClient(env, {
            clientId,
            createdAt: Date.now(),
            cap: ["token:issue", "token:validate"],
          });
        }

        const all = await listClients(env);
        audit("client.register", "success", 200, { totalClients: all.length }, clientId);
        return json({ registered: clientId, totalClients: all.length });
      }

      // List clients
      if (path === "/api/clients" && method === "GET") {
        const limited = await checkRateLimit(
          env,
          request,
          "clients",
          Number(env.RATE_LIMIT_MAX_CLIENTS || "60"),
          Number(env.RATE_LIMIT_WINDOW_SECONDS || "60")
        );
        if (limited) {
          audit("client.list", "denied", 429, { reason: "rate-limited" });
          return limited;
        }

        const limitRaw = url.searchParams.get("limit");
        const cursor = url.searchParams.get("cursor") || undefined;
        const limit = limitRaw === null ? 25 : Number(limitRaw);

        if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
          audit("client.list", "failure", 400, { reason: "invalid-limit", limit: limitRaw });
          return err("INVALID_LIMIT", "limit must be an integer between 1 and 100", 400);
        }

        const page = await listClientsPage(env, limit, cursor);
        audit("client.list", "success", 200, { count: page.clients.length, hasMore: page.hasMore });
        return json({
          clients: page.clients,
          pagination: {
            limit,
            nextCursor: page.nextCursor,
            hasMore: page.hasMore,
          },
        });
      }

      // Delete all clients (reset)
      if (path === "/api/clients" && method === "DELETE") {
        const limited = await checkRateLimit(
          env,
          request,
          "clients",
          Number(env.RATE_LIMIT_MAX_CLIENTS || "60"),
          Number(env.RATE_LIMIT_WINDOW_SECONDS || "60")
        );
        if (limited) {
          audit("client.purge", "denied", 429, { reason: "rate-limited" });
          return limited;
        }

        const allClients = await listClients(env);
        let deletedCount = 0;

        for (const client of allClients) {
          const ok = await deleteClient(env, client.clientId);
          if (ok) deletedCount += 1;
        }

        audit("client.purge", "success", 200, { deletedCount });
        return json({ deletedCount, remaining: 0 });
      }

      // Delete client
      if (path.startsWith("/api/clients/") && method === "DELETE") {
        const limited = await checkRateLimit(
          env,
          request,
          "clients",
          Number(env.RATE_LIMIT_MAX_CLIENTS || "60"),
          Number(env.RATE_LIMIT_WINDOW_SECONDS || "60")
        );
        if (limited) {
          audit("client.delete", "denied", 429, { reason: "rate-limited" });
          return limited;
        }

        const clientId = path.split("/").pop()!;
        if (!isValidClientId(clientId)) {
          audit("client.delete", "failure", 400, { reason: "invalid-client-id", clientId });
          return err("INVALID_CLIENT_ID", "clientId must match ^[A-Za-z0-9._-]{3,64}$", 400);
        }

        const ok = await deleteClient(env, clientId);
        if (!ok) {
          audit("client.delete", "failure", 404, { reason: "client-not-found" }, clientId);
          return err("CLIENT_NOT_FOUND", "Unknown client", 404);
        }

        audit("client.delete", "success", 200, undefined, clientId);
        return json({ deleted: clientId });
      }

      // Issue token
      if (path === "/api/token" && method === "POST") {
        const limited = await checkRateLimit(
          env,
          request,
          "token",
          Number(env.RATE_LIMIT_MAX_TOKEN || "60"),
          Number(env.RATE_LIMIT_WINDOW_SECONDS || "60")
        );
        if (limited) {
          audit("token.issue", "denied", 429, { reason: "rate-limited" });
          return limited;
        }

        const body = await readJson(request);
        if (!body) {
          audit("token.issue", "failure", 400, { reason: "invalid-json" });
          return err("INVALID_JSON", "Body must be valid JSON", 400);
        }

        const tokenReq = parseTokenIssueRequestBody(body);
        if (!tokenReq.ok) {
          audit("token.issue", "failure", 400, { reason: "invalid-client-id-body" });
          return tokenReq.response;
        }
        const clientId = tokenReq.clientId;

        const client = await getClient(env, clientId);
        if (!client) {
          audit("token.issue", "failure", 404, { reason: "client-not-found" }, clientId);
          return err("CLIENT_NOT_FOUND", "Unknown client", 404);
        }

        const now = Math.floor(Date.now() / 1000);
        const ttl = Number(env.TOKEN_TTL_SECONDS || "3600");

        const payload: TokenPayload = {
          clientId,
          iat: now,
          exp: now + ttl,
          cap: client.cap,
        };

        let token: SignedToken;
        try {
          token = await signToken(env, payload, tokenReq.keyMaterial);
        } catch (error) {
          const requestProvided = !!tokenReq.keyMaterial.privateKey;
          audit(
            "token.issue",
            "failure",
            requestProvided ? 400 : 500,
            {
              reason: requestProvided ? "invalid-request-private-key" : "service-private-key-missing-or-invalid",
              message: error instanceof Error ? error.message : String(error),
            },
            clientId
          );
          return err(
            requestProvided ? "INVALID_PRIVATE_KEY" : "SIGNING_KEY_UNAVAILABLE",
            requestProvided ? "Provided privateKey could not be used for signing" : "Service signing key is unavailable",
            requestProvided ? 400 : 500
          );
        }

        audit(
          "token.issue",
          "success",
          200,
          {
            exp: payload.exp,
            keySource: tokenReq.keyMaterial.privateKey ? "request" : "service",
          },
          clientId
        );
        return json(token);
      }

      // Validate token
      if (path === "/api/validate" && method === "POST") {
        const limited = await checkRateLimit(
          env,
          request,
          "validate",
          Number(env.RATE_LIMIT_MAX_VALIDATE || "120"),
          Number(env.RATE_LIMIT_WINDOW_SECONDS || "60")
        );
        if (limited) {
          audit("token.validate", "denied", 429, { reason: "rate-limited" });
          return limited;
        }

        const body = await readJson(request);
        if (!body) {
          audit("token.validate", "failure", 400, { reason: "invalid-json" });
          return err("INVALID_JSON", "Body must be valid JSON", 400);
        }

        const validateReq = parseValidateRequestBody(body);
        if (!validateReq.ok) {
          audit("token.validate", "failure", 400, { reason: "invalid-token-format" });
          return validateReq.response;
        }

        const token = validateReq.token;

        let ok = false;
        try {
          ok = await verifyToken(env, token, { publicKey: validateReq.publicKey });
        } catch (error) {
          const requestProvided = !!validateReq.publicKey;
          audit(
            "token.validate",
            "failure",
            requestProvided ? 400 : 500,
            {
              reason: requestProvided ? "invalid-request-public-key" : "service-public-key-missing-or-invalid",
              message: error instanceof Error ? error.message : String(error),
            },
            token.payload.clientId
          );
          return err(
            requestProvided ? "INVALID_PUBLIC_KEY" : "VERIFY_KEY_UNAVAILABLE",
            requestProvided ? "Provided publicKey could not be used for verification" : "Service verification key is unavailable",
            requestProvided ? 400 : 500
          );
        }

        if (!ok) {
          audit("token.validate", "failure", 401, { reason: "invalid-signature" }, token.payload.clientId);
          return err("INVALID_SIGNATURE", "Token signature is invalid", 401);
        }

        const now = Math.floor(Date.now() / 1000);
        if (token.payload.exp < now) {
          audit("token.validate", "failure", 401, { reason: "expired", exp: token.payload.exp, now }, token.payload.clientId);
          return err("TOKEN_EXPIRED", "Token has expired", 401, {
            exp: token.payload.exp,
            now,
          });
        }

        const client = await getClient(env, token.payload.clientId);
        if (!client) {
          audit("token.validate", "failure", 404, { reason: "client-not-found" }, token.payload.clientId);
          return err("CLIENT_NOT_FOUND", "Unknown client", 404, {
            clientId: token.payload.clientId,
          });
        }

        audit(
          "token.validate",
          "success",
          200,
          { keySource: validateReq.publicKey ? "request" : "service" },
          token.payload.clientId
        );
        return json({ valid: true, payload: token.payload });
      }

      return err("NOT_FOUND", "Route not found", 404, { path, method });
    } catch {
      return err("INTERNAL_ERROR", "Unexpected server error", 500, undefined, true);
    }
  },
};

// ---------- Helpers ----------

type AuditEvent = {
  requestId: string;
  timestamp: string;
  action: string;
  outcome: "success" | "failure" | "denied";
  status: number;
  clientId?: string;
  ip: string;
  method: string;
  path: string;
  details: Record<string, unknown> | null;
};

function newRequestId(): string {
  return typeof crypto?.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function emitAuditEvent(ctx: ExecutionContext, env: Env, event: AuditEvent): void {
  if (!env.AUDIT_WEBHOOK_URL) return;

  ctx.waitUntil(sendAuditWebhook(env, event));
}

async function sendAuditWebhook(env: Env, event: AuditEvent): Promise<void> {
  const timeoutMs = Math.max(200, Number(env.AUDIT_WEBHOOK_TIMEOUT_MS || "1500"));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Agent-Identity-Event": event.action,
      "X-Agent-Identity-Request-Id": event.requestId,
    };

    if (env.AUDIT_WEBHOOK_AUTH_TOKEN) {
      headers.Authorization = `Bearer ${env.AUDIT_WEBHOOK_AUTH_TOKEN}`;
    }

    const res = await fetch(env.AUDIT_WEBHOOK_URL, {
      method: "POST",
      headers,
      body: JSON.stringify(event),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.warn("[audit-webhook] non-2xx response", { status: res.status, action: event.action });
    }
  } catch (error) {
    console.warn("[audit-webhook] delivery failed", {
      action: event.action,
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    clearTimeout(timer);
  }
}

function safeJsonParse(str: string): unknown {
  try {
    return JSON.parse(str);
  } catch {
    return null;
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isValidClientId(clientId: string): boolean {
  return /^[A-Za-z0-9._-]{3,64}$/.test(clientId);
}

function parseClientIdFromBody(body: Record<string, any>) {
  if (!isObjectRecord(body)) {
    return {
      ok: false as const,
      response: err("INVALID_REQUEST_SCHEMA", "Body must be a JSON object", 400),
    };
  }

  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== "clientId") {
    return {
      ok: false as const,
      response: err("INVALID_REQUEST_SCHEMA", "Body must contain only { clientId }", 400),
    };
  }

  if (typeof body.clientId !== "string") {
    return {
      ok: false as const,
      response: err("CLIENT_ID_REQUIRED", "clientId required", 400),
    };
  }

  const clientId = body.clientId.trim();
  if (!isValidClientId(clientId)) {
    return {
      ok: false as const,
      response: err("INVALID_CLIENT_ID", "clientId must match ^[A-Za-z0-9._-]{3,64}$", 400),
    };
  }

  return { ok: true as const, clientId };
}

function parseTokenIssueRequestBody(body: Record<string, any>) {
  if (!isObjectRecord(body)) {
    return {
      ok: false as const,
      response: err("INVALID_REQUEST_SCHEMA", "Body must be a JSON object", 400),
    };
  }

  const allowed = new Set(["clientId", "privateKey", "publicKey"]);
  if (Object.keys(body).some((key) => !allowed.has(key))) {
    return {
      ok: false as const,
      response: err("INVALID_REQUEST_SCHEMA", "Body supports only clientId, privateKey, publicKey", 400),
    };
  }

  const base = parseClientIdFromBody({ clientId: body.clientId });
  if (!base.ok) return base;

  const privateKey = normalizePem(body.privateKey);
  const publicKey = normalizePem(body.publicKey);

  if (body.privateKey !== undefined && !privateKey) {
    return {
      ok: false as const,
      response: err("INVALID_PRIVATE_KEY", "privateKey must be a non-empty PEM string", 400),
    };
  }
  if (privateKey && !isLikelyPem(privateKey)) {
    return {
      ok: false as const,
      response: err("INVALID_PRIVATE_KEY", "privateKey must be PEM formatted", 400),
    };
  }

  if (body.publicKey !== undefined && !publicKey) {
    return {
      ok: false as const,
      response: err("INVALID_PUBLIC_KEY", "publicKey must be a non-empty PEM string", 400),
    };
  }
  if (publicKey && !isLikelyPem(publicKey)) {
    return {
      ok: false as const,
      response: err("INVALID_PUBLIC_KEY", "publicKey must be PEM formatted", 400),
    };
  }

  return {
    ok: true as const,
    clientId: base.clientId,
    keyMaterial: {
      privateKey,
      publicKey,
    },
  };
}

function parseValidateRequestBody(body: Record<string, any>) {
  if (!isObjectRecord(body)) {
    return {
      ok: false as const,
      response: err("INVALID_REQUEST_SCHEMA", "Body must be a JSON object", 400),
    };
  }

  const directTokenShape = Object.prototype.hasOwnProperty.call(body, "payload") || Object.prototype.hasOwnProperty.call(body, "sig");
  const envelopeTokenShape = Object.prototype.hasOwnProperty.call(body, "token");

  if (directTokenShape && envelopeTokenShape) {
    return {
      ok: false as const,
      response: err("INVALID_REQUEST_SCHEMA", "Use either {payload,sig} or {token}, not both", 400),
    };
  }

  let tokenCandidate: unknown = null;
  if (directTokenShape) {
    const allowed = new Set(["payload", "sig", "publicKey"]);
    if (Object.keys(body).some((key) => !allowed.has(key))) {
      return {
        ok: false as const,
        response: err("INVALID_REQUEST_SCHEMA", "Direct validate body supports only payload, sig, publicKey", 400),
      };
    }
    tokenCandidate = { payload: body.payload, sig: body.sig };
  } else if (envelopeTokenShape) {
    const allowed = new Set(["token", "publicKey"]);
    if (Object.keys(body).some((key) => !allowed.has(key))) {
      return {
        ok: false as const,
        response: err("INVALID_REQUEST_SCHEMA", "Envelope validate body supports only token and publicKey", 400),
      };
    }
    tokenCandidate = body.token;
  } else {
    tokenCandidate = body;
  }

  if (!isValidSignedToken(tokenCandidate)) {
    return {
      ok: false as const,
      response: err("INVALID_TOKEN_FORMAT", "Token must include payload {clientId, iat, exp, cap[]} and sig", 400),
    };
  }

  const publicKey = normalizePem(body.publicKey);
  if (body.publicKey !== undefined && !publicKey) {
    return {
      ok: false as const,
      response: err("INVALID_PUBLIC_KEY", "publicKey must be a non-empty PEM string", 400),
    };
  }
  if (publicKey && !isLikelyPem(publicKey)) {
    return {
      ok: false as const,
      response: err("INVALID_PUBLIC_KEY", "publicKey must be PEM formatted", 400),
    };
  }

  return {
    ok: true as const,
    token: tokenCandidate,
    publicKey,
  };
}

function isValidSignedToken(value: unknown): value is SignedToken {
  if (!isObjectRecord(value)) return false;
  if (Object.keys(value).some((key) => key !== "payload" && key !== "sig")) return false;

  const payload = (value as Record<string, unknown>).payload;
  const sig = (value as Record<string, unknown>).sig;
  if (!isObjectRecord(payload) || typeof sig !== "string" || !sig.trim()) return false;

  if (typeof payload.clientId !== "string" || !isValidClientId(payload.clientId)) return false;
  if (typeof payload.iat !== "number" || !Number.isFinite(payload.iat)) return false;
  if (typeof payload.exp !== "number" || !Number.isFinite(payload.exp)) return false;
  if (!Array.isArray(payload.cap) || !payload.cap.every((cap) => typeof cap === "string")) return false;

  return true;
}

function encodeClientsCursor(offset: number): string {
  return btoa(JSON.stringify({ offset }));
}

function decodeClientsCursor(cursor?: string): number {
  if (!cursor) return 0;

  try {
    const parsed = safeJsonParse(atob(cursor));
    if (!isObjectRecord(parsed)) return 0;
    const offset = Number(parsed.offset);
    if (!Number.isInteger(offset) || offset < 0) return 0;
    return offset;
  } catch {
    return 0;
  }
}

function requireApiKey(request: Request, env: Env): Response | null {
  const configured = env.ADMIN_API_KEY?.trim();
  if (!configured) return null;

  const headerKey = request.headers.get("x-api-key")?.trim();
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  const provided = headerKey || bearer;

  if (!provided || provided !== configured) {
    return err("UNAUTHORIZED", "Valid API key required", 401, {
      accepted: ["x-api-key", "authorization: Bearer <token>"],
    });
  }

  return null;
}

function isPaidPublicRoute(path: string, method: string): boolean {
  if (path === "/api/paid/checkout" && method === "POST") return true;
  if (path === "/api/paid/webhook" && method === "POST") return true;
  if (path === "/api/paid/provisioning/callback" && method === "POST") return true;
  if (path.startsWith("/api/paid/instances/") && method === "GET") return true;
  return false;
}

function isPaidExtensionEnabled(env: Env): boolean {
  const raw = (env.PAID_EXTENSION_ENABLED || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function isPaidTestMode(env: Env): boolean {
  const raw = (env.PAID_TEST_MODE || "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

function isLocalHostname(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function isPaidTestRequest(request: Request, env: Env): boolean {
  const expected = (env.PAID_TEST_TOKEN || "local-paid-test-token").trim();
  if (!expected) return false;

  let hostname = "";
  try {
    hostname = new URL(request.url).hostname;
  } catch {
    return false;
  }
  if (!isLocalHostname(hostname)) return false;

  const provided = request.headers.get("x-paid-test-token")?.trim();
  return !!provided && provided === expected;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

async function verifyStripeWebhookSignature(request: Request, env: Env, rawBody: string): Promise<boolean> {
  if (isPaidTestMode(env) || isPaidTestRequest(request, env)) {
    return isPaidTestRequest(request, env);
  }

  const secret = env.STRIPE_WEBHOOK_SECRET?.trim();
  if (!secret) return false;

  const sigHeader = request.headers.get("stripe-signature")?.trim();
  if (!sigHeader) return false;

  let timestamp = "";
  const v1: string[] = [];
  for (const part of sigHeader.split(",")) {
    const [k, v] = part.split("=");
    if (k === "t" && v) timestamp = v;
    if (k === "v1" && v) v1.push(v);
  }
  if (!timestamp || v1.length === 0) return false;

  const payload = `${timestamp}.${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  const expected = bytesToHex(new Uint8Array(digest));

  return v1.some((candidate) => timingSafeEqualHex(candidate, expected));
}

async function createStripeCheckoutSession(
  env: Env,
  input: { origin: string; agentId: string; email?: string; successUrl?: string; cancelUrl?: string },
  forceTestMode = false
): Promise<{ id: string; url: string }> {
  if (forceTestMode || isPaidTestMode(env)) {
    const id = randomId("cs_test_");
    return {
      id,
      url: `${input.origin}/dashboard?paid=test-checkout&agentId=${encodeURIComponent(input.agentId)}&sessionId=${encodeURIComponent(id)}`,
    };
  }

  const secret = env.STRIPE_SECRET_KEY?.trim();
  if (!secret) throw new Error("STRIPE_SECRET_KEY is not configured");

  const priceId = env.STRIPE_PRICE_ID?.trim();
  if (!priceId) throw new Error("STRIPE_PRICE_ID is not configured");

  const successUrl = input.successUrl || env.PAID_SUCCESS_URL || `${input.origin}/dashboard?paid=success&agentId=${encodeURIComponent(input.agentId)}`;
  const cancelUrl = input.cancelUrl || env.PAID_CANCEL_URL || `${input.origin}/dashboard?paid=cancel&agentId=${encodeURIComponent(input.agentId)}`;

  const form = new URLSearchParams();
  form.set("mode", "subscription");
  form.set("client_reference_id", input.agentId);
  form.set("success_url", successUrl);
  form.set("cancel_url", cancelUrl);
  form.set("line_items[0][price]", priceId);
  form.set("line_items[0][quantity]", "1");
  form.set("metadata[agentId]", input.agentId);
  if (input.email) form.set("customer_email", input.email);

  const response = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: form.toString(),
  });

  const payload = safeJsonParse(await response.text());
  if (!response.ok || !isObjectRecord(payload)) {
    throw new Error("Stripe checkout session creation failed");
  }

  const id = typeof payload.id === "string" ? payload.id : "";
  const url = typeof payload.url === "string" ? payload.url : "";
  if (!id || !url) throw new Error("Stripe checkout session response missing id/url");
  return { id, url };
}

async function handleStripeWebhookEvent(
  ctx: ExecutionContext,
  env: Env,
  type: string,
  obj: Record<string, unknown>,
  forceTestMode = false
): Promise<void> {
  const now = Date.now();

  if (type === "checkout.session.completed") {
    const sessionId = typeof obj.id === "string" ? obj.id : "";
    const agentIdFromRef = typeof obj.client_reference_id === "string" ? obj.client_reference_id : "";
    const metadata = isObjectRecord(obj.metadata) ? obj.metadata : null;
    const agentIdFromMetadata = metadata && typeof metadata.agentId === "string" ? metadata.agentId : "";
    const mappedAgentId = sessionId ? await getAgentIdByCheckoutSession(env, sessionId) : null;

    const agentId = mappedAgentId || agentIdFromRef || agentIdFromMetadata;
    if (!agentId || !isValidClientId(agentId)) return;

    const customerId = typeof obj.customer === "string" ? obj.customer : undefined;
    const subscriptionId = typeof obj.subscription === "string" ? obj.subscription : undefined;

    const existing = await getPaidInstance(env, agentId);
    const next: PaidInstanceRecord = {
      agentId,
      status: "provisioning",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      checkoutSessionId: sessionId || existing?.checkoutSessionId,
      checkoutUrl: existing?.checkoutUrl,
      customerId: customerId || existing?.customerId,
      subscriptionId: subscriptionId || existing?.subscriptionId,
      planId: existing?.planId || env.STRIPE_PRICE_ID,
      instanceUrl: existing?.instanceUrl,
      provisionJobId: existing?.provisionJobId,
      lastError: undefined,
    };

    await putPaidInstance(env, next);
    if (subscriptionId) await putSubscriptionAgent(env, subscriptionId, agentId);

    ctx.waitUntil(startProvisioning(env, next, forceTestMode));
    return;
  }

  if (type === "customer.subscription.updated" || type === "customer.subscription.deleted" || type === "invoice.payment_failed") {
    const subscriptionId = typeof obj.id === "string" && obj.id.startsWith("sub_")
      ? obj.id
      : typeof obj.subscription === "string"
        ? obj.subscription
        : undefined;

    if (!subscriptionId) return;
    const agentId = await getAgentIdBySubscription(env, subscriptionId);
    if (!agentId) return;

    const existing = await getPaidInstance(env, agentId);
    if (!existing) return;

    let nextStatus: PaidInstanceStatus = existing.status;
    const stripeStatus = typeof obj.status === "string" ? obj.status : "";

    if (type === "customer.subscription.deleted") {
      nextStatus = "canceled";
    } else if (type === "invoice.payment_failed") {
      nextStatus = "past_due";
    } else {
      if (stripeStatus === "active" || stripeStatus === "trialing") nextStatus = "active";
      else if (stripeStatus === "past_due" || stripeStatus === "unpaid") nextStatus = "past_due";
      else if (stripeStatus === "canceled" || stripeStatus === "incomplete_expired") nextStatus = "canceled";
    }

    await putPaidInstance(env, {
      ...existing,
      status: nextStatus,
      updatedAt: now,
      subscriptionId,
    });
  }
}

async function startProvisioning(env: Env, record: PaidInstanceRecord, forceTestMode = false): Promise<void> {
  const provisionerUrl = env.PAID_PROVISIONER_URL?.trim();
  if (!provisionerUrl && (isPaidTestMode(env) || forceTestMode)) {
    await putPaidInstance(env, {
      ...record,
      status: "active",
      updatedAt: Date.now(),
      instanceUrl: record.instanceUrl || `https://test-instance.local/${encodeURIComponent(record.agentId)}`,
      provisionJobId: record.provisionJobId || randomId("job_test_"),
      lastError: undefined,
    });
    return;
  }

  if (!provisionerUrl) {
    await putPaidInstance(env, {
      ...record,
      status: "provision_failed",
      updatedAt: Date.now(),
      lastError: "PAID_PROVISIONER_URL is not configured",
    });
    return;
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (env.PAID_PROVISIONER_AUTH_TOKEN) {
    headers.Authorization = `Bearer ${env.PAID_PROVISIONER_AUTH_TOKEN}`;
  }

  try {
    const response = await fetch(provisionerUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        agentId: record.agentId,
        customerId: record.customerId ?? null,
        subscriptionId: record.subscriptionId ?? null,
        planId: record.planId ?? null,
      }),
    });

    const payload = safeJsonParse(await response.text());
    if (!response.ok) {
      await putPaidInstance(env, {
        ...record,
        status: "provision_failed",
        updatedAt: Date.now(),
        lastError: `Provisioner failed with status ${response.status}`,
      });
      return;
    }

    const instanceUrl = isObjectRecord(payload) && typeof payload.instanceUrl === "string"
      ? payload.instanceUrl
      : undefined;
    const provisionJobId = isObjectRecord(payload) && typeof payload.jobId === "string"
      ? payload.jobId
      : undefined;

    await putPaidInstance(env, {
      ...record,
      status: instanceUrl ? "active" : "provisioning",
      updatedAt: Date.now(),
      instanceUrl: instanceUrl || record.instanceUrl,
      provisionJobId: provisionJobId || record.provisionJobId,
      lastError: undefined,
    });
  } catch (error) {
    await putPaidInstance(env, {
      ...record,
      status: "provision_failed",
      updatedAt: Date.now(),
      lastError: error instanceof Error ? error.message : "Provisioner request failed",
    });
  }
}

function getClientIp(request: Request): string {
  const cf = request.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;

  const xff = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (xff) return xff;

  return "unknown";
}

async function checkRateLimit(
  env: Env,
  request: Request,
  bucket: string,
  maxRequests: number,
  windowSeconds: number
): Promise<Response | null> {
  const ip = getClientIp(request);
  const safeMax = Math.max(1, Number.isFinite(maxRequests) ? maxRequests : 60);
  const safeWindow = Math.max(1, Number.isFinite(windowSeconds) ? windowSeconds : 60);
  const windowId = Math.floor(Date.now() / 1000 / safeWindow);
  const key = `${RATE_PREFIX}${bucket}:${ip}:${windowId}`;

  const current = Number(await env.CLIENTS.get(key) || "0");
  const next = Number.isFinite(current) ? current + 1 : 1;

  await env.CLIENTS.put(key, String(next), { expirationTtl: safeWindow + 5 });

  if (next > safeMax) {
    return err("RATE_LIMITED", "Rate limit exceeded", 429, {
      bucket,
      ip,
      maxRequests: safeMax,
      windowSeconds: safeWindow,
      retryAfterSeconds: safeWindow,
    }, true);
  }

  return null;
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function bad(message: string, status = 400): Response {
  return err("BAD_REQUEST", message, status);
}

async function readJson(request: Request): Promise<Record<string, any> | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function err(
  code: string,
  message: string,
  status = 400,
  details?: Record<string, unknown>,
  retryable = false
): Response {
  const requestId = newRequestId();

  return json(
    {
      ok: false,
      error: {
        code,
        message,
        status,
        retryable,
        requestId,
        details: details ?? null,
      },
    },
    status
  );
}

function openApiSpec(origin: string) {
  return {
    openapi: "3.0.3",
    info: {
      title: "Agent Identity API",
      version: "1.0.0",
      description: "Client registry and signed token service",
    },
    "x-lifecycle": {
      resource: "client",
      states: ["unregistered", "registered", "deleted"],
      transitions: [
        {
          action: "register",
          from: "unregistered",
          to: "registered",
          endpoint: "/api/register",
          method: "POST",
        },
        {
          action: "issueToken",
          from: "registered",
          to: "registered",
          endpoint: "/api/token",
          method: "POST",
          note: "Issues token for an existing client; does not change client state",
        },
        {
          action: "validateToken",
          from: "registered",
          to: "registered",
          endpoint: "/api/validate",
          method: "POST",
          note: "Validates token signature/expiry/client existence; does not change client state",
        },
        {
          action: "delete",
          from: "registered",
          to: "deleted",
          endpoint: "/api/clients/{clientId}",
          method: "DELETE",
        },
      ],
    },
    servers: [{ url: origin }],
    components: {
      securitySchemes: {
        ApiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "x-api-key",
        },
      },
      schemas: {
        ErrorDetail: {
          type: "object",
          properties: {
            code: { type: "string", example: "CLIENT_NOT_FOUND" },
            message: { type: "string", example: "Unknown client" },
            status: { type: "integer", example: 404 },
            retryable: { type: "boolean", example: false },
            requestId: { type: "string", example: "6de68cd4-a212-4db8-8808-c85cde6e5a0c" },
            details: { type: ["object", "null"], additionalProperties: true },
          },
          required: ["code", "message", "status", "retryable", "requestId", "details"],
        },
        ErrorEnvelope: {
          type: "object",
          properties: {
            ok: { type: "boolean", enum: [false] },
            error: { $ref: "#/components/schemas/ErrorDetail" },
          },
          required: ["ok", "error"],
        },
      },
      responses: {
        BadRequest: {
          description: "Bad request",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorEnvelope" },
            },
          },
        },
        Unauthorized: {
          description: "Authentication/signature failure",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorEnvelope" },
            },
          },
        },
        NotFound: {
          description: "Requested resource not found",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorEnvelope" },
            },
          },
        },
        InternalError: {
          description: "Unexpected server error",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorEnvelope" },
            },
          },
        },
        TooManyRequests: {
          description: "Rate limit exceeded",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ErrorEnvelope" },
            },
          },
        },
      },
    },
    paths: {
      "/health": {
        get: {
          summary: "Health check",
          responses: {
            "200": {
              description: "Service is healthy",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: { status: { type: "string", example: "ok" } },
                    required: ["status"],
                  },
                },
              },
            },
            "500": { $ref: "#/components/responses/InternalError" },
          },
        },
      },
      "/capabilities": {
        get: {
          summary: "List supported capabilities",
          responses: {
            "200": {
              description: "Capability list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      capabilities: {
                        type: "array",
                        items: { type: "string" },
                      },
                    },
                    required: ["capabilities"],
                  },
                },
              },
            },
            "500": { $ref: "#/components/responses/InternalError" },
          },
        },
      },
      "/api/register": {
        post: {
          summary: "Register a client",
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: { clientId: { type: "string" } },
                  required: ["clientId"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Client registered",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      registered: { type: "string" },
                      totalClients: { type: "number" },
                    },
                    required: ["registered", "totalClients"],
                  },
                },
              },
            },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "429": { $ref: "#/components/responses/TooManyRequests" },
            "500": { $ref: "#/components/responses/InternalError" },
          },
        },
      },
      "/api/clients": {
        get: {
          summary: "List clients",
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            {
              name: "limit",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1, maximum: 100, default: 25 },
              description: "Maximum number of clients to return",
            },
            {
              name: "cursor",
              in: "query",
              required: false,
              schema: { type: "string" },
              description: "Opaque pagination cursor from previous response",
            },
          ],
          responses: {
            "200": {
              description: "Client list",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      clients: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            clientId: { type: "string" },
                            createdAt: { type: "number" },
                            cap: { type: "array", items: { type: "string" } },
                          },
                          required: ["clientId", "createdAt", "cap"],
                        },
                      },
                      pagination: {
                        type: "object",
                        properties: {
                          limit: { type: "integer" },
                          nextCursor: { type: ["string", "null"] },
                          hasMore: { type: "boolean" },
                        },
                        required: ["limit", "nextCursor", "hasMore"],
                      },
                    },
                    required: ["clients", "pagination"],
                  },
                },
              },
            },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "429": { $ref: "#/components/responses/TooManyRequests" },
            "500": { $ref: "#/components/responses/InternalError" },
          },
        },
        delete: {
          summary: "Delete all clients",
          security: [{ ApiKeyAuth: [] }],
          responses: {
            "200": {
              description: "All clients deleted",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      deletedCount: { type: "integer" },
                      remaining: { type: "integer", example: 0 },
                    },
                    required: ["deletedCount", "remaining"],
                  },
                },
              },
            },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "429": { $ref: "#/components/responses/TooManyRequests" },
            "500": { $ref: "#/components/responses/InternalError" },
          },
        },
      },
      "/api/clients/{clientId}": {
        delete: {
          summary: "Delete a client",
          security: [{ ApiKeyAuth: [] }],
          parameters: [
            {
              name: "clientId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "Client deleted" },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
            "429": { $ref: "#/components/responses/TooManyRequests" },
            "500": { $ref: "#/components/responses/InternalError" },
          },
        },
      },
      "/api/token": {
        post: {
          summary: "Issue a signed token",
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    clientId: { type: "string" },
                    privateKey: {
                      type: "string",
                      description: "Optional PEM private key override used to sign this token",
                    },
                    publicKey: {
                      type: "string",
                      description: "Optional PEM public key companion for metadata parity",
                    },
                  },
                  required: ["clientId"],
                },
              },
            },
          },
          responses: {
            "200": { description: "Signed token" },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
            "429": { $ref: "#/components/responses/TooManyRequests" },
            "500": { $ref: "#/components/responses/InternalError" },
          },
        },
      },
      "/api/validate": {
        post: {
          summary: "Validate token",
          security: [{ ApiKeyAuth: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  oneOf: [
                    {
                      type: "object",
                      properties: {
                        payload: { type: "object", additionalProperties: true },
                        sig: { type: "string" },
                        publicKey: {
                          type: "string",
                          description: "Optional PEM public key override used for verification",
                        },
                      },
                      required: ["payload", "sig"],
                    },
                    {
                      type: "object",
                      properties: {
                        token: {
                          type: "object",
                          properties: {
                            payload: { type: "object", additionalProperties: true },
                            sig: { type: "string" },
                          },
                          required: ["payload", "sig"],
                        },
                        publicKey: {
                          type: "string",
                          description: "Optional PEM public key override used for verification",
                        },
                      },
                      required: ["token"],
                    },
                  ],
                },
              },
            },
          },
          responses: {
            "200": { description: "Validation result" },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
            "429": { $ref: "#/components/responses/TooManyRequests" },
            "500": { $ref: "#/components/responses/InternalError" },
          },
        },
      },
      "/api/paid/checkout": {
        post: {
          summary: "Create a paid checkout session for a dedicated instance",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    agentId: { type: "string" },
                    email: { type: "string", format: "email" },
                    successUrl: { type: "string", format: "uri" },
                    cancelUrl: { type: "string", format: "uri" },
                  },
                  required: ["agentId"],
                },
              },
            },
          },
          responses: {
            "200": {
              description: "Checkout session created",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      agentId: { type: "string" },
                      status: { type: "string", example: "pending_payment" },
                      checkoutSessionId: { type: "string" },
                      checkoutUrl: { type: "string", format: "uri" },
                    },
                    required: ["agentId", "status", "checkoutSessionId", "checkoutUrl"],
                  },
                },
              },
            },
            "400": { $ref: "#/components/responses/BadRequest" },
            "404": { $ref: "#/components/responses/NotFound" },
            "429": { $ref: "#/components/responses/TooManyRequests" },
            "500": { $ref: "#/components/responses/InternalError" },
          },
        },
      },
      "/api/paid/webhook": {
        post: {
          summary: "Receive payment provider webhook events",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { type: "object", additionalProperties: true },
              },
            },
          },
          responses: {
            "200": { description: "Webhook accepted" },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
            "500": { $ref: "#/components/responses/InternalError" },
          },
        },
      },
      "/api/paid/instances/{agentId}": {
        get: {
          summary: "Get paid instance provisioning status",
          parameters: [
            {
              name: "agentId",
              in: "path",
              required: true,
              schema: { type: "string" },
            },
          ],
          responses: {
            "200": { description: "Provisioning status" },
            "400": { $ref: "#/components/responses/BadRequest" },
            "404": { $ref: "#/components/responses/NotFound" },
            "500": { $ref: "#/components/responses/InternalError" },
          },
        },
      },
      "/api/paid/provisioning/callback": {
        post: {
          summary: "Provisioner callback to update dedicated instance status",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    agentId: { type: "string" },
                    status: { type: "string" },
                    instanceUrl: { type: "string", format: "uri" },
                    provisionJobId: { type: "string" },
                    error: { type: "string" },
                  },
                  required: ["agentId", "status"],
                },
              },
            },
          },
          responses: {
            "200": { description: "Status updated" },
            "400": { $ref: "#/components/responses/BadRequest" },
            "401": { $ref: "#/components/responses/Unauthorized" },
            "404": { $ref: "#/components/responses/NotFound" },
            "500": { $ref: "#/components/responses/InternalError" },
          },
        },
      },
    },
  };
}

function agentDiscovery(origin: string, env: Env) {
  return {
    name: "agent-identity",
    description: "Client registry and signed token service",
    version: "1.0.0",
    api: {
      openapi: `${origin}/openapi.json`,
      capabilities: `${origin}/capabilities`,
      health: `${origin}/health`,
    },
    dashboard: `${origin}/dashboard`,
    authentication: {
      type: "api-key-optional",
      note: "When ADMIN_API_KEY is configured, /api/* endpoints require x-api-key or Bearer token",
    },
    paidExtension: {
      enabled: isPaidExtensionEnabled(env),
      checkout: `${origin}/api/paid/checkout`,
      instanceStatus: `${origin}/api/paid/instances/{agentId}`,
      note: "When enabled, agents can purchase and provision isolated dedicated instances",
    },
    lifecycle: {
      description: "Client lifecycle metadata",
      source: `${origin}/openapi.json#x-lifecycle`,
    },
  };
}
