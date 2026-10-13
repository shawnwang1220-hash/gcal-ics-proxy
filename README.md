# gcal-ics-proxy

把 Google 日历的私密 ICS 地址通过 Cloudflare 边缘代理出去，让**国内网络下的 iPhone 原生日历**能直接订阅 Google 日历。

零 OAuth、零域名成本、一条私密 ICS 地址即可用。

## 为什么需要它

iOS「设置 → 日历 → 账户 → Google」底层走 CalDAV，端点在 Google 自有域名（`*.googleapis.com` / `*.googleusercontent.com`），国内直连不通，同步必然失败。

常见的「套娃」思路——把 Google ICS 订阅到 iCloud 或 Outlook——不成立：**日历订阅是拉模式，中间层只存地址，真正下载内容的仍是最终客户端**，套一个订阅型中间层等于套了个空壳。要成立，中间层必须「帮你抓」：gcal-ics-proxy 在 Cloudflare 边缘抓取 Google 私密 ICS，再以一个国内可达的地址serve给手机。

## 工作原理

```
Google 日历 —(私密 ICS)→ Cloudflare 边缘 —→ 你的地址 —→ iPhone 原生日历
```

## 国内可用性（实测）

- **DNS 层**：用国内两个 DoH（阿里 `dns.alidns.com`、腾讯 `doh.pub`）交叉验证，`*.pages.dev` 均解析到真实 Cloudflare IP（172.66.0.0/16 段）；而 `*.workers.dev` 被投毒（阿里 DoH 返回 Facebook IP 段）。
- **真机层**：2026-10-13，国内移动网络、不挂代理访问 `abc.pages.dev`，返回 Cloudflare 官方 404 页——网络层可达，SNI 未被拦。
- 结论：**Pages 路线（`*.pages.dev`）国内可用，无需购买域名。**

> DNS 干净只是第一关，SNI 阻断是另一关，且各运营商不同。上面的真机 404 实测确认两关都过。

## 部署（Pages 路线，推荐）

需要 [wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/) 和 Cloudflare 账号，三步：

```bash
# 1. 建项目（只此一次）
wrangler pages project create gcal-ics-proxy --production-branch=main

# 2. 设密钥——必须在下一次部署之前设好
wrangler pages secret put GOOGLE_ICS --project-name=gcal-ics-proxy   # Google 日历私密 ICS 地址
wrangler pages secret put PATH_KEY --project-name=gcal-ics-proxy     # 你自己生成的一串随机口令

# 3. 部署
wrangler pages deploy . --project-name=gcal-ics-proxy --branch=main
```

| 变量 | 值 | 说明 |
|---|---|---|
| `GOOGLE_ICS` | Google 日历的私密 ICS 地址 | 等同密码，只放 Cloudflare secret |
| `PATH_KEY` | 你自己生成的一串随机口令 | 只有 `/<PATH_KEY>` 会返回日历数据 |
| `CACHE_TTL` | 秒，可选，默认 300 | 边缘缓存时长 |

> **Pages 规则：设置或修改密钥后，必须重新部署（重跑第 3 步）才生效**——部署时才会把项目配置绑定进函数。

部署完成后，你的日历地址是：

```
https://gcal-ics-proxy.pages.dev/<PATH_KEY>
```

### 一键部署（Workers 路线，仅适合境外网络）

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button.svg)](https://deploy.workers.cloudflare.com/?url=https://github.com/shawnwang1220-hash/gcal-ics-proxy)

注意：该按钮部署的是 Workers 版本，落在 `workers.dev` 域名——**国内 DNS 被投毒，不可达**。中国大陆用户请用上面的 Pages 路线。

### 如果 Pages 域名也连不上

各运营商 SNI 策略不同。若真机订阅时一直转圈，回退方案：自定义域名 + 优选 IP。本项目不绑定任何特定域名，换域只需改订阅地址。

## iPhone 订阅步骤

1. 设置 → 日历 → 账户 → 添加账户 → **其他**
2. 选择 **添加已订阅日历**
3. 粘贴 `https://gcal-ics-proxy.pages.dev/<PATH_KEY>`
4. 完成。**不要挂代理**——挂了就说明没走通边缘代理，失去意义。

## 安全设计

- **路径口令保护**：路径不匹配一律返回 404 而非 403——403 等于告诉扫描者「这里有个东西但你没权限」。
- **上游内容校验**：只接受含 `BEGIN:VCALENDAR` 的响应，防止把 Google 登录页 / 错误页写进手机日历。
- **不收录**：响应带 `X-Robots-Tag: noindex`。
- **凭证管理**：`GOOGLE_ICS` 与 `PATH_KEY` 只以 Cloudflare secret 形式存在，不进仓库、不进日志。

## Roadmap

- 国内连通性持续观测（不同运营商 / 时段）
- 自定义域名部署文档化
- 本地 Docker 备选方案（拉模式改推模式，iPhone 端为 iCloud 原生同步）

## License

MIT，见 [LICENSE](./LICENSE)。
