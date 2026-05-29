from flask import Flask
from flask_cors import CORS
from dotenv import load_dotenv
from database import init_db
from llm import get_llm_provider
from response import ok_response
from routers.events import events_bp
from routers.voice import voice_bp
from stt import get_stt_provider

load_dotenv()


def create_app():
    app = Flask(__name__)
    app.config["JSON_AS_ASCII"] = False
    CORS(app)

    init_db(app)
    app.register_blueprint(events_bp)
    app.register_blueprint(voice_bp)

    @app.get("/api/health")
    def health():
        return ok_response(
            data={
                "status": "ok",
                "stt_provider": get_stt_provider(),
                "llm_provider": get_llm_provider(),
            },
            message="服务运行正常",
        )

    print("\n[Routes]")
    for rule in app.url_map.iter_rules():
        methods = ", ".join(sorted(rule.methods - {"HEAD", "OPTIONS"}))
        print(f"  {methods:10s} {rule}")
    print()

    return app


if __name__ == "__main__":
    app = create_app()
    app.run(debug=True, port=8000)
