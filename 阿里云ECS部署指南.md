# 阿里云 ECS 部署指南

本文档详细说明如何将科学施肥推荐系统部署到阿里云 ECS 服务器。

## 一、服务器准备

### 1.1 购买 ECS 实例

1. 登录 [阿里云控制台](https://ecs.console.aliyun.com/)
2. 选择 **云服务器 ECS** → **创建实例**
3. 推荐配置：
   - **实例规格**：2核4G（推荐 ecs.c6.large 或更高）
   - **操作系统**：Ubuntu 22.04 LTS 或 CentOS 8+
   - **带宽**：建议 3Mbps 以上
   - **系统盘**：40GB 以上

### 1.2 安全组配置

在 ECS 实例的安全组中开放以下端口：

| 端口 | 协议 | 用途 |
|------|------|------|
| 22 | TCP | SSH 登录 |
| 80 | TCP | HTTP（Nginx） |
| 443 | TCP | HTTPS（Nginx） |
| 5000 | TCP | Node.js 应用（可选，调试用） |

## 二、连接服务器

### Windows 用户
使用 PuTTY、XShell 或 Windows Terminal 连接：
```bash
ssh root@你的服务器公网IP
```

### Mac/Linux 用户
```bash
ssh root@你的服务器公网IP
```

## 三、服务器环境配置

### 3.1 更新系统

**Ubuntu:**
```bash
apt update && apt upgrade -y
```

**CentOS:**
```bash
yum update -y
```

### 3.2 安装 Node.js

**方法一：使用 NodeSource（推荐）**

```bash
# 安装 Node.js 20.x LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# 验证安装
node -v   # 应显示 v20.x.x
npm -v    # 应显示 10.x.x
```

**方法二：使用 NVM（多版本管理）**

```bash
# 安装 NVM
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
source ~/.bashrc

# 安装 Node.js
nvm install 20
nvm use 20
```

### 3.3 安装 PM2（进程管理器）

```bash
npm install -g pm2
```

### 3.4 安装 Nginx（反向代理）

**Ubuntu:**
```bash
apt install -y nginx
```

**CentOS:**
```bash
yum install -y nginx
```

### 3.5 安装 Git

```bash
apt install -y git   # Ubuntu
yum install -y git   # CentOS
```

## 四、部署应用代码

### 4.1 创建应用目录

```bash
mkdir -p /var/www/fertilizer-system
cd /var/www/fertilizer-system
```

### 4.2 上传代码

**方法一：使用 Git 克隆（推荐）**

```bash
# 如果代码在 Git 仓库
git clone https://你的仓库地址.git .
```

**方法二：使用 SCP 上传（本地执行）**

在本地电脑执行：
```bash
# 上传整个项目目录
scp -r F:/shifeimodel/webcode3/webcode260222/* root@你的服务器IP:/var/www/fertilizer-system/
```

**方法三：使用 SFTP 工具**
- 使用 FileZilla、WinSCP 等工具上传

### 4.3 安装依赖

```bash
cd /var/www/fertilizer-system
npm install --production
```

### 4.4 验证文件结构

确保以下文件存在：
```bash
ls -la
# 应看到：
# server.js
# package.json
# index.html
# database_js.js
# fertilizer_data.json
# 长江中下游稻麦轮作肥料利用率.geojson
# 长江中下游稻麦轮作农时表.geojson
# GTiff/ (目录包含 .tif 文件)
# static/js/app.js
```

## 五、配置 PM2 进程管理

### 5.1 创建 PM2 配置文件

```bash
cd /var/www/fertilizer-system
nano ecosystem.config.js
```

写入以下内容：
```javascript
module.exports = {
  apps: [{
    name: 'fertilizer-system',
    script: 'server.js',
    cwd: '/var/www/fertilizer-system',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'production',
      PORT: 5000
    }
  }]
};
```

### 5.2 启动应用

```bash
# 启动应用
pm2 start ecosystem.config.js

# 查看状态
pm2 status

# 查看日志
pm2 logs fertilizer-system

# 设置开机自启
pm2 startup
pm2 save
```

### 5.3 常用 PM2 命令

```bash
pm2 restart fertilizer-system  # 重启应用
pm2 stop fertilizer-system     # 停止应用
pm2 delete fertilizer-system   # 删除应用
pm2 logs fertilizer-system     # 查看日志
pm2 monit                      # 监控面板
```

## 六、配置 Nginx 反向代理

### 6.1 创建 Nginx 配置

**Ubuntu 系统：**
```bash
# 确保目录存在
mkdir -p /etc/nginx/sites-available
mkdir -p /etc/nginx/sites-enabled

# 创建配置文件
nano /etc/nginx/sites-available/fertilizer-system
```

**CentOS 系统：**
```bash
# CentOS 使用 conf.d 目录
nano /etc/nginx/conf.d/fertilizer-system.conf
```

写入以下内容：
```nginx
server {
    listen 80;
    server_name 你的域名或IP;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        
        # 文件上传大小限制
        client_max_body_size 50M;
    }

    # 静态文件缓存
    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        proxy_pass http://127.0.0.1:5000;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }
}
```

### 6.2 启用配置

```bash
# Ubuntu
ln -s /etc/nginx/sites-available/fertilizer-system /etc/nginx/sites-enabled/

# CentOS
# 直接编辑 /etc/nginx/conf.d/fertilizer-system.conf

# 测试配置
nginx -t

# 重载 Nginx
systemctl reload nginx
systemctl enable nginx
```

## 七、配置 HTTPS（强烈推荐）

> **⚠️ 重要提示：** 现代浏览器的安全策略要求 HTTPS 环境才能使用 GPS 定位功能。
> - HTTP 环境下，浏览器会禁用 `navigator.geolocation` API
> - 本系统已优化为 HTTP 环境下使用高德地图网络定位作为备选
> - 如需使用 GPS 精准定位功能，**必须配置 HTTPS**

### 7.1 使用阿里云免费 SSL 证书

1. 在阿里云控制台搜索 **SSL证书**
2. 申请免费 DV 证书
3. 下载 Nginx 格式证书

### 7.2 安装证书

```bash
# 创建证书目录
mkdir -p /etc/nginx/ssl

# 上传证书文件（本地执行）
scp your-domain.pem root@服务器IP:/etc/nginx/ssl/
scp your-domain.key root@服务器IP:/etc/nginx/ssl/
```

### 7.3 更新 Nginx 配置

```bash
nano /etc/nginx/sites-available/fertilizer-system
```

修改为：
```nginx
# HTTP 重定向到 HTTPS
server {
    listen 80;
    server_name 你的域名;
    return 301 https://$server_name$request_uri;
}

# HTTPS 配置
server {
    listen 443 ssl http2;
    server_name 你的域名;

    ssl_certificate /etc/nginx/ssl/your-domain.pem;
    ssl_certificate_key /etc/nginx/ssl/your-domain.key;
    
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES128-GCM-SHA256:HIGH:!aNULL:!MD5:!RC4:!DHE;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    location / {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 50M;
    }

    location ~* \.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$ {
        proxy_pass http://127.0.0.1:5000;
        expires 7d;
        add_header Cache-Control "public, immutable";
    }
}
```

```bash
# 重载 Nginx
nginx -t && systemctl reload nginx
```

## 八、防火墙配置

### 8.1 Ubuntu (UFW)

```bash
ufw allow 22
ufw allow 80
ufw allow 443
ufw enable
```

### 8.2 CentOS (Firewalld)

```bash
firewall-cmd --permanent --add-service=ssh
firewall-cmd --permanent --add-service=http
firewall-cmd --permanent --add-service=https
firewall-cmd --reload
```

## 九、验证部署

### 9.1 本地测试

```bash
# 在服务器上测试
curl http://localhost:5000/health
# 应返回：{"status": "ok", ...}

curl http://localhost:5000/
# 应返回 HTML 页面
```

### 9.2 外部访问

在浏览器中访问：
- `http://你的服务器IP` 或
- `http://你的域名`（如果配置了域名解析）

## 十、运维管理

### 10.1 日志管理

```bash
# PM2 日志位置
~/.pm2/logs/

# 实时查看日志
pm2 logs fertilizer-system

# Nginx 日志
/var/log/nginx/access.log
/var/log/nginx/error.log
```

### 10.2 更新代码

```bash
cd /var/www/fertilizer-system

# 使用 Git
git pull origin main
npm install --production
pm2 restart fertilizer-system

# 或手动上传后
pm2 restart fertilizer-system
```

### 10.3 备份数据

```bash
# 备份 SQLite 数据库
cp /var/www/fertilizer-system/fertilizer_data.db /backup/fertilizer_data_$(date +%Y%m%d).db

# 设置定时备份
crontab -e
# 添加：每天凌晨3点备份
0 3 * * * cp /var/www/fertilizer-system/fertilizer_data.db /backup/fertilizer_data_$(date +\%Y\%m\%d).db
```

### 10.4 监控告警

```bash
# PM2 监控
pm2 install pm2-logrotate
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 7
```

## 十一、常见问题

### Q1: 无法访问服务

1. 检查安全组是否开放端口
2. 检查防火墙配置
3. 检查应用是否运行：`pm2 status`
4. 检查 Nginx 状态：`systemctl status nginx`

### Q2: 端口被占用

```bash
# 查看端口占用
netstat -tlnp | grep 5000

# 杀死进程
kill -9 进程PID
```

### Q3: Node.js 内存不足

```bash
# 增加 Node.js 内存限制
pm2 delete fertilizer-system
pm2 start server.js --name fertilizer-system --max-memory-restart 2G
```

### Q4: GeoTIFF 文件加载失败

确保 GTiff 目录和文件权限正确：
```bash
chmod -R 755 /var/www/fertilizer-system/GTiff/
ls -la /var/www/fertilizer-system/GTiff/
```

## 十二、快速部署脚本

创建一键部署脚本：

```bash
nano /root/deploy-fertilizer.sh
```

```bash
#!/bin/bash
# 科学施肥推荐系统一键部署脚本

APP_DIR="/var/www/fertilizer-system"
APP_PORT=5000

echo "=== 开始部署科学施肥推荐系统 ==="

# 检查 Node.js
if ! command -v node &> /dev/null; then
    echo "安装 Node.js..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt install -y nodejs
fi

# 检查 PM2
if ! command -v pm2 &> /dev/null; then
    echo "安装 PM2..."
    npm install -g pm2
fi

# 检查 Nginx
if ! command -v nginx &> /dev/null; then
    echo "安装 Nginx..."
    apt install -y nginx
fi

# 创建目录
mkdir -p $APP_DIR

# 安装依赖
cd $APP_DIR
echo "安装项目依赖..."
npm install --production

# 停止旧进程
pm2 delete fertilizer-system 2>/dev/null

# 启动应用
echo "启动应用..."
pm2 start server.js --name fertilizer-system

# 配置开机自启
pm2 startup | tail -n 1 | bash
pm2 save

echo "=== 部署完成 ==="
echo "请配置 Nginx 反向代理，访问 http://服务器IP:5000 测试"
```

```bash
chmod +x /root/deploy-fertilizer.sh
```

---

**部署完成后，您可以通过以下方式访问系统：**

- HTTP: `http://你的服务器IP` 或 `http://你的域名`
- HTTPS: `https://你的域名`（需配置 SSL 证书）