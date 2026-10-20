# 商店上架材料 · 码匣 CodeCrate

## 基本信息

- **名称**：码匣 CodeCrate
- **版本**：2.3.1
- **分类**：开发者工具
- **语言**：简体中文
- **简短描述（≤132 字符）**：29 个高频开发工具：JSON、格式转换、编解码、正则、Diff、时间戳、CSS 生成器等。零权限、纯本地。
- **详细描述**：

> 面向开发者的高频工具箱，打开即用，不做任何上传。
>
> 数据类：JSON（格式化 / 树形 / JSONPath / TypeScript / Schema）、格式转换（JSON / YAML / TOML / XML / CSV / TSV 互转）、进制与单位、文件哈希与编码。
> 编码类：Base64 / URL / HTML 实体 / Hex / Base32 / JWT、MD5 / SHA / CRC32、加密与 KDF、TOTP / HOTP。
> 文本类：正则测试、LCS Diff、文本处理、Markdown 预览、Markdown 表格。
> 时间类：时间戳多时区转换、Cron 表达式。
> 生成类：UUID、密码与随机串、二维码、Wi-Fi 二维码、SVG 占位图、CSS 渐变与阴影、Code 128 条码。
> 网络与系统：HTTP / cURL、IP / 子网、文件权限、按键码、HTTP 状态码与 MIME 速查。
>
> 特点：零权限（HTTP 工具按域名可选授权）、完全离线、深浅色主题、命令面板与键盘操作、最近使用、每个工具都有输入记忆。

- **隐私政策**：使用仓库中的 `PRIVACY.md`（需提供可公开访问的 URL）。
- **权限说明**：
  - 必选权限：无。
  - 可选权限：`<all_urls>`，仅在 HTTP / cURL 工具中按目标域名申请，可随时撤销。

## 素材清单

- 图标：`icons/icon128.png`
- 截图（1280×800，建议 5 张）：
  1. popup 工具列表与搜索
  2. JSON 工具（树形 + JSONPath）
  3. 正则测试（高亮 + 分组）
  4. CSS 生成器（渐变或阴影）
  5. HTTP / cURL 或时间戳多时区
- 小型宣传图（440×280）：可用 popup 截图裁切。

## 打包

```bash
cd code-crate
npm run package
# 产物：dist/codecrate-2.3.1.zip（manifest.json 位于根目录）
```

## 提交前检查

- [ ] `npm run verify` 全部通过
- [ ] `manifest.json` 与 `package.json` 版本号一致
- [ ] 隐私政策 URL 可访问
- [ ] 截图不含真实令牌、密钥或个人信息
