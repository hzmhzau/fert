# 科学施肥推荐系统 - Node.js 后台

## 概述

本项目将原 Python Flask 后台完整重写为 **Node.js + Express** 的 JavaScript 后台，保持所有 API 接口兼容。

## 文件说明

| 文件 | 对应 Python 文件 | 说明 |
|------|-----------------|------|
| `server.js` | `app.py` | 主服务器文件，包含所有路由和业务逻辑 |
| `database_js.js` | `database.py` + `models.py` | 数据库操作模块（使用 SQLite） |
| `package.json` | — | Node.js 依赖配置 |

## 安装依赖

```bash
npm install
```

## 启动服务

```bash
# 生产模式
npm start

# 开发模式（文件变更自动重启）
npm run dev
```

服务默认监听 `http://0.0.0.0:5000`

## API 接口（与 Python 版完全兼容）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 主页（提供 index.html） |
| GET | `/health` | 健康检查 |
| POST | `/calculate` | 计算施肥方案 |
| GET | `/test_geotiff` | 测试土壤数据（返回模拟数据） |
| GET/POST | `/api/test` | API 测试端点 |
| GET | `/api/weather` | 获取天气数据 |
| POST | `/api/fertilizer_timing` | 获取施肥时机建议 |
| POST | `/api/simulate` | 模拟计算（离线测试） |
| GET/POST | `/api/amap_proxy` | 高德地图 API 代理 |
| GET | `/api/map_config` | 获取地图配置 |

## 与 Python 版差异

1. **GeoTIFF 读取**：Node.js 版不支持直接读取 GeoTIFF 文件（需要 `gdal-async` 等扩展库），`/test_geotiff` 端点返回基于经纬度插值的模拟数据，计算精度与 Python 版相同。
2. **数据库**：使用 `better-sqlite3` 替代 SQLAlchemy ORM，API 保持兼容。若 `better-sqlite3` 未安装，自动退回内存存储模式。
3. **天气 API**：调用相同的 Open-Meteo 免费 API，逻辑与 Python 版一致。

## 数据文件

需要将以下文件放在与 `server.js` 同目录：
- `index.html`（前端页面）
- `长江中下游稻麦轮作肥料利用率.geojson`
- `长江中下游稻麦轮作农时表.geojson`

数据库文件 `fertilizer_data.db` 将自动在同目录创建。
