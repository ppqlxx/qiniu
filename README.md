# 小云日历 · Voice Calendar

> 七牛云 × XEngineer 暑期实训营参赛作品

**在线访问：** https://caviar-unjustly-hunting.ngrok-free.dev

> 注意：需要保持本地服务运行，访问时浏览器可能提示 ngrok 跳转页，点击 "Visit Site" 即可进入。

一款基于语音交互的智能日历应用。用户通过麦克风说出自然语言指令（如"明天下午三点开组会"），系统自动识别意图并完成日程的增删查，同时支持日程播报、天气查询、历史记录等功能。

---

## 功能概览

| 功能模块 | 说明 |
|---|---|
| 语音识别 | 录音上传至阿里云 NLS，转为文字 |
| 意图解析 | 调用通义千问（Qwen）理解口语化指令，支持多事件批量解析 |
| 日历管理 | 增删查日程，支持月视图 / 周视图切换 |
| 日程播报 | 点击周视图日期格，TTS 朗读当天安排；LLM 生成播报文本，失败时本地模板降级 |
| 天气组件 | 展示当前城市天气，城市可在设置中自定义 |
| 历史记录 | 语音识别历史持久化存储，支持录音文件回放 |
| 活动统计 | 统计指定时间段内的事件数量与分布 |
| 设置中心 | 语音提醒开关、暗色模式、天气城市、历史展示条数等 |
| 暗色模式 | 全页面深色主题，手动切换 |

---

## 技术架构

```
┌─────────────────────────────┐
│  前端  React + Vite (5173)   │
│  react-big-calendar 周/月视图 │
│  axios 接口请求               │
└────────────┬────────────────┘
             │ HTTP / REST
┌────────────▼────────────────┐
│  后端  Flask (8000)           │
│  Flask-SQLAlchemy  SQLite     │
│  阿里云 NLS  语音识别          │
│  通义千问 Qwen  意图解析/播报  │
└─────────────────────────────┘
```

---

## 目录结构

```
program/voice-calendar/
├── frontend/               # React 前端
│   ├── src/
│   │   ├── App.jsx         # 主应用，日历视图与交互逻辑
│   │   ├── api.js          # 后端接口封装
│   │   ├── styles.css      # 全局样式与暗色模式
│   │   └── components/
│   │       ├── VoiceButton.jsx     # 悬浮麦克风按钮与录音逻辑
│   │       ├── SettingsPanel.jsx   # 设置侧边栏
│   │       └── Weather.jsx         # 天气组件
│   └── package.json
└── backend/                # Flask 后端
    ├── app.py              # 应用入口与路由注册
    ├── stt.py              # 阿里云 NLS 语音识别
    ├── llm.py              # 通义千问意图解析与日程播报
    ├── models.py           # 数据模型（Event / VoiceHistory / ActionLog）
    ├── database.py         # SQLite 初始化
    ├── routers/
    │   ├── events.py       # 日程 CRUD 接口
    │   ├── voice.py        # 语音识别接口
    │   ├── brief.py        # 日程播报接口
    │   ├── settings.py     # 设置持久化接口
    │   ├── statistics.py   # 活动统计接口
    │   └── actions.py      # 操作日志接口
    └── requirements.txt
```

---

## 依赖说明

### 前端依赖

