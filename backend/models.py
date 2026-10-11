"""SQLAlchemy ORM models."""
import time
from sqlalchemy import Column, String, Integer, Float, Text, ForeignKey
from sqlalchemy.orm import relationship
from .database import Base


def _now() -> float:
    return time.time()


def _gen_id() -> str:
    import secrets
    return secrets.token_hex(12)


class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=_gen_id)
    username = Column(String(64), unique=True, nullable=False, index=True)
    email = Column(String(128), unique=True, nullable=True, index=True)
    password_hash = Column(String(256), nullable=True)  # nullable for OAuth users
    avatar_url = Column(String(512), nullable=True)
    oauth_provider = Column(String(32), nullable=True)  # 'github' | 'google' | null
    oauth_id = Column(String(128), nullable=True)
    created_at = Column(Float, default=_now)

    maps = relationship("MindMap", back_populates="user", cascade="all, delete-orphan")


class MindMap(Base):
    __tablename__ = "mindmaps"

    id = Column(String, primary_key=True, default=_gen_id)
    user_id = Column(String, ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(128), nullable=False, default="新建导图")
    data = Column(Text, nullable=False, default="{}")  # JSON blob of MindMapData
    thumbnail = Column(Text, nullable=True, default="")
    layout = Column(String(32), nullable=True, default="logic")
    created_at = Column(Float, default=_now)
    updated_at = Column(Float, default=_now)
    deleted_at = Column(Float, nullable=True)  # soft-delete timestamp

    user = relationship("User", back_populates="maps")
