// 接口契约三向对比检查
// 对照 shared contracts ↔ apps/api routes ↔ server routes
// 输出 missing / gap / unused，非零退出阻断 CI
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(import.meta.url), '..', '..');
const R = '\x1b[31m';
const G = '\x1b[32m';
const Y = '\x1b[33m';
const C = '\x1b[36m';
const N = '\x1b[0m';
const B = '\x1b[1m';

// ── 权威映射：业务域 → contract 文件 ──────────────────────────────────────
// null = 暂无契约（待补充）；'__internal__' = 运维端点，不做 API 契约
const DOMAIN_CONTRACT_MAP = {
  'phone': 'phone',
  'admin/materials': '__internal__',
  'admin/voice': 'voice',
  'me/created-characters': 'user-character',
  'api-gateway': 'api-gateway',
  'admin/api-gateway': 'api-gateway',
  'developer': '__internal__',
  'achievements': 'achievements',
  'admin/candle': 'admin',
  'admin/characters': 'admin',
  'admin/config': 'admin',
  'admin/constellations': 'admin',
  'admin/costs': '__internal__',
  'admin/diagnostics': '__internal__',
  'admin/health': '__internal__',
  'admin/if-codes': 'admin',
  'admin/llm-apis': 'admin',
  'admin/membership': 'admin',
  'admin/policy': 'admin',
  'admin/prelude-cards': 'admin',
  'admin/prompts': 'admin',
  'admin/quota': 'admin',
  'admin/seed': '__internal__',
  'admin/sessions': '__internal__',
  'admin/sidecar-config': 'admin',
  'admin/sidecar-prompts': 'admin',
  'admin/surveys': 'survey',
  'admin/users': 'admin',
  'admin/audit': '__internal__',
  'auth': 'auth',
  'billing': 'billing',
  'characters': 'characters',
  'chat': 'chat',
  'events': 'chat',        // TelemetryBatchSchema 在 chat contract 中
  'if-codes': 'if-codes',
  'logs': 'logs',
  'me': 'me',
  'me/memories': 'me',
  'me/preferences': 'me',
  'mock-fallback': '__internal__',
  'pay/alipay': null,
  'pay/stripe': null,
  'pay/wechat': null,
  'sessions': 'sessions',
  'voice': 'voice',
  'voice-asr-assets': 'voice',
  'voice-hq': 'voice-hq',
  'admin/voice-hq': 'voice-hq',
  'surveys': 'survey',
};

const DEFERRED_CONTRACT_DOMAINS = new Set([
  'pay/alipay',
  'pay/stripe',
  'pay/wechat',
]);

// ── 业务 API 域（非 admin 内部的、面向客户端的接口） ─────────────────────
const BUSINESS_DOMAINS = new Set([
  'achievements', 'auth', 'billing', 'characters', 'chat',
  'events', 'if-codes', 'logs', 'me', 'me/memories', 'me/preferences',
  'pay/alipay', 'pay/stripe', 'pay/wechat', 'sessions', 'surveys',
]);

// ── 工具函数 ──────────────────────────────────────────────────────────────

function gatherFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (d, prefix = '') => {
    for (const entry of readdirSync(d)) {
      const full = join(d, entry);
      const key = prefix + entry.replace(/\.ts$/, '');
      if (entry.startsWith('_') || entry.endsWith('.test.ts')) continue;
      if (statSync(full).isDirectory()) {
        walk(full, key + '/');
      } else if (entry.endsWith('.ts')) {
        out.push({ path: full, key });
      }
    }
  };
  walk(dir);
  return out;
}

function scanInlineSchemas(filePath) {
  if (!existsSync(filePath)) return { count: 0, patterns: [] };
  const content = readFileSync(filePath, 'utf8');
  const patterns = [];
  // 匹配 zod schema 定义：export const XxxSchema = z.object/enum/union/...
  const schemaDefRe = /export\s+(?:const|let)\s+(\w*[Ss]chema)\s*=\s*z\./g;
  let m;
  while ((m = schemaDefRe.exec(content))) {
    patterns.push(m[1]);
  }
  // 匹配 inline z.object / z.enum 等调用（不限于 export）
  const inlineRe = /z\.(object|enum|union|array|record|discriminatedUnion)\(/g;
  const inlineMatches = content.match(inlineRe) || [];
  return { count: inlineMatches.length, patterns };
}

function extractSharedImports(filePath) {
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, 'utf8');
  const imports = [];
  // import { XxxSchema } from '@yelan/shared'
  const re = /import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"]@yelan\/shared['"]/g;
  let m;
  while ((m = re.exec(content))) {
    const names = m[1].split(',').map(s => s.trim()).filter(Boolean);
    // 区分 type import vs value import
    const isTypeOnly = content.slice(Math.max(0, m.index - 20), m.index).includes('import type');
    for (const name of names) {
      imports.push({ name, isTypeOnly });
    }
  }
  return imports;
}

function domainFromKey(key) {
  // 'admin/candle' → 'admin/candle', 'chat' → 'chat', 'me/memories' → 'me/memories'
  return key.replace(/\/index$/, '');
}

