# v0.1.0

首个公开发布版本，目标是让用户从 GitHub 下载后，在自己本地运行真实抓取流程。

## Highlights

- 默认无登录访问，打开工作台即可使用
- 支持宿主机本地真实抓取
- 新增 `./scripts/bootstrap-local.sh` 用于准备依赖
- 新增 `./scripts/run-local.sh` 用于启动前后端
- 后端会自动检测 `xhs` 是否安装、是否已登录
- `OpenClaw` 现在是可选增强，不再是首次运行的硬依赖
- 新增 MIT License 和 GitHub Actions CI

## Current Limits

- 运行状态仍然是共享的
- 抓取任务仍然是单队列
- 导出目录仍然是共享目录
- 真实抓取依赖用户本机完成 `xhs login`

## Recommended First-Time Flow

```bash
./scripts/bootstrap-local.sh
xhs login
./scripts/run-local.sh
```
