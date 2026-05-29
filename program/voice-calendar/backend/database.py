from flask_sqlalchemy import SQLAlchemy

db = SQLAlchemy()


def init_db(app):
    """为应用绑定 SQLite 配置，并在启动时自动创建缺失的数据表。"""
    app.config["SQLALCHEMY_DATABASE_URI"] = "sqlite:///calendar.db"
    app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
    db.init_app(app)
    with app.app_context():
        db.create_all()
        print("[DB] 数据库初始化完成")
