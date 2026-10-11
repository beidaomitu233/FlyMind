"""MindMap CRUD routes."""
import json
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User, MindMap
from ..auth import require_user

router = APIRouter(prefix="/api/maps", tags=["maps"])


def _map_to_response(m: MindMap) -> dict:
    """Convert MindMap model to API response dict (camelCase keys)."""
    try:
        data = json.loads(m.data) if isinstance(m.data, str) else m.data
    except json.JSONDecodeError:
        data = {}
    return {
        "id": m.id,
        "name": m.name,
        "data": data,
        "thumbnail": m.thumbnail or "",
        "createdAt": m.created_at,
        "updatedAt": m.updated_at,
        "deletedAt": m.deleted_at,
    }


# ── List active maps ──────────────────────────────────
@router.get("")
def list_maps(
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    maps = (
        db.query(MindMap)
        .filter(MindMap.user_id == user.id, MindMap.deleted_at.is_(None))
        .order_by(MindMap.updated_at.desc())
        .all()
    )
    return [_map_to_response(m) for m in maps]


# ── List trashed maps ─────────────────────────────────
@router.get("/trash")
def list_trash(
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    maps = (
        db.query(MindMap)
        .filter(MindMap.user_id == user.id, MindMap.deleted_at.isnot(None))
        .order_by(MindMap.deleted_at.desc())
        .all()
    )
    return [_map_to_response(m) for m in maps]


# ── Get single map ────────────────────────────────────
@router.get("/{map_id}")
def get_map(
    map_id: str,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    m = db.query(MindMap).filter(MindMap.id == map_id, MindMap.user_id == user.id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Map not found")
    return _map_to_response(m)


# ── Create / Update map ───────────────────────────────
@router.post("")
def save_map(
    body: dict,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    map_id = body.get("id")
    name = body.get("name", "新建导图")
    data = body.get("data", {})
    thumbnail = body.get("thumbnail", "")
    created_at = body.get("createdAt")

    if not map_id:
        raise HTTPException(status_code=400, detail="Missing 'id'")

    data_str = json.dumps(data) if not isinstance(data, str) else data

    existing = db.query(MindMap).filter(MindMap.id == map_id, MindMap.user_id == user.id).first()
    if existing:
        existing.name = name
        existing.data = data_str
        existing.thumbnail = thumbnail
        existing.updated_at = time.time()
        m = existing
    else:
        m = MindMap(
            id=map_id,
            user_id=user.id,
            name=name,
            data=data_str,
            thumbnail=thumbnail,
            created_at=created_at or time.time(),
            updated_at=time.time(),
        )
        db.add(m)

    db.commit()
    db.refresh(m)
    return _map_to_response(m)


# ── Move to trash ─────────────────────────────────────
@router.post("/{map_id}/trash")
def trash_map(
    map_id: str,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    m = db.query(MindMap).filter(MindMap.id == map_id, MindMap.user_id == user.id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Map not found")
    m.deleted_at = time.time()
    db.commit()
    db.refresh(m)
    return _map_to_response(m)


# ── Restore from trash ────────────────────────────────
@router.post("/{map_id}/restore")
def restore_map(
    map_id: str,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    m = db.query(MindMap).filter(MindMap.id == map_id, MindMap.user_id == user.id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Map not found")
    m.deleted_at = None
    m.updated_at = time.time()
    db.commit()
    db.refresh(m)
    return _map_to_response(m)


# ── Delete permanently ────────────────────────────────
@router.delete("/{map_id}")
def delete_map(
    map_id: str,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    m = db.query(MindMap).filter(MindMap.id == map_id, MindMap.user_id == user.id).first()
    if not m:
        raise HTTPException(status_code=404, detail="Map not found")
    db.delete(m)
    db.commit()
    return {"success": True}
