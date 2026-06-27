// ============================================================================
//  部署模式 profile — "本机 / 服务器" 一键切换的真理源
//  ----------------------------------------------------------------------------
//  通过单一环境变量 DEPLOY_MODE 决定整个 server 的行为：
//    local   →  本机开发：bind 127.0.0.1，CORS 全开，admin 控制台开放，默认 token 可用，启动日志详细
//    server  →  生产部署：bind 0.0.0.0，CORS 白名单，强制非默认 ADMIN_TOKEN，HTTPS 由反代处理
//
//  使用方：
//    apps/api/src/index.ts —— 起服务时读 host/port/cors
//    apps/api/src/middleware/auth.ts —— server 模式下校验 token 强度
//
//  扩展：要加新模式（如 staging）就在 ProfileMap 里加一项；不要分散到代码里。
// ============================================================================

export type DeployMode = 'local' | 'server';

/** 给前端 / 控制台展示的 profile 形态（不含 secret） */
export interface DeployProfile {
  mode: DeployMode;
  /** 监听地址 */
  host: string;
  /** 监听端口 */
  port: number;
  /** CORS allowed origins。'*' 表示全开；string[] 表示白名单 */
  corsOrigins: '*' | string[];
  /** 是否要求 ADMIN_TOKEN 不能是默认值 admin-dev-token */
  requireStrongAdminToken: boolean;
  /** 是否对外暴露 /admin 静态控制台（生产可关，由独立 admin 前端代替） */
  enableAdminConsole: boolean;
  /** 是否信任 X-Forwarded-* 头（站在 caddy/nginx 后面时需要） */
  trustProxy: boolean;
  /** 启动日志详略 */
  verboseStartup: boolean;
}

/**
 * 从环境读 mode；不识别值默认 local（最安全的兜底，避免误打开生产开关）
 */
export function getDeployMode(): DeployMode {
  return process.env.DEPLOY_MODE === 'server' ? 'server' : 'local';
}

/**
 * 解析当前 profile。允许个别字段被 ENV 单独覆盖，便于在 docker-compose 里精调。
 */
export function getDeployProfile(): DeployProfile {
  const mode = getDeployMode();
  const port = Number(process.env.MOCK_PORT ?? process.env.PORT ?? 8787);

  // CORS 白名单：CORS_ORIGINS=https://a.com,https://b.com
  const corsRaw = (process.env.CORS_ORIGINS ?? '').trim();
  const corsList = corsRaw ? corsRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];

  if (mode === 'server') {
    return {
      mode,
      host: process.env.MOCK_HOST ?? '0.0.0.0',
      port,
      // 生产默认要求白名单；显式给 CORS_ORIGINS=* 才开放
      corsOrigins: corsRaw === '*' ? '*' : corsList,
      requireStrongAdminToken: process.env.ALLOW_DEFAULT_ADMIN_TOKEN !== 'true',
      enableAdminConsole: process.env.ENABLE_ADMIN_CONSOLE !== 'false',
      trustProxy: process.env.TRUST_PROXY !== 'false',
      verboseStartup: process.env.VERBOSE_STARTUP === 'true',
    };
  }

  // local
  return {
    mode,
    host: process.env.MOCK_HOST ?? '127.0.0.1',
    port,
    corsOrigins: corsList.length ? corsList : '*',
    requireStrongAdminToken: false,
    enableAdminConsole: true,
    trustProxy: false,
    verboseStartup: process.env.VERBOSE_STARTUP !== 'false',
  };
}

/**
 * 启动前的安全自检。返回 string[] = 致命问题（数组为空就放行）。
 * 只在 server 模式上做强制；local 模式给 warn 日志。
 */
export function preflightCheck(profile: DeployProfile): { fatal: string[]; warn: string[] } {
  const fatal: string[] = [];
  const warn: string[] = [];

  const adminToken = process.env.ADMIN_TOKEN || 'admin-dev-token';
  const isDefaultToken = adminToken === 'admin-dev-token';

  if (profile.mode === 'server') {
    if (isDefaultToken && profile.requireStrongAdminToken) {
      fatal.push('ADMIN_TOKEN 仍为默认 admin-dev-token；生产环境必须改。设 ALLOW_DEFAULT_ADMIN_TOKEN=true 跳过此检查（不推荐）。');
    }
    if (Array.isArray(profile.corsOrigins) && profile.corsOrigins.length === 0) {
      warn.push('CORS_ORIGINS 未设；所有跨源请求会被拒绝。如需开放：CORS_ORIGINS=https://your-domain.com');
    }
    const llmKeys = ['ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'NVIDIA_API_KEY'];
    if (!llmKeys.some((k) => process.env[k] && process.env[k]!.length > 10)) {
      warn.push('未设任何 LLM API key — 生产环境强烈建议至少配一个');
    }
  } else {
    // local
    if (!isDefaultToken) {
      warn.push(`ADMIN_TOKEN 已自定义（不是默认值）— 控制台请用相同 token 登录`);
    }
  }

  return { fatal, warn };
}