| 库 | 版本 | 用途 |
|---|---|---|
| [React](https://react.dev/) | ^18.3.1 | UI 框架 |
| [Vite](https://vitejs.dev/) | ^5.4.10 | 构建工具与开发服务器 |
| [react-big-calendar](https://github.com/jquense/react-big-calendar) | ^1.19.4 | 日历组件基础（月视图/导航），周视图议程表格为**自研实现** |
| [axios](https://axios-http.com/) | ^1.16.1 | HTTP 请求封装 |
| [dayjs](https://day.js.org/) | ^1.11.21 | 日期格式化与计算 |

> **原创说明**：周视图议程表格、语音按钮交互、播报触发逻辑、设置面板、天气组件、暗色模式、历史记录面板均为自主实现，未使用现成 UI 组件库。

### 后端依赖

| 库 | 版本 | 用途 |
|---|---|---|
| [Flask](https://flask.palletsprojects.com/) | 3.0.3 | Web 框架 |
| [Flask-CORS](https://flask-cors.readthedocs.io/) | 4.0.1 | 跨域请求支持 |
| [Flask-SQLAlchemy](https://flask-sqlalchemy.palletsprojects.com/) | 3.1.1 | ORM，数据持久化（SQLite） |
| [openai](https://github.com/openai/openai-python) | 1.30.1 | 调用通义千问 DashScope API（兼容 OpenAI 协议） |
| [python-dotenv](https://github.com/theskumar/python-dotenv) | 1.0.1 | 环境变量加载 |
| [requests](https://requests.readthedocs.io/) | >=2.28.0 | 阿里云 NLS Token 获取与音频上传 |

> **系统依赖**：需安装 [ffmpeg](https://ffmpeg.org/)，用于将浏览器录制的 webm 格式音频转换为阿里云 NLS 支持的 WAV 格式（16kHz 单声道）。

---

## 本地运行

### 环境准备

- Node.js >= 18
- Python >= 3.10
- ffmpeg（已加入 PATH）
- 阿里云账号（开通 NLS 语音识别服务）
- 阿里云 DashScope 账号（开通通义千问 API）

### 后端启动

```bash
cd program/voice-calendar/backend

# 安装依赖
pip install -r requirements.txt

# 配置环境变量（复制后填入真实密钥）
cp .env.example .env
```

`.env` 文件内容：

```env
# 阿里云语音识别
ALIYUN_ACCESS_KEY_ID=your_access_key_id
ALIYUN_ACCESS_KEY_SECRET=your_access_key_secret
ALIYUN_NLS_APP_KEY=your_nls_app_key

# 通义千问
DASHSCOPE_API_KEY=your_dashscope_api_key
QWEN_MODEL=qwen-plus        # 可选: qwen-turbo / qwen-plus / qwen-max
```

```bash
python app.py
# 服务启动在 http://localhost:8000
```

### 前端启动

```bash
cd program/voice-calendar/frontend
npm install
npm run dev
# 访问 http://localhost:5173
```

---

## 主要接口

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/health` | 服务状态检查 |
| GET | `/api/events` | 查询日程列表（按时间范围） |
| POST | `/api/events` | 手动创建日程 |
| DELETE | `/api/events/:id` | 删除日程 |
| POST | `/api/voice/recognize` | 上传录音，返回识别文本 + 解析意图 |
| POST | `/api/brief` | 生成指定日期的日程播报文本 |
| GET/POST | `/api/settings` | 读写用户设置 |
| GET | `/api/statistics` | 获取活动统计数据 |
| GET | `/api/voice/history` | 获取语音识别历史记录 |

---

## 原创功能说明

本项目所有代码均为参赛期间独立编写，无复用历史项目代码。主要原创实现包括：

1. **语音意图解析链路**：Prompt 工程设计，支持多事件批量解析、口语化时间推算（"后天下午"、"大概六七个小时"）、不确定活动处理。
2. **周视图自定义议程表格**：基于原生 DOM 实现，替代 react-big-calendar 的 Week 视图，支持日期格点击触发 TTS 播报。
3. **播报降级机制**：LLM API 失败时自动切换本地模板生成播报文本，保障功能可用性。
4. **NLS Token 缓存**：阿里云 NLS Token 有效期内复用，避免每次请求重新签名带来的延迟。
5. **音频格式转换**：后端使用 ffmpeg 将浏览器 MediaRecorder 输出的 webm/ogg 格式转为 NLS 支持的 16kHz WAV，解决格式兼容问题。
