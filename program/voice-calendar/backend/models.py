from datetime import datetime

from database import db


class Event(db.Model):
    """表示日历事件的数据库模型。"""

    __tablename__ = "events"

    id = db.Column(db.Integer, primary_key=True)
    title = db.Column(db.String(200), nullable=False)
    start_time = db.Column(db.DateTime, nullable=False)
    end_time = db.Column(db.DateTime, nullable=True)
    description = db.Column(db.Text, default="")
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        """将模型对象转换为便于接口返回的字典结构。"""
        return {
            "id": self.id,
            "title": self.title,
            "start_time": self.start_time.isoformat(),
            "end_time": self.end_time.isoformat() if self.end_time else None,
            "description": self.description,
            "created_at": self.created_at.isoformat(),
        }


class AppSettings(db.Model):
    __tablename__ = "app_settings"

    id = db.Column(db.Integer, primary_key=True)
    settings_json = db.Column(db.Text, nullable=False, default="{}")
    updated_at = db.Column(db.DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class VoiceLog(db.Model):
    __tablename__ = "voice_logs"

    id         = db.Column(db.Integer, primary_key=True)
    transcript = db.Column(db.Text)
    action     = db.Column(db.String(20))
    result_msg = db.Column(db.Text)
    audio_file = db.Column(db.String(100))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "transcript": self.transcript,
            "action": self.action,
            "result_msg": self.result_msg,
            "audio_file": self.audio_file,
            "created_at": self.created_at.isoformat(),
        }
