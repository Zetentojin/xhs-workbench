# XHS Workbench 公开直用版部署清单

这份清单按“前端 + 后端，无登录”的公开直用版本来写。

## 目标架构

- 前端：Vercel 或任意可跑 Next.js 的平台
- 后端：Render / Fly.io / Railway / 自托管主机
- 访问方式：直接访问，不做登录
- 导出文件：持久化磁盘、本地卷或对象存储挂载

## 一、部署前先确认

上线前先确认 4 件事：

1. `backend/external/xhs_enrich.py` 已替换成真实脚本，或你已经准备好 `XHS_ENRICH_SCRIPT`
2. 已准备导出目录或持久化磁盘
3. 已准备前后端域名
4. 你接受这版是“公开接口可直接调用”的模式

如果你不希望所有人都能直接调用抓取接口，建议先在网关层做：

- IP 白名单
- Basic Auth
- Cloudflare Access
- Nginx / Caddy 限流

## 二、前端部署

### 1. 导入仓库

在 Vercel 或其他平台导入仓库。

### 2. Root Directory

设为：

`frontend`

### 3. 环境变量

按 `frontend/.env.production.example` 配：

- `NEXT_PUBLIC_PUBLIC_ACCESS=1`
- `BACKEND_URL=https://api.your-domain.com`

### 4. 域名

建议：

- `https://app.your-domain.com`

## 三、后端部署

### 1. Render Blueprint 或 Web Service

仓库里已经有 `render.yaml`。

### 2. 环境变量

按 `backend/.env.production.example` 配：

- `PUBLIC_ACCESS_ENABLED=1`
- `XHS_ENRICH_SCRIPT`
- `XHS_ENRICH_OUTPUT_DIR`
- `BACKEND_CORS_ORIGINS`

### 3. 持久化目录

导出目录建议挂到持久化磁盘，例如：

- `/opt/render/project/src/backend/exports`

### 4. 域名

建议：

- `https://api.your-domain.com`

## 四、联调顺序

建议按这个顺序：

1. 先部署后端，并确认 `/api/health` 正常
2. 确认脚本路径和导出目录都可写
3. 再部署前端，并填好 `BACKEND_URL`
4. 回前端验证状态、运行、结果、导出 4 条链路

## 五、上线后的第一轮检查

至少检查：

1. 首页能正常打开
2. 点击“刷新状态”能返回后端运行信息
3. 点击“重新抓取”能成功启动任务
4. 结果列表能正常显示
5. 导出文件能下载
6. 浏览器跨域没有报错

## 六、当前版本的限制

这版适合公开演示或轻量部署，但还不是完整多用户 SaaS：

- 后端运行状态是共享的
- 抓取任务是单队列锁
- 导出文件是共享目录
- 没有内建权限隔离

所以更稳的使用方式是：

- 你自己部署
- 你自己掌握入口
- 把它当公开工具台，而不是多租户产品

## 七、下一步最值得做的事

如果你准备继续把它做成更成熟的发布版，我建议下一步做这 3 件事：

1. `run quotas`
   给运行任务加频率限制和并发保护

2. `saved leads`
   支持保存和二次筛选高质量线索

3. `workspace isolation`
   把运行记录和导出结果按空间隔离
