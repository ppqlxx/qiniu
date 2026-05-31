#!/bin/bash
set -e
echo "===== 1. 系统初始化 ====="
apt-get update -qq
apt-get install -y -qq git python3 python3-pip python3-venv nginx ffmpeg curl

echo "===== 2. 增加 swap（内存只有 1G） ====="
if [ ! -f /swapfile ]; then
  fallocate -l 1G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

echo "===== 3. 安装 Node.js 20 ====="
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

echo "===== 4. 拉取代码（develop 分支） ====="
cd /opt
if [ -d "qiniu" ]; then
  cd qiniu && git pull origin develop
else
  git clone -b develop https://github.com/ppqlxx/qiniu.git
  cd qiniu
fi

echo "===== 5. 后端依赖 ====="
cd /opt/qiniu/program/voice-calendar/backend
python3 -m venv venv
source venv/bin/activate
pip install -q -r requirements.txt
deactivate

echo "===== 6. 后端 .env 配置 ====="
cat > /opt/qiniu/program/voice-calendar/backend/.env << 'ENV'
FLASK_ENV=production
STT_PROVIDER=aliyun
LLM_PROVIDER=ollama
OLLAMA_BASE_URL=http://127.0.0.1:11434
OLLAMA_MODEL=qwen2.5:latest
ENV
echo "⚠️  请编辑 /opt/qiniu/program/voice-calendar/backend/.env 填写 ALIYUN_* 和 LLM 相关 Key"

echo "===== 7. 后端 systemd 服务 ====="
cat > /etc/systemd/system/voice-calendar.service << 'SERVICE'
[Unit]
Description=Voice Calendar Flask Backend
After=network.target

[Service]
User=root
WorkingDirectory=/opt/qiniu/program/voice-calendar/backend
ExecStart=/opt/qiniu/program/voice-calendar/backend/venv/bin/python app.py
Restart=always
RestartSec=5
Environment=PYTHONUNBUFFERED=1

[Install]
WantedBy=multi-user.target
SERVICE
systemctl daemon-reload
systemctl enable voice-calendar
systemctl restart voice-calendar

echo "===== 8. 前端构建 ====="
cd /opt/qiniu/program/voice-calendar/frontend
npm install --legacy-peer-deps
VITE_API_BASE=http://8.219.239.76:8000 npm run build

echo "===== 9. Nginx 配置 ====="
cat > /etc/nginx/sites-available/voice-calendar << 'NGINX'
server {
    listen 80;
    server_name _;

    root /opt/qiniu/program/voice-calendar/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        client_max_body_size 20m;
    }
}
NGINX
ln -sf /etc/nginx/sites-available/voice-calendar /etc/nginx/sites-enabled/voice-calendar
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl restart nginx

echo ""
echo "✅ 部署完成！"
echo "   前端地址：http://8.219.239.76"
echo "   后端地址：http://8.219.239.76:8000/api/health"
echo ""
echo "⚠️  还需补充 .env 中的 API Key，然后执行："
echo "   systemctl restart voice-calendar"
