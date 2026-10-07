/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PHONE_URL?: string;
  readonly VITE_API_BASE: string;
  readonly VITE_USE_MOCK: string;
  readonly VITE_SENTRY_DSN_WEB?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
