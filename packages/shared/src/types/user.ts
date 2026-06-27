import type { Boundary } from '../enums/boundary';

export interface Me {
  id: string;
  name?: string;
  // phone optional —— email-only 注册用户可以没有手机号
  phone?: string;
  ageVerified: boolean;
  narrativeBoundary: Boundary;
  ifUnlocked: boolean;
  createdAt: string;
  // —— 账户档案扩展（feat/user-account）——
  // 全部 optional，旧客户端/旧数据零迁移
  email?: string;
  nickname?: string;
  avatarUrl?: string;
  bio?: string;
  // —— 账户安全状态指示位（不回密码字段本身）——
  hasPassword?: boolean;
  passwordUpdatedAt?: string;
  phoneVerifiedAt?: string;
}