function contractName(domain) {
  const mapped = DOMAIN_CONTRACT_MAP[domain];
  if (mapped === '__internal__') return null;
  return mapped;
}

// ── 主流程 ────────────────────────────────────────────────────────────────

const errors = [];
const warnings = [];
const infos = [];

// 1. 收集数据
const apiFiles = gatherFiles(join(ROOT, 'apps', 'api', 'src', 'routes'));
const serverFiles = gatherFiles(join(ROOT, 'apps', 'server', 'src', 'routes'));
const contractDir = join(ROOT, 'packages', 'shared', 'src', 'contracts');
const contracts = existsSync(contractDir)
  ? readdirSync(contractDir)
      .filter(f => f.endsWith('.ts') && f !== 'index.ts' && !f.endsWith('.test.ts'))
      .map(f => f.replace(/\.ts$/, ''))
  : [];

// 2. 按域聚合（跳过纯 barrel index.ts 文件）
function isBarrelFile(fileEntry) {
  return fileEntry.path.endsWith('/index.ts') || fileEntry.path.endsWith('\\index.ts');
}

const apiDomains = new Set(
  apiFiles.filter(f => !isBarrelFile(f)).map(f => domainFromKey(f.key))
);
const serverDomains = new Set(
  serverFiles.filter(f => !isBarrelFile(f)).map(f => domainFromKey(f.key))
);
const allDomains = new Set([...apiDomains, ...serverDomains]);

// 3. 逐域分析
const domainReport = {};

for (const domain of allDomains) {
  const cName = contractName(domain);
  const hasContract = cName !== null && cName !== undefined;
  const isBusiness = BUSINESS_DOMAINS.has(domain);
  const isInternal = DOMAIN_CONTRACT_MAP[domain] === '__internal__';
  const inApi = apiDomains.has(domain);
  const inServer = serverDomains.has(domain);

  // 找到该域的路由文件
  const apiFile = apiFiles.find(f => domainFromKey(f.key) === domain);
  const serverFile = serverFiles.find(f => domainFromKey(f.key) === domain);

  const apiSchemas = apiFile ? scanInlineSchemas(apiFile.path) : { count: 0, patterns: [] };
  const serverSchemas = serverFile ? scanInlineSchemas(serverFile.path) : { count: 0, patterns: [] };
  const apiImports = apiFile ? extractSharedImports(apiFile.path) : [];
  const serverImports = serverFile ? extractSharedImports(serverFile.path) : [];

  const totalInline = apiSchemas.count + serverSchemas.count;
  const hasInlineSchemas = totalInline > 0;
  const hasSharedImports = apiImports.length > 0 || serverImports.length > 0;

  domainReport[domain] = {
    hasContract,
    cName,
    isBusiness,
    isInternal,
    inApi,
    inServer,
    inlineCount: totalInline,
    apiSchemas: apiSchemas.patterns,
    serverSchemas: serverSchemas.patterns,
    apiImports,
    serverImports,
  };

  // ── 判定规则 ──
  if (DEFERRED_CONTRACT_DOMAINS.has(domain)) {
    if (!hasContract) {
      infos.push(`${C}DEFERRED${N}: ${domain} contract intentionally deferred until real payment integration`);
    }
    continue;
  }

  if (isInternal) {
    // 运维端点：不要求契约
    if (hasInlineSchemas) {
      infos.push(`[internal] ${domain}: ${totalInline} inline zod call(s) — 运维端点，可接受`);
    }
    continue;
  }

  if (!hasContract && isBusiness && hasInlineSchemas) {
    // 业务 API 有 inline schema 但没有契约 → ERROR
    const locs = [];
    if (apiSchemas.count > 0) locs.push(`api(${apiSchemas.count})`);
    if (serverSchemas.count > 0) locs.push(`server(${serverSchemas.count})`);
    errors.push(
      `${R}MISSING CONTRACT${N}: ${B}${domain}${N} — 业务 API 有 inline zod schema (${locs.join(', ')}) 但没有 contracts/${domain.split('/').pop()}.ts`
    );
  } else if (!hasContract && isBusiness && !hasInlineSchemas) {
    // 业务 API 没有 inline schema 也没有 contract → 可能只用 types
    warnings.push(
      `${Y}NO CONTRACT${N}: ${domain} — 业务 API 无 contract 文件（当前仅 import type，建议补 response schema）`
    );
  } else if (!hasContract && !isBusiness && hasInlineSchemas) {
    // 非业务 admin 路由有 inline schema
    warnings.push(
      `${Y}ADMIN GAP${N}: ${domain} — admin 路由有 inline zod (${totalInline}) 但无独立 contract（可能可接受）`
    );
  }

  if (hasContract && !hasSharedImports && isBusiness) {
    // 有契约但路由没引用
    warnings.push(
      `${Y}UNUSED CONTRACT${N}: contracts/${cName}.ts 存在但 ${domain} 路由未 import 任何 schema（可能只用了 types）`
    );
  }

  if (hasContract && hasInlineSchemas && isBusiness) {
    // 有契约但路由仍有 inline schema
    warnings.push(
      `${Y}INLINE LEAK${N}: ${domain} 有 contracts/${cName}.ts 但仍定义 inline schema: [${[
        ...apiSchemas.patterns,
        ...serverSchemas.patterns,
      ].join(', ')}]`
    );
  }

  // mock vs server 不对称
  if (isBusiness && inApi !== inServer) {
    const only = inApi ? 'apps/api' : 'server';
    infos.push(`${C}ASYMMETRY${N}: ${domain} 仅在 ${only} 中实现`);
  }
}

