export interface ConversationQuota {
  date: string;
  freeLimit: number;
  freeUsed: number;
  bonusLimit: number;
  bonusUsed: number;
  /**
   * 当前用户是否持有有效会员。会员在 consumeOneRound 里直接绕过每日额度闸门
   * （不消耗 free/bonus），所以 freeLimit+bonusLimit 这套有限计数对会员无意义——
   * UI 应据此展示「会员·不限」而非冻结的有限分母。
   */
  membership: boolean;
}
