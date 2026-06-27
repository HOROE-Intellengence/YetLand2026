export const validationHook = (result: { success: boolean; error?: { issues: unknown[] } }, c: { json: (body: unknown, status: 400) => Response }) => {
  if (result.success) return;
  return c.json({ code: 'VALIDATION_ERROR', issues: result.error?.issues ?? [] }, 400);
};
