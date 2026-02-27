# GitHub 部署指南

本文档详细介绍如何将科学施肥推荐系统发布到 GitHub，并通过多种平台进行部署。

---

## 📋 目录

1. [发布到 GitHub](#发布到-github)
2. [部署方案选择](#部署方案选择)
3. [方案一：GitHub Pages（仅静态前端）](#方案一github-pages仅静态前端)
4. [方案二：Vercel 部署](#方案二vercel-部署)
5. [方案三：Render 部署](#方案三render-部署)
6. [方案四：Railway 部署](#方案四railway-部署)
7. [方案五：Cloudflare Workers 部署](#方案五cloudflare-workers-部署)
8. [环境变量配置](#环境变量配置)

---

## 发布到 GitHub

### 步骤 1：初始化 Git 仓库

```bash
# 进入项目目录
cd your-project-folder

# 初始化 Git 仓库
git init

# 添加所有文件（.gitignore 会排除敏感文件）
git add .

# 提交
git commit -m "Initial commit: 科学施肥推荐系统"
```

### 步骤 2：创建 GitHub 仓库

1. 访问 [GitHub](https://github.com) 并登录
2. 点击右上角 **+** → **New repository**
3. 填写仓库信息：
   - Repository name: `fertilizer-recommendation-system`
   - Description: `基于GIS和土壤养分数据库的智能施肥推荐系统`
   - 选择 **Public**（公开）或 **Private**（私有）
   - ❌ **不要**勾选 "Add a README file"（已有 README）
   - ❌ **不要**添加 .gitignore（已创建）

4. 点击 **Create repository**

### 步骤 3：推送代码到 GitHub

```bash
# 添加远程仓库（替换 YOUR_USERNAME 为你的 GitHub 用户名）
git remote add origin https://github.com/YOUR_USERNAME/fertilizer-recommendation-system.git

# 推送到 GitHub
git branch -M main
git push -u origin main
```

### ⚠️ 重要安全提示

**在推送前，请确保：**

1. ✅ `.env` 文件**不在**版本控制中（已在 .gitignore）
2. ✅ 敏感信息（API密钥、私钥）**已移除**或使用环境变量
3. ✅ 私钥文件 `*.pem` **不被提交**
4. ✅ 数据库文件 `*.db` **不被提交**

验证命令：
```bash
# 检查暂存区是否有敏感文件
git status

# 如果意外添加了敏感文件，先移除
git reset HEAD .env
git restore --staged .env
```

---

## 部署方案选择

根据项目特性，推荐以下部署方案：

| 方案 | 适用场景 | 费用 | 难度 |
|------|---------|------|------|
| GitHub Pages | 仅前端静态页面 | 免费 | ⭐ |
| Vercel | Node.js 全栈应用 | 免费 | ⭐⭐ |
| Render | Node.js 后端服务 | 免费 | ⭐⭐ |
| Railway | Node.js 全栈应用 | $5/月起 | ⭐⭐ |
| Cloudflare Workers | Serverless API | 免费 | ⭐⭐⭐ |

**推荐选择：**
- 想要最简单部署：**Vercel** 或 **Render**
- 需要后端服务：**Render** 或 **Railway**
- 只展示前端：**GitHub Pages**
- 全球 CDN 加速：**Cloudflare Workers**

---

## 方案一：GitHub Pages（仅静态前端）

### 限制说明

GitHub Pages 只能托管**静态文件**（HTML、CSS、JS），无法运行 Node.js 后端。

如果只需要展示前端界面，可使用此方案：

### 部署步骤

1. 进入 GitHub 仓库 **Settings**
2. 左侧菜单找到 **Pages**
3. Source 选择 **Deploy from a branch**
4. Branch 选择 **main**，目录选择 **/(root)**
5. 点击 **Save**

### 注意事项

- 后端 API 功能将不可用
- GeoTIFF 数据读取功能受限
- 天气 API 需要配置 CORS

---

## 方案二：Vercel 部署

Vercel 是最适合 Node.js 项目的免费托管平台。

### 步骤 1：连接 GitHub

1. 访问 [Vercel](https://vercel.com)
2. 使用 GitHub 账号登录
3. 点击 **Add New...** → **Project**
4. 选择你的 GitHub 仓库

### 步骤 2：配置项目

```
Framework Preset: Node.js
Root Directory: ./
Build Command: npm install
Output Directory: ./
Install Command: npm install
```

### 步骤 3：配置环境变量

在 Vercel 项目设置中添加环境变量：

| 变量名 | 说明 |
|--------|------|
| `QWEATHER_PRIVATE_KEY` | 和风天气私钥 |
| `QWEATHER_KEY_ID` | 和风天气凭据ID |
| `QWEATHER_PROJECT_ID` | 和风天气项目ID |
| `QWEATHER_API_HOST` | 和风天气API域名 |

### 步骤 4：创建 vercel.json

在项目根目录创建 `vercel.json`：

```json
{
  "version": 2,
  "builds": [
    {
      "src": "server.js",
      "use": "@vercel/node"
    }
  ],
  "routes": [
    {
      "src": "/(.*)",
      "dest": "server.js"
    }
  ]
}
```

### 步骤 5：部署

点击 **Deploy**，等待构建完成后即可访问。

---

## 方案三：Render 部署

Render 提供免费的 Node.js 后端托管服务。

### 步骤 1：创建 Render 账号

1. 访问 [Render](https://render.com)
2. 使用 GitHub 账号登录

### 步骤 2：创建 Web Service

1. 点击 **New +** → **Web Service**
2. 连接你的 GitHub 仓库
3. 配置服务：

```
Name: fertilizer-recommendation
Environment: Node
Build Command: npm install
Start Command: npm start
Instance Type: Free
```

### 步骤 3：配置环境变量

在 **Environment** 标签页添加：

```
QWEATHER_PRIVATE_KEY=你的私钥
QWEATHER_KEY_ID=你的KeyID
QWEATHER_PROJECT_ID=你的项目ID
QWEATHER_API_HOST=你的API域名
NODE_ENV=production
```

### 步骤 4：部署

点击 **Create Web Service**，等待部署完成。

### 步骤 5：获取 URL

部署成功后会获得一个 `*.onrender.com` 域名。

---

## 方案四：Railway 部署

Railway 提供简单易用的 PaaS 服务。

### 步骤 1：创建账号

1. 访问 [Railway](https://railway.app)
2. 使用 GitHub 登录

### 步骤 2：部署项目

1. 点击 **New Project**
2. 选择 **Deploy from GitHub repo**
3. 选择你的仓库
4. Railway 会自动检测 Node.js 项目

### 步骤 3：配置环境变量

在项目设置的 **Variables** 标签添加环境变量。

### 步骤 4：生成域名

在 **Settings** → **Domains** 生成公开访问域名。

---

## 方案五：Cloudflare Workers 部署

项目已包含 `worker.js` 和 `wrangler.toml` 文件，支持 Cloudflare Workers 部署。

### 步骤 1：安装 Wrangler CLI

```bash
npm install -g wrangler
```

### 步骤 2：登录 Cloudflare

```bash
wrangler login
```

这会打开浏览器，授权 Wrangler 访问您的 Cloudflare 账户。

### 步骤 3：配置 Account ID

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 在右侧边栏找到 **Account ID** 并复制
3. 编辑 `wrangler.toml`，取消注释并填入：

```toml
account_id = "你的账户ID"
```

### 步骤 4：首次部署

```bash
wrangler deploy
```

首次部署会创建 Worker 应用，输出类似：

```
Published fertilizer-recommendation-system
  https://fertilizer-recommendation-system.你的账户.workers.dev
```

### 步骤 5：配置 Secrets（敏感信息）

**部署成功后**，在 Cloudflare Dashboard 配置环境变量：

1. 进入 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 左侧菜单 → **Workers & Pages**
3. 点击你刚创建的 Worker（如 `fertilizer-recommendation-system`）
4. 选择 **Settings** → **Variables**
5. 点击 **Add variable**，选择 **Secret** 类型，添加：

| 变量名 | 说明 |
|--------|------|
| `QWEATHER_PRIVATE_KEY` | 和风天气私钥（完整内容，含 BEGIN/END 行） |
| `QWEATHER_KEY_ID` | 和风天气凭据 ID |
| `QWEATHER_PROJECT_ID` | 和风天气项目 ID |
| `QWEATHER_API_HOST` | 和风天气 API 域名 |

6. 点击 **Save and deploy** 使配置生效

### 步骤 6：验证部署

访问你的 Worker URL：
```
https://fertilizer-recommendation-system.你的账户.workers.dev
```

### 常用命令

```bash
# 本地开发测试
wrangler dev

# 查看部署日志
wrangler tail

# 查看环境变量（不含 Secrets）
wrangler secret list
```

---

## 方案六：Cloudflare Pages（完整前端+后端）⭐ 推荐

Cloudflare Pages 可以托管静态前端，并通过 Functions 提供 API 支持。

### 已创建的 Functions API

项目已包含完整的 Cloudflare Pages Functions，目录结构：

```
项目根目录/
├── index.html                    # 前端页面
├── static/                       # 静态资源
├── functions/                    # API Functions（已创建）
│   ├── health.js                 # GET /health
│   └── api/
│       ├── calculate.js          # POST /api/calculate
│       ├── weather.js            # GET /api/weather
│       ├── test_geotiff.js       # GET /api/test_geotiff
│       ├── fertilizer_timing.js  # POST /api/fertilizer_timing
│       └── simulate.js           # POST /api/simulate
├── package.json
└── wrangler.toml
```

### API 端点说明

| 方法 | 路径 | 功能 | 参数 |
|------|------|------|------|
| GET | `/health` | 健康检查 | - |
| POST | `/api/calculate` | 计算施肥方案 | `target_yield`, `lat`, `lon`, `crop` |
| GET | `/api/weather` | 获取天气数据 | `lat`, `lon` |
| GET | `/api/test_geotiff` | 获取土壤数据 | `lat`, `lon` |
| POST | `/api/fertilizer_timing` | 施肥时机建议 | `crop`, `weather` |
| POST | `/api/simulate` | 模拟计算 | `target_yield`, `lat`, `lon`, `crop` |

### 步骤 1：推送代码到 GitHub

确保所有文件（包括 `functions/` 目录）已推送到 GitHub。

### 步骤 2：通过 Dashboard 创建 Pages 项目

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 左侧菜单 → **Workers & Pages**
3. 点击 **Create** → **Pages** → **Connect to Git**
4. 选择你的 GitHub 仓库
5. 配置构建设置：
   - **Framework preset**: None
   - **Build command**: 留空（无需构建）
   - **Build output directory**: `/` (根目录)
6. 点击 **Save and Deploy**

### 步骤 3：配置环境变量

在 Pages 项目中配置：
- **Settings** → **Environment variables**

添加（类型选择 **Secret**）：
```
QWEATHER_PRIVATE_KEY
QWEATHER_KEY_ID
QWEATHER_PROJECT_ID
QWEATHER_API_HOST
```

### 步骤 4：验证部署

部署完成后访问：
```
https://你的项目名.pages.dev/health
```

应返回：
```json
{
  "status": "ok",
  "service": "科学施肥推荐系统",
  "platform": "Cloudflare Pages Functions"
}
```

### 测试 API 示例

```bash
# 获取天气
curl "https://你的项目名.pages.dev/api/weather?lat=30.592&lon=114.305"

# 计算施肥
curl -X POST "https://你的项目名.pages.dev/api/calculate" \
  -H "Content-Type: application/json" \
  -d '{"target_yield": 500, "lat": 30.592, "lon": 114.305, "crop": "rice"}'

# 获取土壤数据
curl "https://你的项目名.pages.dev/api/test_geotiff?lat=30.592&lon=114.305"
```

### 优点

- ✅ 免费托管前端静态文件
- ✅ 自动 HTTPS
- ✅ 全球 CDN 加速
- ✅ 支持 Functions 作为后端 API
- ✅ 支持 GitHub 自动部署
- ✅ 每月 100,000 次免费请求

---

## 环境变量配置

### 获取和风天气 API 凭据

1. 访问 [和风天气控制台](https://console.qweather.com)
2. 创建项目，选择 **Web API**
3. 生成 Ed25519 密钥对
4. 记录以下信息：
   - Project ID
   - Key ID
   - 私钥内容
   - API Host

### 环境变量格式

```bash
# .env 文件格式
QWEATHER_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----
MC4CAQAwBQYDK2VwBCIEIIL...
-----END PRIVATE KEY-----"

QWEATHER_KEY_ID=T9GYAGPRW3
QWEATHER_PROJECT_ID=4JKQKW99BC
QWEATHER_API_HOST=mn7h2rh9hq.re.qweatherapi.com
```

### 各平台配置方式

| 平台 | 配置位置 |
|------|---------|
| Vercel | Settings → Environment Variables |
| Render | Environment → Environment Variables |
| Railway | Variables 标签 |
| Cloudflare | Workers → Settings → Variables |

---

## 🎉 完成

部署成功后，你将获得一个公开访问的 URL，可以：

1. ✅ 分享给他人使用
2. ✅ 在 README 中添加徽章
3. ✅ 配置自定义域名
4. ✅ 设置 HTTPS（自动配置）

如有问题，请查看各平台的文档或提交 Issue。