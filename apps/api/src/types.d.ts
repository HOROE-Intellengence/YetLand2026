// 模块扩充：为 hono Context 添加 userId 变量类型
// 必须先 import 一次 hono，让 TS 知道这是扩充而非覆盖
import type {} from 'hono';

declare module 'hono' {
  interface ContextVariableMap {
    userId: string;
  }
}
