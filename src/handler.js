const DEFAULT_CACHE_TTL = 300;
const USER_AGENT = 'gcal-ics-proxy/1.0';

export async function handleRequest(request, env) {
  const url = new URL(request.url);
  const pathKey = (env.PATH_KEY || '').trim();
  const source = (env.GOOGLE_ICS || '').trim();

  if (!pathKey || !source) {
    return new Response('未配置：请设置 GOOGLE_ICS 与 PATH_KEY 两个变量', { status: 500 });
  }

  // 路径不匹配一律返回 404，不暴露「这里是个日历代理」
  if (url.pathname !== `/${pathKey}`) {
    return new Response('Not Found', { status: 404 });
  }

  const parsedTtl = Number(env.CACHE_TTL);
  const cacheTtl = Number.isFinite(parsedTtl) && parsedTtl > 0 ? parsedTtl : DEFAULT_CACHE_TTL;

  let upstream;
  try {
    upstream = await fetch(source, {
      headers: { 'User-Agent': USER_AGENT },
      cf: { cacheTtl, cacheEverything: true },
    });
  } catch (err) {
    return new Response(`拉取上游失败：${err.message}`, { status: 502 });
  }

  if (!upstream.ok) {
    return new Response(`上游返回 HTTP ${upstream.status}，请检查 GOOGLE_ICS 是否仍然有效`, { status: 502 });
  }

  const body = await upstream.text();

  // 上游偶尔会返回登录页或错误页，挡掉，免得把非日历数据写进手机
  if (!body.includes('BEGIN:VCALENDAR')) {
    return new Response('上游没有返回 iCalendar 数据（地址可能已失效）', { status: 502 });
  }

  return new Response(body, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': 'inline; filename="calendar.ics"',
      'Cache-Control': `public, max-age=${cacheTtl}`,
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
