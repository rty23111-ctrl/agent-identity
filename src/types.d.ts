export {};

declare global {
  interface Env {
    PRIVATE_KEY: string;
    PUBLIC_KEY: string;
    TOKEN_TTL_SECONDS: string;
    VERSION?: string;
  }
}
