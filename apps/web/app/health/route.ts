export function GET() {
  return Response.json(
    { service: 'LumoDossier', status: 'ok' },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
