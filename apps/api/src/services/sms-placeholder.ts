// SMS credentials/signature/template are reserved in env examples. No live sends until carrier provisioning and real verification are ready.
// Legacy mock OTP remains accessible only to isolated unit tests, never a local/public server.
export function mockOtpForTestsOnly(): boolean {
  return process.env.NODE_ENV === 'test' && process.env.VITEST === 'true';
}
export const SMS_UNAVAILABLE_MESSAGE = '短信验证暂未开放，请使用邮箱和密码登录';
