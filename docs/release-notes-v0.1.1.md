# v0.1.1

修复公开版在新版 `xiaohongshu-cli` 上“搜索成功但结果为 0”的兼容性问题。

## Highlights

- 兼容新版 `xiaohongshu-cli` 的结构化输出 envelope：`ok / schema_version / data / error`
- 兼容新版搜索结果结构，不再依赖旧的 `model_type == "note"` 过滤假设
- 搜索日志新增 `raw_items` 和 `usable_items`，更容易定位是 CLI 没返回还是本地解析跳过
- `bootstrap-local.sh` 现在会主动升级 `xiaohongshu-cli` 到最新版，而不是只在未安装时才安装
- 首次登录引导补充了 `xhs login --qrcode` 备用方案

## Why This Release Matters

此前 `v0.1.0` 在部分机器上会出现：

- 搜索过程没有报错
- 每个关键词日志都是 `added=0 total=0`
- 最终导出 `0` 条结果

根因是上游 `xiaohongshu-cli` 已升级到新的输出协议和结果结构，而旧版 workbench 仍按早期结构解析。

## Recommended Upgrade

```bash
git pull origin main
./scripts/bootstrap-local.sh
xhs login
./scripts/run-local.sh
```

如果浏览器 Cookie 提取失败，可改用：

```bash
xhs login --qrcode
```

## Notes

- 真实抓取仍然依赖宿主机上的 `xhs` 登录态
- `OpenClaw` 仍然是可选增强，不影响首次可用性
- 如果你是从旧的 GitHub Release zip 安装，请改用最新 `main` 或升级到本次 release
