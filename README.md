# gcal-bridge

让国内网络下的 **iPhone 自带「日历」**，既能**看到** Google 上的日程，也能把**新建**的日程**写回** Google。

不需要任何第三方 App。两个子项目都跑在 Cloudflare 上，零服务器、零成本。

## 两个子项目，解决两件不同的事

| 子项目 | 方向 | 跑在 | iPhone 上表现为 |
|---|---|---|---|
| [`ics-proxy`](./ics-proxy) | Google → iPhone | Cloudflare **Pages** | 一本**只读订阅日历** |
| [`caldav-writeback`](./caldav-writeback) | iPhone → Google | Cloudflare **Workers** + D1 + R2 | 一个**可写 CalDAV 账户** |

**为什么是两个而不是一个**：iOS 的日历订阅（ICS / webcal）协议**本身是只读的**，写不回去 —— 这不是加个功能能解决的。所以「看」和「写」必须走两条不同的协议：看用 ICS 订阅，写用 CalDAV。两者**互补**，都要部署，谁也不替代谁。

## 装完之后，iPhone 自带日历里是这样

```
iPhone 自带「日历」App
├── iCloud               你原本的日历，不受影响
├── Google（订阅）        只读 · 来自 ics-proxy · 看 Google 上已有的会
└── CalDAV               可写 · 来自 caldav-writeback · 新建日程选它
```

建议把「设置 → 日历 → 默认日历」设为那本 CalDAV，之后新建的日程会自动落进去并推回 Google。注意这只影响**以后新建**的事件，不会移动已有事件。

## 部署顺序

1. **先装 `ics-proxy`** → 见 [子项目文档](./ics-proxy)。十分钟，装完就能在手机上看到 Google 日程。
2. **再装 `caldav-writeback`** → 见 [子项目文档](./caldav-writeback)。配置稍多：要建 D1 / R2、拿 Google OAuth refresh token。
3. **最后在 iPhone 上**：设置 → 日历 → 默认日历 → 选 CalDAV。

## 共同的技术背景

两个子项目面对的是同一个根因，重复写两遍没必要，放这里：

- iOS 添加 Google 账户走的是 **CalDAV**，端点在 `*.googleapis.com` / `*.googleusercontent.com`，国内直连不通，所以**原生路径是死的**。
- Cloudflare 两个免费域名在国内的待遇完全不同（实测）：

  - `*.workers.dev` —— 阿里 DNS 解析到 `31.13.85.53`，**Facebook 的 IP 段，被投毒**，不可用
  - `*.pages.dev` —— 阿里和腾讯两个国内 DoH 都返回真实 Cloudflare IP，**干净可用**

- 所以 `ics-proxy` 能走 Pages 白嫖一个国内可达的域名；`caldav-writeback` 只能跑 Workers，**必须自己绑自定义域名**。

## 目录

```
.
├── ics-proxy/             Google → iPhone（只读订阅）
│   ├── functions/         Pages Functions 入口
│   ├── src/handler.js     核心逻辑（与 Workers 入口共用）
│   ├── worker.js          Workers 入口
│   ├── public/            Pages 静态输出目录（空）
│   └── README.md          部署文档
└── caldav-writeback/      iPhone → Google（新增回传）
    ├── src/               CalDAV 服务端 + Google 推送模块
    ├── scripts/           本地换 Google refresh token 的工具
    └── README.md          部署文档
```

## License

MIT，详见 [LICENSE](./LICENSE)。

其中 `caldav-writeback` 的 CalDAV 服务端实现来自 [CF-Workers-CalDAV](https://github.com/onlca/CF-Workers-CalDAV)（Copyright (c) 2025 onlca，同样是 MIT）。
