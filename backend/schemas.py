"""Pydantic schemas for request / response validation."""
from __future__ import annotations
from pydantic import BaseModel, Field
from typing import Optional, Any


# ── Auth ──────────────────────────────────────────────
class RegisterRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=64)
    email: Optional[str] = None
    password: str = Field(..., min_length=6)


class LoginRequest(BaseModel):
    username: Optional[str] = None  # username login
    email: Optional[str] = None     # email login
    password: str


class TokenResponse(BaseModel):
    token: str
    user: UserOut


class UserOut(BaseModel):
    id: str
    username: str
    email: Optional[str] = None
    avatar_url: Optional[str] = None

    class Config:
        from_attributes = True


# Rebuild TokenResponse now that UserOut is defined
TokenResponse.model_rebuild()


# ── MindMap ───────────────────────────────────────────
class MindMapOut(BaseModel):
    id: str
    name: str
    data: Any            # parsed JSON or string
    thumbnail: Optional[str] = ""
    createdAt: float
    updatedAt: float
    deletedAt: Optional[float] = None


class MindMapSaveRequest(BaseModel):
    id: str
    name: str
    data: Any            # full MindMapData JSON
    thumbnail: Optional[str] = ""
    createdAt: Optional[float] = None
    updatedAt: Optional[float] = None


# ── AI ────────────────────────────────────────────────
class AIGenerateRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=4000)


# ── Export ────────────────────────────────────────────
class FMDImportRequest(BaseModel):
    """Payload for importing a .fmd file."""
    file_content: str   # raw JSON string of the .fmd file
