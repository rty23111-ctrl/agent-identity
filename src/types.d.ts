export {};

declare module "*.md" {
  const content: string;
  export default content;
}

declare global {
  interface KVNamespace {
    get(key: string): Promise<string | null>;
    put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
    delete(key: string): Promise<void>;
    list(): Promise<{ keys: Array<{ name: string }> }>;
  }

  interface Env {
    PRIVATE_KEY?: string;
    PUBLIC_KEY?: string;
    TOKEN_TTL_SECONDS?: string;
    VERSION?: string;
    CLIENTS: KVNamespace;
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
}
