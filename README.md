# XHS Workbench

[![CI](https://github.com/Zetentojin/xhs-workbench/actions/workflows/ci.yml/badge.svg)](https://github.com/Zetentojin/xhs-workbench/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](https://github.com/Zetentojin/xhs-workbench/blob/main/LICENSE)
[![Release](https://img.shields.io/github/v/release/Zetentojin/xhs-workbench?display_name=tag)](https://github.com/Zetentojin/xhs-workbench/releases)

一个面向本地使用的、小红书线索工作台。

目标很直接：

`从 GitHub 下载 -> 在自己电脑上启动 -> 直接真实抓取`

这套仓库默认是公开直用版：

- 不做登录设计
- 页面打开即可使用
- 后端默认支持公开访问
- 适合本地部署、内网部署，或你自己控制的演示环境

## 这个项目包含什么

- `frontend/`: Next.js 控制台界面
- `backend/`: FastAPI 运行器，负责启动 `xhs_enrich.py` 并读取导出结果
- `scripts/bootstrap-local.sh`: 第一次启动前的依赖准备脚本
- `scripts/run-local.sh`: 本地启动前后端的一键脚本

## 最适合谁

如果你想要的是下面这种体验，这个仓库就是为这个场景准备的：

- 从 GitHub clone 或下载后，在本机直接跑
- 自己完成 `xhs login` 后做真实抓取
- 不想先接 Supabase、用户体系、邮箱登录流程
- 想先在本地验证工作流，再决定要不要做公网部署

## 第一次使用只看这里

### 1. 克隆仓库

```bash
git clone https://github.com/Zetentojin/xhs-workbench.git
cd xhs-workbench
```

### 2. 一键准备依赖

```bash
./scripts/bootstrap-local.sh
```

这个脚本会自动：

- 检查 `python3`、`npm`、`uv`
- 安装 `xhs` CLI：`uv tool install xiaohongshu-cli`
- 安装前后端依赖

### 3. 在宿主机登录 `xhs`

```bash
xhs login
xhs status
```

### 4. 启动应用

```bash
./scripts/run-local.sh
```

启动后访问：

- 前端：`http://127.0.0.1:3000`
- 后端健康检查：`http://127.0.0.1:8000/api/health`

默认配置下你可以直接：

- 刷新状态
- 运行抓取
- 查看结果
- 下载导出文件
- 按需启用 `OpenClaw` 增强模式

## 推荐启动方式

如果你的目标是“在自己电脑上直接真实抓取”，推荐优先走“宿主机本地运行”这条路径，而不是先把后端塞进 Docker。

原因是：

- `xhs login` 会读取你本机浏览器 cookies
- 真实抓取最适合直接在你的电脑上跑 `xhs`
- `OpenClaw` 现在是可选增强，不再是首次运行的硬依赖

## 当前边界

- 运行状态仍然是共享的
- 抓取任务仍然是单队列
- 导出目录仍然是共享目录
- 如果你直接暴露到公网，建议额外加一层你自己的访问控制、限流或 IP 白名单

## Docker 方式

如果你只是想快速看界面，或者自己已经准备好了额外运行环境，也可以继续用 Docker：

```bash
cp .env.example .env
mkdir -p exports
docker compose up --build
```

但要注意：

- Docker 并不会替你完成 `xhs login`
- 真实抓取更推荐走上面的宿主机本地运行方式

## 替换真实脚本

默认会挂载仓库里的 `backend/external/xhs_enrich.py`。

如果你有自己的真实脚本，改根目录 `.env`：

```bash
XHS_ENRICH_SCRIPT_HOST=/absolute/path/to/your/xhs_enrich.py
```

如果你想把导出结果写到别的地方：

```bash
XHS_ENRICH_OUTPUT_DIR_HOST=/absolute/path/to/your/exports
```

## 手动本地开发

### 后端

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

建议在 `backend/.env.local` 或 shell 环境里开启：

```bash
PUBLIC_ACCESS_ENABLED=1
```

如果 `xhs` 不在默认路径，也可以显式指定：

```bash
XHS_BIN=/absolute/path/to/xhs
```

### 前端

```bash
cd frontend
npm install
npm run dev
```

建议在 `frontend/.env.local` 或 shell 环境里开启：

```bash
NEXT_PUBLIC_PUBLIC_ACCESS=1
```

如果你本机有 `openclaw`，也可以显式指定：

```bash
OPENCLAW_BIN=/absolute/path/to/openclaw
```

## 环境变量

### 根目录 `.env`

根目录 `.env.example` 是 Docker 部署入口，核心变量：

- `PUBLIC_ACCESS_ENABLED`
- `NEXT_PUBLIC_PUBLIC_ACCESS`
- `BACKEND_URL`
- `BACKEND_CORS_ORIGINS`
- `XHS_ENRICH_SCRIPT_HOST`
- `XHS_ENRICH_OUTPUT_DIR_HOST`

### 真实抓取常用变量

- `XHS_BIN`
- `OPENCLAW_BIN`
- `XHS_ENRICH_SCRIPT`
- `XHS_ENRICH_OUTPUT_DIR`

### 分开运行时

如果你不是用 Docker，而是前后端分别启动，请看：

- `frontend/.env.example`
- `frontend/.env.production.example`
- `backend/.env.example`
- `backend/.env.production.example`

## 部署

如果你准备做公网或演示环境部署，直接看：

- `docs/deploy-public-beta.md`
- `render.yaml`
- `docker-compose.yml`

## 开源说明

- 许可证：`MIT`
- CI：GitHub Actions 会自动检查前端 `lint/build`、后端 Python 语法和脚本语法
- GitHub 发布清单：`docs/github-publish-checklist.md`
- 首个 release 草稿：`docs/release-notes-v0.1.0.md`

## 监控

你可以直接用仓库根目录的 `monitor_xhs_run.py` 观察运行进度：

```bash
python3 monitor_xhs_run.py --once
```

持续监控并写日志：

```bash
nohup python3 monitor_xhs_run.py \
  --interval 5 \
  --heartbeat 60 \
  --stall-seconds 180 \
  --log-file ./exports/xhs_monitor.log \
  >/tmp/xhs_monitor.out 2>&1 &
```

查看监控日志：

```bash
tail -f ./exports/xhs_monitor.log
```

## 研究框架

如果你想理解 founder / 投资线索筛选逻辑，先看：

- `docs/founder-discovery-framework.md`
- `docs/manual-review-checklist.md`
