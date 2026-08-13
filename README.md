# Sub2API Tools

Sub2API 管理后台的 **Tampermonkey 用户脚本工具集**。提供统一浮动入口（FAB「Sub2API 工具」）与可插拔工具面板；首个内置工具为 **Grok 批量额度探测**。

## 安装（推荐：从 GitHub 安装，可自动更新）

1. 浏览器安装 [Tampermonkey](https://www.tampermonkey.net/)。
2. 打开安装地址（油猴会弹出安装确认）：

   **https://raw.githubusercontent.com/jeck5001/sub2api-tools/main/dist/sub2api-tools.user.js**

   或在油猴仪表盘 → **实用工具** → **从 URL 安装**，粘贴同一链接。
3. 打开任意 Sub2API 后台 `/admin/*` 页面；右下角出现 **Sub2API 工具**。  
   - 快捷键：`Alt+Q` 打开/关闭外壳  
   - 在 `/admin/accounts` 页可额外看到工具栏按钮：「批量额度探测」「读取本页 forbidden」「删除本页错误」「删除本页停用」

### 自动更新

脚本头已配置：

| 字段 | 地址 |
|------|------|
| `@updateURL` / `@downloadURL` | `https://raw.githubusercontent.com/jeck5001/sub2api-tools/main/dist/sub2api-tools.user.js` |

Tampermonkey 会按设置定期对比远程 `@version`，有新版本时提示或自动更新。

**油猴侧建议：**

1. 打开油猴仪表盘 → 点脚本 **Sub2API Tools** → 设置  
2. 确认 **检查更新** 已开启（或全局设置里允许检查更新）  
3. 手动检查：脚本列表里对该脚本点「检查更新 / 强制更新」

**开发者发版时**（改代码后让别人自动升到新版本）：

1. 改 `src/meta.header.js` 的 `@version`（以及 `package.json` / `bootstrap.js` 的 version）  
2. `./build.sh`（把新版本写进 `dist/`）  
3. `git commit` + `git push origin main`  
4. 用户端下次检查更新即可拉到新 `@version`

> 若你是本地文件粘贴安装的旧副本、且没有 `@updateURL`，请用上面的 raw 链接**重装一次**，之后才会自动更新。

### 本地开发安装

```bash
./build.sh   # 或 npm run build
```

再把 `dist/sub2api-tools.user.js` 粘贴进油猴，或从文件安装。开发机也可用 raw 链接安装生产构建。

### 从旧版迁移

| 项目 | 说明 |
|------|------|
| 旧脚本 | `legacy/sub2api-grok-batch-quota.user.js`（归档参考，**请勿与新脚本同时启用**） |
| 卸载 | 在 TM 中禁用/删除「Sub2API Grok 批量额度探测」 |
| 配置 | 新存储键 `s2a.cfg.grok-quota`；若无则自动读取旧键 `s2a_grok_quota_cfg` 并迁移 |
| 匹配 | 已去掉硬编码 `192.168.5.35`，使用 `*://*/admin/*` |

## 开发

```text
src/
  meta.header.js          # UserScript 头（版本在此与 package.json 同步）
  bootstrap.js            # IIFE 开头 + window.__S2A__ / S2A
  core/
    util.js storage.js auth.js api.js
    dom-accounts.js registry.js ui-shell.js
  tools/
    grok-quota/           # 示例工具
      index.js panel.js probe.js export.js
    register-all.js       # 集中注册列表
  main.js                 # boot + IIFE 结尾
dist/sub2api-tools.user.js
legacy/                   # 旧单体脚本归档
```

开发循环：

1. 修改 `src/**`
2. `./build.sh`
3. 在 Tampermonkey 中刷新脚本 / 重装 `dist/sub2api-tools.user.js`，刷新后台页

构建策略：**简单 concat**（无 bundler）。顺序见 `build.sh`。运行时无 ESM；模块共享 IIFE 内的 `S2A` 命名空间。

版本号：改 `src/meta.header.js` 的 `@version` 与 `package.json` 的 `version`，并同步 `bootstrap.js` 中的 `S2A.version`（可选）。

## 如何添加新工具

1. 复制目录：`src/tools/grok-quota` → `src/tools/your-tool`
2. 在 `index.js` 里调用：

   ```js
   S2A.registerTool({
     id: 'your-tool',              // kebab-case，配置键 s2a.cfg.your-tool
     name: '显示名称',
     description: '一句话说明',
     order: 20,
     match: (ctx) => /\/admin\/accounts\b/.test(ctx.pathname), // 可选
     barActions: (ctx) => [        // 可选，账号页工具栏
       { id: 'open', label: '打开', onClick: () => S2A.openTool('your-tool') },
     ],
     onInit(ctx) {},
     onOpen(ctx, hostEl) {
       // 把 UI 挂到 hostEl；可 return dispose 函数
       hostEl.innerHTML = '...';
       return () => { /* 清理定时器/中止请求 */ };
     },
     onClose(ctx) {},
     onRouteChange(ctx) {},
   });
   ```

3. 在 `src/tools/register-all.js` 增加一行注册调用。
4. 在 `build.sh` 的 `FILES` 数组中按顺序加入新文件（export/probe/panel 在 index 之前）。
5. `./build.sh`，刷新 TM。

`ctx` 提供：`pathname`, `origin`, `api`, `auth`, `storage`, `dom`（账号 DOM 助手）, `util`, `shell`。

## 内置工具

### Grok 批量额度探测

功能与旧单体脚本一致：

- 读取勾选 / 本页 / 本页 forbidden / API 全量 ID
- 并发探测 `/admin/grok/accounts/{id}/quota`
- 403 / upstream 失败分类；可选自动删除账号
- CSV 导出、复制摘要、配置持久化
- 账号页工具栏注入

### 批量删除错误账号

- 扫描账号表「状态」列粉红标签 **错误**（`collectByStatusFromDom`）
- 读取勾选 / 本页 / 本页错误 / API 拉取错误（`status=error` + 客户端二次过滤）
- 并发 `DELETE /admin/accounts/{id}`，默认删除前确认
- 账号页工具栏：**删除本页错误**

### 批量删除停用账号

- 扫描账号表「状态」列标签 **停用**（兼容 `disabled` / `inactive`）
- 读取勾选 / 本页 / 本页停用 / API 拉取全部停用账号
- 并发 `DELETE /admin/accounts/{id}`（默认并发 20、间隔 0ms，可在面板调整），默认删除前确认，可停止、导出 CSV 和复制结果摘要
- 账号页工具栏：**删除本页停用**

## 许可

[MIT](./LICENSE) © 2026 jeck5001

可自由使用、修改、分发；软件按「原样」提供，不作担保。删除账号等操作请自行承担风险。
