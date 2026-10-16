/**
 * 本地跑一次，拿 Google 的 refresh token。
 *
 * 用法：
 *   1. 在 Google Cloud Console 建 OAuth 2.0 客户端（类型：Web 应用）
 *      Authorized redirect URI 填：http://localhost:3000/callback
 *   2. 建 .env：
 *        GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com
 *        GOOGLE_CLIENT_SECRET=xxx
 *   3. npm install
 *   4. npm run auth
 *   5. 浏览器里授权 → 终端会打印 GOOGLE_REFRESH_TOKEN=...
 *      把它存进 Cloudflare：npx wrangler secret put GOOGLE_REFRESH_TOKEN
 *
 * 注意：refresh token 等于长期访问凭证，别提交、别外传。
 */

import 'dotenv/config';
import http from 'http';
import open from 'open';

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3000/callback';
const SCOPES = ['https://www.googleapis.com/auth/calendar'];

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('缺少 GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET，请在 .env 里配置');
  process.exit(1);
}

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', CLIENT_ID);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', SCOPES.join(' '));
authUrl.searchParams.set('access_type', 'offline');
// prompt=consent 强制每次都发 refresh token，否则第二次授权拿不到
authUrl.searchParams.set('prompt', 'consent');

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost:3000');

  if (url.pathname !== '/callback') return;

  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h1>授权失败</h1><p>${error}</p>`);
    server.close();
    return;
  }

  if (!code) return;

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code,
        grant_type: 'authorization_code',
        redirect_uri: REDIRECT_URI,
      }),
    });

    const tokens = await tokenResponse.json();

    if (tokens.error) {
      res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<h1>换取 token 失败</h1><p>${tokens.error}: ${tokens.error_description}</p>`);
      server.close();
      return;
    }

    console.log('\n========================================');
    console.log('成功！把下面这行存进 Cloudflare：');
    console.log('npx wrangler secret put GOOGLE_REFRESH_TOKEN');
    console.log('========================================\n');
    console.log(`GOOGLE_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log('\n========================================\n');

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <html><body style="font-family: system-ui; padding: 40px; max-width: 640px; margin: 0 auto;">
        <h1 style="color: green;">完成</h1>
        <p>refresh token 已打印在终端里，复制它并设为 Cloudflare secret。</p>
        <p>可以关掉这个窗口了。</p>
      </body></html>
    `);

    setTimeout(() => server.close(), 1000);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h1>出错</h1><p>${err.message}</p>`);
    server.close();
  }
});

server.listen(3000, () => {
  console.log('正在打开浏览器授权……');
  console.log('如果没自动打开，手动访问：\n');
  console.log(authUrl.toString());
  console.log('');
  open(authUrl.toString());
});
