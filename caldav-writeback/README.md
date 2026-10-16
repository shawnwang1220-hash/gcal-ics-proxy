# gcal-caldav-writeback

在 Cloudflare Workers 上自建一个 CalDAV 服务器，**iPhone 上新建的日程会单向往 Google Calendar 推送**。

零服务器、零成本。CalDAV 服务端基于 [CF-Workers-CalDAV](https://github.com/onlca/CF-Workers-CalDAV)（MIT，Copyright (c) 2025 onlca）改造。

> 这是 [gcal-bridge](../README.md) 的**可写**那一半 —— 负责把你在 iPhone 上**新建**的日程写回 Google。
> 另一半（在手机上**看到** Google 已有日程）在 [`../ics-proxy`](../ics-proxy)。
> 两者互补，都需要部署。

---

## 它补的是哪一块

[`../ics-proxy`](../ics-proxy) 解决了「iPhone 上看得到 Google 日程」—— 用 Cloudflare 反代私密 ICS，手机订阅。但那条路是**只读**的：ICS 订阅协议本身就写不回去，这不是加功能能解决的。

要让 iPhone 上新建的日程进 Google，手机那边必须有一个**可写的 CalDAV 账户**。而 Google 自己的 CalDAV 端点（`*.googleapis.com` / `*.googleusercontent.com`）国内连不上。

于是自建一个：

```
iPhone 日历 ──CalDAV（可读可写）──> Cloudflare Workers（本项目的 CalDAV 服务端）
                                        │  D1 存元数据 · R2 存 ICS 文件
                                        │
                                        └── Cron 每 5 分钟 ──> Google Calendar API
```

两个项目配合使用的效果：

| 手机上的日历 | 来源 | 用途 |
|---|---|---|
| 订阅日历 | gcal-ics-proxy | **看** Google 上的日程（只读） |
| CalDAV 日历 | 本项目 | **建**新日程，自动进 Google |

> 建议把 iOS 的「默认日历」设成 CalDAV 那个，新建日程就不会点错。

## 能力边界（先看清楚再部署）

**做**：iPhone 上**新建**的事件，进到 Google 指定的那本日历。

**不做**：

- **不回读 Google**。这个 CalDAV 日历不拉取 Google 已有事件，它是空的起点。想看 Google 日程请继续用订阅日历。
- **不同步修改和删除**。在 iPhone 上改了或删了已推送的事件，Google 那边不会跟着变。
- **不处理冲突**。因为只单向推新增，没有冲突可言 —— 这也正是这条路比双向同步简单得多、且不容易出事的原因。

## 部署

### 前置

- Cloudflare 账号（免费版够用）
- **Node.js ≥ 20**（wrangler 4 的要求）
- 一个 Google 账号

### 1. 建 Cloudflare 资源

```bash
cd caldav-writeback   # 本仓库的子目录；尚未克隆的话见根目录 README
npm install
cp wrangler.toml.example wrangler.toml

npx wrangler login

# D1：把输出的 database_id 填进 wrangler.toml
npx wrangler d1 create caldav_db

# KV：把输出的 id 填进 wrangler.toml
npx wrangler kv namespace create CALDAV_KV

# R2
npx wrangler r2 bucket create caldav-calendars
```

### 2. 初始化数据库表

```bash
npx wrangler d1 execute caldav_db --file=src/schema.sql --remote
```

> `--remote` 不能省。wrangler 4 默认作用于**本地**数据库，不加这个参数你会初始化一个本地的空库，线上还是没表。

同时记得把 `wrangler.toml` 里的 `[vars]` 改掉：

- `USERNAME` / `PASSWORD` —— iPhone 添加账户时用的登录凭据，**别用默认的 `changeme`**
- `BASE_URL` —— 部署后会打印，回填即可

### 3. 拿 Google refresh token

```bash
# 先把 OAuth 客户端信息写进 .env
echo "GOOGLE_CLIENT_ID=xxx.apps.googleusercontent.com" > .env
echo "GOOGLE_CLIENT_SECRET=xxx" >> .env

npm run auth
```

`npm run auth` 会打开浏览器让你授权，然后把 `GOOGLE_REFRESH_TOKEN=` 打印在终端里。

在 Google Cloud Console 那边需要：

1. 建一个项目，启用 **Google Calendar API**
2. 建 **OAuth 2.0 客户端 ID**，类型选「Web 应用」
3. Authorized redirect URI 填 `http://localhost:3000/callback`
4. OAuth 同意屏幕把自己加进测试用户

### 4. 设置 secret

```bash
npx wrangler secret put GOOGLE_CLIENT_ID
npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler secret put GOOGLE_REFRESH_TOKEN
npx wrangler secret put GOOGLE_CALENDAR_ID   # 目标日历 ID；推到主日历就填 primary
npx wrangler secret put PUSH_TOKEN           # 手动调 /push 的口令，自己生成一串随机字符
```

> 想推到 Google 上某一本特定的日历而不是主日历，就在 Google 日历设置里找到那本日历的 **Calendar ID**（形如 `xxx@group.calendar.google.com`），填给 `GOOGLE_CALENDAR_ID`。

### 5. 部署

```bash
npx wrangler deploy
```

记下输出的 Worker 地址，回填到 `wrangler.toml` 的 `BASE_URL` 再部署一次。

### 6. iPhone 添加 CalDAV 账户

设置 → 日历 → 账户 → 添加账户 → **其他** → **添加 CalDAV 账户**：

- 服务器：你的 Worker 地址（不带 `https://`）
- 用户名 / 密码：`wrangler.toml` 里的 `USERNAME` / `PASSWORD`

> `.workers.dev` 域名在国内 DNS 被投毒（实测解析到 Facebook 的 IP 段），**必须绑自定义域名**。这一点和 gcal-ics-proxy 不同 —— 那边走 Pages 的 `*.pages.dev` 是干净的，这边 Workers 没有这个便利。
>
> 绑域名：Worker → Settings → Domains & Routes → Add → Custom Domain。

## 验证

手动跑一次推送：

```bash
curl "https://你的地址/push?token=<PUSH_TOKEN>"
```

返回 JSON，形如：

```json
{ "ok": true, "picked": 1, "created": 1, "existed": 0, "failed": 0 }
```

然后在 iPhone 上新建一个日程，等几分钟（或直接调一次 `/push`），去 Google 日历看有没有出现。

看实时日志：

```bash
npx wrangler tail
```

## 工作原理（推送这一段）

推送逻辑在 `src/gcal-push.js`，三个设计取舍：

1. **只处理 `synced_at IS NULL` 的记录**。推过的永不重推 —— 这是「只推新增」在数据层的落地。`calendar_objects` 表因此多了三列：`synced_at`、`gcal_event_id`、`push_attempts`。
2. **创建时带 `iCalUID` = CalDAV 的 UID**。Google 对同一日历内的 `iCalUID` 有唯一约束，重复创建会被挡成 409，我们把它当成功处理。这样即使 D1 回填失败，也不会在 Google 侧产生重复事件。
3. **推送前不查询 Google 侧是否已存在**。靠上一条保证幂等，省掉每轮 N 次查询。

失败的事件累加 `push_attempts`，到 5 次后不再重试，避免一条坏数据永远占着批次。

## 已知限制

- 单向：只推新增，不管修改和删除。
- 延迟：Cron 默认每 5 分钟一轮，所以手机新建的日程最多 5 分钟后才进 Google。想更快就把 `[triggers]` 改成 `* * * * *`。
- 单用户：原项目的设计，一个用户名密码，多设备共用。
- 免费额度：Workers 每天 10 万次请求（Cron 触发也计入）；D1 5GB；R2 10GB；KV 每天 10 万读。
- iOS 侧：CalDAV 账户的同步由系统调度，没有「立即同步」按钮，下拉日历列表可以触发。

## 相比原项目改了什么

在 CF-Workers-CalDAV 基础上：

- `src/schema.sql`：`calendar_objects` 加三列（`synced_at` / `gcal_event_id` / `push_attempts`）
- `src/gcal-push.js`：**新增**，推送模块
- `src/index.js`：加 `scheduled()` Cron 入口，加 `/push` 手动触发端点
- `wrangler.toml.example`：加 Cron 触发器和 Google 凭据说明
- `scripts/google-auth.js`：**新增**，本地换 refresh token 的工具

CalDAV 协议实现（`caldav-handler.js`、`auth.js`）**一行没改** —— 改动全部在数据层和调度层。

> 如果你已经部署过原项目，升级时只需要给已有表加列：
>
> ```sql
> ALTER TABLE calendar_objects ADD COLUMN synced_at INTEGER;
> ALTER TABLE calendar_objects ADD COLUMN gcal_event_id TEXT;
> ALTER TABLE calendar_objects ADD COLUMN push_attempts INTEGER NOT NULL DEFAULT 0;
> ```

## License

MIT。CalDAV 服务端部分来自 [CF-Workers-CalDAV](https://github.com/onlca/CF-Workers-CalDAV)（Copyright (c) 2025 onlca）；Google 推送逻辑、数据层改动与本文档归本项目作者。
