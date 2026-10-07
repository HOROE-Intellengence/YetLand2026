export const dynamic = 'force-dynamic';
export function GET() {
  return Response.json({ app: 'yelan-phone', managed: process.env.YELAN_PHONE_MANAGED === 'true' },
    { headers: { 'Cache-Control': 'no-store' } });
}
