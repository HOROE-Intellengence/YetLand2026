export const dynamic = 'force-dynamic';
export function GET() {
  if (process.env.YELAN_COMMUNITY_PROTOTYPE !== 'true') return new Response(null, { status: 404 });
  return Response.json(
    { prototype: 'yelan-community', pid: process.pid },
    {
      headers: {
        'Access-Control-Allow-Origin': process.env.NEXT_PUBLIC_YELAN_WEB_ORIGIN || 'http://localhost:3038',
        'Access-Control-Allow-Credentials': 'true',
        'Cache-Control': 'no-store',
      },
    },
  );
}
