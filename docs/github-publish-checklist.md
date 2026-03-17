# GitHub 发布清单

这份清单适合你准备把仓库第一次公开到 GitHub 时使用。

## 一、推送前

确认下面几项：

- `README.md` 已经能让陌生用户完成本地启动
- `.env.example` 不包含任何私密信息
- `LICENSE` 已存在
- `.github/workflows/ci.yml` 已存在
- `scripts/bootstrap-local.sh` 和 `scripts/run-local.sh` 可执行
- 没有把本机路径、账号、cookie、token、日志残留提交进去

## 二、首次推送命令

如果这个目录还没有 git 仓库：

```bash
git init
git add .
git commit -m "Initial public release"
git branch -M main
git remote add origin <your-github-repo-url>
git push -u origin main
```

如果已经是 git 仓库，只是准备首次推送：

```bash
git add .
git commit -m "Prepare public release"
git push
```

## 三、仓库设置

GitHub 仓库页面建议补这些：

- Description：一句话说明它是什么
- Topics：`xiaohongshu`, `nextjs`, `fastapi`, `self-hosted`, `lead-discovery`
- Homepage：如果你后面有 demo 或文档站，再补
- Issues：开启
- Actions：开启

## 四、首个 Release

建议直接发：

- Tag：`v0.1.0`
- Title：`v0.1.0 - First public local-first release`

Release 说明建议包含：

- 本地真实抓取优先
- 默认无登录公开访问
- `xhs` 是真实抓取必需依赖
- `openclaw` 是可选增强
- 当前仍是单运行队列和共享导出目录

## 五、发出后自检

至少做一遍：

1. 用另一个目录重新 clone 仓库
2. 按 README 执行 `./scripts/bootstrap-local.sh`
3. 手动执行 `xhs login`
4. 执行 `./scripts/run-local.sh`
5. 确认首页能打开、状态正常、任务能启动