// 4. 检查 contracts 是否有消费者
const consumedContracts = new Set();
for (const [, report] of Object.entries(domainReport)) {
  if (report.cName && (report.apiImports.length > 0 || report.serverImports.length > 0 || report.inApi || report.inServer)) {
    consumedContracts.add(report.cName);
  }
}

for (const c of contracts) {
  if (!consumedContracts.has(c)) {
    warnings.push(`${Y}ORPHAN CONTRACT${N}: contracts/${c}.ts 无任何路由引用`);
  }
}

// ── 输出 ──────────────────────────────────────────────────────────────────

// 5. 模式纪律检查：禁止路由层裸 Schema.parse（必须走 zValidator + validationHook）
const FORBIDDEN_PATTERNS = [
  {
    name: 'raw-zod-parse',
    glob: 'apps/api/src/routes',
    pattern: /Schema\.parse\(await c\.req\.json\(\)\)/g,
    message: '路由层禁止裸 Schema.parse(await c.req.json())，请使用 zValidator + validationHook',
  },
];

let patternErrors = 0;
for (const fp of FORBIDDEN_PATTERNS) {
  const dir = join(ROOT, fp.glob);
  if (!existsSync(dir)) continue;
  const routeFiles = gatherFiles(dir);
  for (const f of routeFiles) {
    const content = readFileSync(f.path, 'utf8');
    const matches = content.match(fp.pattern);
    if (matches) {
      for (const _m of matches) {
        patternErrors++;
        errors.push(`${R}FORBIDDEN${N}: ${f.path.replace(ROOT, '')} — ${fp.message}`);
      }
    }
  }
}

if (patternErrors > 0) {
  console.log(`\n${R}${B}🔒 模式纪律 (${patternErrors} violations)${N}`);
}

// ── 输出 ──────────────────────────────────────────────────────────────────

console.log(`\n${B}🔍 API Contracts 三向对比检查${N}\n`);

// 汇总表
console.log(`${B}Domain${' '.repeat(20)}Contract   API   Server  Inline${N}`);
console.log('─'.repeat(60));
for (const domain of [...allDomains].sort()) {
  const r = domainReport[domain];
  const cStatus = r.isInternal
    ? `${C}internal${N}`
    : DEFERRED_CONTRACT_DOMAINS.has(domain)
      ? `${C}deferred${N}`
      : r.hasContract
        ? `${G}✓${N}`
        : `${R}✗${N}`;
  const mStatus = r.inApi ? `${G}✓${N}` : ' ';
  const sStatus = r.inServer ? `${G}✓${N}` : ' ';
  const iCount = r.inlineCount > 0 ? `${Y}${r.inlineCount}${N}` : '0';
  const cNameDisplay = r.isInternal ? '(internal)' : (r.cName || '(none)');
  console.log(`  ${domain.padEnd(26)} ${cStatus.padEnd(15)} ${mStatus.padEnd(6)} ${sStatus.padEnd(7)} ${iCount}`);
}

// 详情
if (errors.length > 0) {
  console.log(`\n${R}${B}❌ ERRORS (${errors.length})${N} — 必须修复才能通过 CI`);
  for (const e of errors) console.log(`  ${e}`);
}

if (warnings.length > 0) {
  console.log(`\n${Y}${B}⚠️  WARNINGS (${warnings.length})${N}`);
  for (const w of warnings) console.log(`  ${w}`);
}

if (infos.length > 0) {
  console.log(`\n${C}${B}ℹ️  INFO (${infos.length})${N}`);
  for (const i of infos) console.log(`  ${i}`);
}

// Summary
const total = errors.length + warnings.length;
console.log(`\n${B}${'─'.repeat(60)}${N}`);
console.log(`${B}Contracts:${N} ${contracts.length}  |  ${B}API routes:${N} ${apiFiles.length}  |  ${B}Server routes:${N} ${serverFiles.length}`);
console.log(`${B}Errors:${N} ${errors.length > 0 ? R : G}${errors.length}${N}  |  ${B}Warnings:${N} ${warnings.length}  |  ${B}Info:${N} ${infos.length}`);

if (errors.length > 0) {
  console.log(`\n${R}${B}❌ CI BLOCKED${N} — ${errors.length} error(s) must be resolved.\n`);
  process.exit(1);
} else {
  console.log(`\n${G}${B}✅ CI PASSED${N} — all critical contract gaps resolved.\n`);
  process.exit(0);
}
