/**
 * Cloudflare Pages Function - 健康检查 API
 * 路径: /health
 */

export async function onRequest(context) {
  return new Response(JSON.stringify({
    status: 'ok',
    service: '科学施肥推荐系统',
    platform: 'Cloudflare Pages Functions',
    timestamp: new Date().toISOString(),
    version: '1.0.0'
  }), {
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    }
  });
}