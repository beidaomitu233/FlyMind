"""Export / Import routes for .fmd (FlyMind Document) files."""
import json
import time

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import JSONResponse

from ..auth import require_user, get_current_user
from ..models import User, MindMap
from ..database import get_db
from sqlalchemy.orm import Session

router = APIRouter(prefix="/api/export", tags=["export"])


@router.post("/fmd")
def export_fmd(
    body: dict,
    user: User | None = Depends(get_current_user),
):
    """Generate a .fmd file payload from map data.

    Guests can also use this; we just sign it with username if available.
    """
    data = body.get("data", {})
    name = body.get("name", "untitled")

    fmd = {
        "version": "1.0",
        "type": "flymind",
        "metadata": {
            "name": name,
            "author": user.username if user else "guest",
            "createdAt": body.get("createdAt", time.time()),
            "exportedAt": time.time(),
        },
        "data": data,
    }
    return JSONResponse(fmd)


@router.post("/import")
def import_fmd(
    body: dict,
    user: User = Depends(require_user),
    db: Session = Depends(get_db),
):
    """Import a .fmd file and save it as a new mind map."""
    fmd_content = body.get("fmd")
    if not fmd_content:
        raise HTTPException(status_code=400, detail="Missing 'fmd' payload")

    # Accept string (raw JSON) or already-parsed dict
    if isinstance(fmd_content, str):
        try:
            fmd_content = json.loads(fmd_content)
        except json.JSONDecodeError:
            raise HTTPException(status_code=400, detail="Invalid JSON in .fmd file")

    if fmd_content.get("type") != "flymind":
        raise HTTPException(status_code=400, detail="Not a valid FlyMind document")

    map_data = fmd_content.get("data")
    if not map_data:
        raise HTTPException(status_code=400, detail="Missing 'data' in .fmd file")

    metadata = fmd_content.get("metadata", {})
    name = metadata.get("name", "导入的导图")

    # Generate a new ID to avoid conflicts
    import secrets
    new_id = secrets.token_hex(12)
    if isinstance(map_data, dict):
        map_data["id"] = new_id

    data_str = json.dumps(map_data) if not isinstance(map_data, str) else map_data

    m = MindMap(
        id=new_id,
        user_id=user.id,
        name=name,
        data=data_str,
        thumbnail="",
        created_at=time.time(),
        updated_at=time.time(),
    )
    db.add(m)
    db.commit()
    db.refresh(m)

    try:
        data_parsed = json.loads(m.data) if isinstance(m.data, str) else m.data
    except json.JSONDecodeError:
        data_parsed = {}

    return {
        "id": m.id,
        "name": m.name,
        "data": data_parsed,
        "thumbnail": m.thumbnail or "",
        "createdAt": m.created_at,
        "updatedAt": m.updated_at,
        "deletedAt": m.deleted_at,
    }
