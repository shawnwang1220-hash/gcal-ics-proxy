/**
 * 把 CalDAV 侧新增的事件，单向往 Google Calendar 推送。
 *
 * 三个关键取舍：
 *
 * 1. 只处理 `synced_at IS NULL` 的记录。已推送过的永不重推 —— 这是「只推新增，
 *    不管修改和删除」这条产品决策在数据层的落地。
 *
 * 2. 创建时带上 `iCalUID` = CalDAV 的 UID。Google 对同一日历内的 iCalUID 有唯一
 *    约束，重复创建会被挡成 409。我们把它当成功处理。这样即使 D1 回填失败，
 *    也不会在 Google 侧产生重复事件。
 *
 * 3. 推送前**不**查 Google 侧是否已存在。靠上面两点保证幂等，省掉每轮 N 次查询。
 *
 * 推送失败的事件累加 push_attempts，达到 MAX_ATTEMPTS 后不再重试，避免一条坏数据
 * 永远占着批次。
 */

import ICAL from 'ical.js';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API_BASE = 'https://www.googleapis.com/calendar/v3';
const BATCH_SIZE = 50;
const MAX_ATTEMPTS = 5;

// 同一 isolate 内复用 access token，避免每次调用都换一次
let cachedToken = null;
let cachedTokenExpiresAt = 0;

export async function pushPendingEvents(env) {
  const required = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'GOOGLE_CALENDAR_ID'];
  const missing = required.filter((key) => !env[key]);
  if (missing.length > 0) {
    console.log(`[push] 缺少配置 ${missing.join(', ')}，跳过本轮`);
    return { ok: false, reason: 'missing_env', missing };
  }

  const { results } = await env.DB.prepare(
    `SELECT id, calendar_id, uid FROM calendar_objects
     WHERE synced_at IS NULL AND push_attempts < ?
     ORDER BY created_at ASC
     LIMIT ?`
  ).bind(MAX_ATTEMPTS, BATCH_SIZE).all();

  const pending = results || [];
  if (pending.length === 0) {
    console.log('[push] 没有待推送的事件');
    return { ok: true, picked: 0, created: 0, existed: 0, failed: 0 };
  }

  console.log(`[push] 本轮待推送 ${pending.length} 条`);

  let accessToken;
  try {
    accessToken = await getAccessToken(env);
  } catch (err) {
    console.error(`[push] 换取 access token 失败：${err.message}`);
    return { ok: false, reason: 'token_error', message: err.message };
  }

  const stats = { picked: pending.length, created: 0, existed: 0, failed: 0 };

  for (const row of pending) {
    const r2Key = `${row.calendar_id}/${row.id}`;

    try {
      const object = await env.R2.get(r2Key);
      if (!object) {
        throw new Error(`R2 中找不到 ${r2Key}`);
      }

      const eventBody = parseVEvent(await object.text(), row.uid);
      if (!eventBody) {
        // 解析不出 VEVENT，直接拉到上限不再重试
        await env.DB.prepare(
          `UPDATE calendar_objects SET push_attempts = ? WHERE id = ?`
        ).bind(MAX_ATTEMPTS, row.id).run();
        console.warn(`[push] ${row.id} 无法解析出 VEVENT，已放弃`);
        stats.failed++;
        continue;
      }

      const outcome = await createGoogleEvent(accessToken, env.GOOGLE_CALENDAR_ID, eventBody);

      if (outcome.status === 'error') {
        throw new Error(outcome.message);
      }

      await env.DB.prepare(
        `UPDATE calendar_objects SET synced_at = ?, gcal_event_id = ? WHERE id = ?`
      ).bind(Math.floor(Date.now() / 1000), outcome.eventId || null, row.id).run();

      if (outcome.status === 'created') {
        stats.created++;
        console.log(`[push] 已创建：${eventBody.summary}`);
      } else {
        stats.existed++;
        console.log(`[push] 已存在（iCalUID 重复，按成功处理）：${eventBody.summary}`);
      }
    } catch (err) {
      stats.failed++;
      console.error(`[push] ${row.id} 推送失败：${err.message}`);
      await env.DB.prepare(
        `UPDATE calendar_objects SET push_attempts = push_attempts + 1 WHERE id = ?`
      ).bind(row.id).run();
    }
  }

  console.log(`[push] 本轮结束 created=${stats.created} existed=${stats.existed} failed=${stats.failed}`);
  return { ok: true, ...stats };
}

async function getAccessToken(env) {
  const now = Date.now();
  if (cachedToken && now < cachedTokenExpiresAt) {
    return cachedToken;
  }

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: 'refresh_token',
    }),
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${await response.text()}`);
  }

  const data = await response.json();
  cachedToken = data.access_token;
  cachedTokenExpiresAt = now + (data.expires_in ? (data.expires_in - 60) * 1000 : 3000 * 1000);
  return cachedToken;
}

export function parseVEvent(icsText, fallbackUid) {
  let vcalendar;
  try {
    vcalendar = new ICAL.Component(ICAL.parse(icsText));
  } catch (err) {
    console.warn(`[push] ICS 解析失败：${err.message}`);
    return null;
  }

  const vevent = vcalendar.getFirstSubcomponent('vevent');
  if (!vevent) return null;

  const event = new ICAL.Event(vevent);
  const start = event.startDate;
  const end = event.endDate;
  if (!start || !end) return null;

  const body = { summary: event.summary || '(无标题)' };

  if (event.description) body.description = event.description;
  if (event.location) body.location = event.location;

  if (start.isDate) {
    body.start = { date: start.toString().slice(0, 10) };
    body.end = { date: end.toString().slice(0, 10) };
  } else {
    body.start = { dateTime: start.toJSDate().toISOString() };
    body.end = { dateTime: end.toJSDate().toISOString() };
  }

  // 重复规则原样交给 Google
  const rrule = vevent.getFirstPropertyValue('rrule');
  if (rrule) {
    body.recurrence = [`RRULE:${rrule.toString()}`];
  }

  const uid = event.uid || fallbackUid;
  if (uid) {
    body.iCalUID = uid;
    body.extendedProperties = { private: { caldavUid: uid } };
  }

  return body;
}

async function createGoogleEvent(accessToken, calendarId, eventBody) {
  const response = await fetch(
    `${API_BASE}/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(eventBody),
    }
  );

  if (response.status === 409) {
    // iCalUID 已存在：这个事件早就在 Google 上了
    return { status: 'duplicate' };
  }

  if (!response.ok) {
    return { status: 'error', message: `${response.status} ${await response.text()}` };
  }

  const data = await response.json();
  return { status: 'created', eventId: data.id };
}
