// Reserved integration boundary. Intentionally performs no debit, reservation,
// usage accounting or modification to Yelan's existing chat billing.
export async function phoneBilling(_input: { userId: string; sourceApp: string; requestId: string }) {
  return { implemented: false as const, charged: false as const };
}
