"""Authentication utilities: JWT, password hashing, OAuth helpers."""
import time
from typing import Optional

import jwt
from passlib.context import CryptContext
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from . import config
from .database import get_db
from .models import User

pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
bearer_scheme = HTTPBearer(auto_error=False)


# ── Password ──────────────────────────────────────────
def hash_password(plain: str) -> str:
    # bcrypt has a 72-byte limit; truncate to avoid error
    encoded = plain.encode('utf-8')[:72]
    return pwd_ctx.hash(encoded.decode('utf-8', errors='ignore'))


def verify_password(plain: str, hashed: str) -> bool:
    encoded = plain.encode('utf-8')[:72]
    return pwd_ctx.verify(encoded.decode('utf-8', errors='ignore'), hashed)


# ── JWT ───────────────────────────────────────────────
def create_token(user_id: str) -> str:
    payload = {
        "sub": user_id,
        "exp": time.time() + config.JWT_EXPIRE_HOURS * 3600,
        "iat": time.time(),
    }
    return jwt.encode(payload, config.JWT_SECRET, algorithm=config.JWT_ALGORITHM)


def decode_token(token: str) -> Optional[str]:
    """Return user_id or None."""
    try:
        payload = jwt.decode(token, config.JWT_SECRET, algorithms=[config.JWT_ALGORITHM])
        return payload.get("sub")
    except jwt.PyJWTError:
        return None


# ── FastAPI dependency: current user ─────────────────
def get_current_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> Optional[User]:
    """Return the authenticated user or None (for guest routes)."""
    if creds is None:
        return None
    user_id = decode_token(creds.credentials)
    if user_id is None:
        return None
    return db.query(User).filter(User.id == user_id).first()


def require_user(
    creds: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    """Raise 401 if not authenticated."""
    user = get_current_user(creds, db)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    return user
