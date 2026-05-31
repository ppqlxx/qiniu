from dotenv import load_dotenv

load_dotenv()

from flask import Flask
from flask_cors import CORS
from database import init_db
from llm import get_llm_provider
from response import ok_response
from routers.actions import actions_bp
from routers.brief import brief_bp
from routers.events import events_bp
from routers.settings import settings_bp
from routers.statistics import statistics_bp
from routers.voice import voice_bp
from stt import get_stt_provider


def create_app():
    """创建 Flask 应用并完成数据库、路由与基础配置初始化。"""
    app = Flask(__name__)
    app.config["JSON_AS_ASCII"] = False
    CORS(app)

    init_db(app)
    app.register_blueprint(actions_bp)
    app.register_blueprint(brief_bp)
    app.register_blueprint(events_bp)
    app.register_blueprint(settings_bp)
    app.register_blueprint(statistics_bp)
    app.register_blueprint(voice_bp)

    @app.get("/api/health")
    def health():
        """返回服务状态以及当前启用的 STT / LLM provider。"""
        return ok_response(
            data={
                "status": "ok",
                "stt_provider": get_stt_provider(),
                "llm_provider": get_llm_provider(),
            },
            message="服务运行正常",
        )

    # 启动时打印路由，便于本地联调时确认接口是否注册成功。
    print("\n[Routes]")
    for rule in app.url_map.iter_rules():
        methods = ", ".join(sorted(rule.methods - {"HEAD", "OPTIONS"}))
        print(f"  {methods:10s} {rule}")
    print()

    return app


if __name__ == "__main__":
    app = create_app()
    app.run(debug=True, port=8000)
