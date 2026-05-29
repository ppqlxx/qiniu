from database import db
from datetime import datetime


class Event(db.Model):
    __tablename__ = "events"

    id          = db.Column(db.Integer, primary_key=True)
    title       = db.Column(db.String(200), nullable=False)
    start_time  = db.Column(db.DateTime, nullable=False)
    end_time    = db.Column(db.DateTime, nullable=True)
    description = db.Column(db.Text, default="")
    created_at  = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id":          self.id,
            "title":       self.title,
            "start_time":  self.start_time.isoformat(),
            "end_time":    self.end_time.isoformat() if self.end_time else None,
            "description": self.description,
            "created_at":  self.created_at.isoformat(),
        }
