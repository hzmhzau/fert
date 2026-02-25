# 部署指南

## 项目分析

当前项目是一个 Node.js/Express 应用，包含：
- Express 后端服务器
- GeoTIFF 文件读取（需要文件系统访问）
- SQLite 数据库
- 静态文件服务

---

## 🚀 推荐方案：Render 免费部署

Render 提供完全免费的 Node.js 托管服务，最适合本项目。

### Render 部署步骤

#### 方法一：通过 GitHub 自动部署（推荐）

1. **推送代码到 GitHub**
   ```bash
   git init
   git add .
   git commit -m "Initial commit"
   git branch -M main
   git remote add origin https://github.com/你的用户名/你的仓库.git
   git push -u origin main
   ```

2. **注册 Render 账号**
   - 访问 https://render.com
   - 使用 GitHub 账号登录

3. **创建 Web Service**
   - 点击 "New" → "Web Service"
   - 连接 GitHub 仓库
   - 选择 `fertilizer-recommendation` 项目

4. **配置部署**
   - Name: `fertilizer-recommendation`
   - Environment: `Node`
   - Build Command: `npm install`
   - Start Command: `node server.js`
   - Plan: `Free`

5. **点击 "Create Web Service"**

6. **等待部署完成**（首次约 2-3 分钟）

7. **访问应用**
   - 部署成功后会获得一个 URL，如：`https://fertilizer-recommendation.onrender.com`

#### 方法二：使用 render.yaml Blueprint

项目已包含 `render.yaml` 配置文件，可以直接使用：

1. 在 Render Dashboard 点击 "New" → "Blueprint"
2. 连接 GitHub 仓库
3. Render 会自动识别配置并部署

### 注意事项

⚠️ **免费套餐限制**：
- 15分钟无请求会休眠
- 首次访问需等待 30-60 秒唤醒
- 每月 750 小时运行时间
- 无持久存储（重启后 SQLite 数据丢失）

---

## Cloudflare 部署方案

### 方案一：Cloudflare Pages + Workers（推荐）

将前端部署到 Cloudflare Pages，后端 API 部署到 Cloudflare Workers。

#### 步骤 1：创建 Workers 后端

需要将 Express 改造为 Workers 兼容格式。创建以下文件：

```javascript
// worker.js - Cloudflare Workers 入口
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { serveStatic } from 'hono/cloudflare-workers';

const app = new Hono();

// CORS 配置
app.use('/*', cors());

// API 路由
app.get('/health', (c) => {
  return c.json({ status: 'healthy', service: 'fertilizer-recommendation' });
});

// ... 其他 API 路由

export default app;
```

#### 步骤 2：创建 wrangler.toml 配置

```toml
name = "fertilizer-recommendation"
main = "worker.js"
compatibility_date = "2024-01-01"

[site]
bucket = "./static"

[[r2_buckets]]
binding = "GEOTIFF_BUCKET"
bucket_name = "geotiff-files"

[[d1_databases]]
binding = "DB"
database_name = "fertilizer-db"
database_id = "your-database-id"
```

#### 步骤 3：上传 GeoTIFF 文件到 R2

```bash
# 安装 Wrangler CLI
npm install -g wrangler

# 登录 Cloudflare
wrangler login

# 创建 R2 存储桶
wrangler r2 bucket create geotiff-files

# 上传 GeoTIFF 文件
wrangler r2 object put geotiff-files/GTiff/AN_5-15cm_1km_clip.tif --file ./GTiff/AN_5-15cm_1km_clip.tif
wrangler r2 object put geotiff-files/GTiff/AP_5-15cm_1km_clip.tif --file ./GTiff/AP_5-15cm_1km_clip.tif
wrangler r2 object put geotiff-files/GTiff/AK_5-15cm_1km_clip.tif --file ./GTiff/AK_5-15cm_1km_clip.tif
```

#### 步骤 4：创建 D1 数据库

```bash
# 创建数据库
wrangler d1 create fertilizer-db

# 执行 SQL 初始化（需要先导出 SQLite 结构）
wrangler d1 execute fertilizer-db --file=./schema.sql
```

---

### 方案二：仅部署前端到 Cloudflare Pages

如果后端部署到其他平台（如 Railway、Render），可以只将前端部署到 Cloudflare Pages。

#### 步骤 1：创建项目结构

```
├── dist/           # 前端构建输出
├── static/         # 静态资源
├── index.html
└── ...
```

#### 步骤 2：通过 Git 部署

1. 将代码推送到 GitHub/GitLab
2. 登录 Cloudflare Dashboard
3. 进入 Pages > 创建项目
4. 连接 Git 仓库
5. 配置构建设置：
   - 构建命令：`npm run build`（如果有的话）
   - 输出目录：`/` 或 `dist`

#### 步骤 3：配置环境变量

在 Pages 设置中添加：
- `API_URL`: 后端 API 地址

---

### 方案三：使用 Cloudflare Workers 的 Node.js 兼容模式（实验性）

Cloudflare Workers 现在支持有限的 Node.js 兼容性。

#### 创建 wrangler.toml

```toml
name = "fertilizer-api"
main = "server.js"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]

[vars]
PORT = "8080"
```

**注意**：此方案有限制，GeoTIFF 和 SQLite 可能无法正常工作。

---

## 推荐部署流程

考虑到项目使用了文件系统和 SQLite，**推荐使用混合部署**：

1. **前端** → Cloudflare Pages
2. **后端** → Railway / Render / Fly.io（支持完整 Node.js 环境）

### 具体步骤：

#### 1. 修改前端 API 地址配置

在 `static/js/app.js` 中添加环境变量支持：

```javascript
const API_BASE_URL = window.location.hostname === 'localhost' 
  ? 'http://localhost:5000'
  : 'https://your-backend-url.railway.app';
```

#### 2. 部署后端到 Railway

```bash
# 安装 Railway CLI
npm install -g @railway/cli

# 登录
railway login

# 初始化项目
railway init

# 部署
railway up
```

#### 3. 部署前端到 Cloudflare Pages

```bash
# 使用 Wrangler 部署
wrangler pages deploy . --project-name=fertilizer-frontend
```

---

## 快速开始：完整部署脚本

运行以下命令开始部署：

```bash
# 1. 安装依赖
npm install

# 2. 安装 Wrangler
npm install -g wrangler

# 3. 登录 Cloudflare
wrangler login

# 4. 部署前端到 Pages
wrangler pages deploy . --project-name=fertilizer-system
```

---

## 注意事项

1. **GeoTIFF 文件**：Cloudflare Workers 不支持直接读取文件系统，需要使用 R2 存储
2. **SQLite 数据库**：需要迁移到 Cloudflare D1 或使用外部数据库
3. **环境变量**：敏感信息（如 API 密钥）应使用 Cloudflare 的 Secrets 管理
4. **CORS**：如果前后端分离部署，需要配置 CORS

## 相关链接

- [Cloudflare Pages 文档](https://developers.cloudflare.com/pages/)
- [Cloudflare Workers 文档](https://developers.cloudflare.com/workers/)
- [Cloudflare R2 存储](https://developers.cloudflare.com/r2/)
- [Cloudflare D1 数据库](https://developers.cloudflare.com/d1/)
