"""Authentication routes: register, login, OAuth callbacks."""
import httpx
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from .. import config
from ..database import get_db
from ..models import User
from ..schemas import RegisterRequest, LoginRequest, TokenResponse, UserOut
from ..auth import hash_password, verify_password, create_token, require_user

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _token_response(user: User) -> TokenResponse:
    return TokenResponse(
        token=create_token(user.id),
        user=UserOut.model_validate(user),
    )


# ── Register ──────────────────────────────────────────
@router.post("/register", response_model=TokenResponse)
def register(req: RegisterRequest, db: Session = Depends(get_db)):
    try:
        # Check duplicate username
        if db.query(User).filter(User.username == req.username).first():
            raise HTTPException(status_code=400, detail="Username already taken")
        if req.email and db.query(User).filter(User.email == req.email).first():
            raise HTTPException(status_code=400, detail="Email already registered")

        user = User(
            username=req.username,
            email=req.email,
            password_hash=hash_password(req.password),
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        return _token_response(user)
    except HTTPException:
        raise
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Registration failed: {str(e)}")


# ── Login ─────────────────────────────────────────────
@router.post("/login", response_model=TokenResponse)
def login(req: LoginRequest, db: Session = Depends(get_db)):
    user = None
    if req.username:
        user = db.query(User).filter(User.username == req.username).first()
    elif req.email:
        user = db.query(User).filter(User.email == req.email).first()

    if user is None or user.password_hash is None:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    if not verify_password(req.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    return _token_response(user)


# ── Get current user ──────────────────────────────────
@router.get("/me", response_model=UserOut)
def me(user: User = Depends(require_user)):
    return UserOut.model_validate(user)


# ── GitHub OAuth ──────────────────────────────────────
@router.get("/oauth/github")
def oauth_github():
    url = (
        f"https://github.com/login/oauth/authorize"
        f"?client_id={config.GITHUB_CLIENT_ID}"
        f"&redirect_uri={config.GITHUB_REDIRECT_URI}"
        f"&scope=read:user user:email"
    )
    return RedirectResponse(url)


@router.get("/oauth/github/callback")
def oauth_github_callback(code: str, db: Session = Depends(get_db)):
    """Exchange code for token, fetch user info, upsert user."""
    import secrets
    # Exchange code -> access_token
    resp = httpx.post(
        "https://github.com/login/oauth/access_token",
        data={
            "client_id": config.GITHUB_CLIENT_ID,
            "client_secret": config.GITHUB_CLIENT_SECRET,
            "code": code,
        },
        headers={"Accept": "application/json"},
        timeout=10,
    )
    token_data = resp.json()
    access_token = token_data.get("access_token")
    if not access_token:
        raise HTTPException(status_code=400, detail="GitHub OAuth failed")

    # Fetch user profile
    user_resp = httpx.get(
        "https://api.github.com/user",
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=10,
    )
    profile = user_resp.json()
    github_id = str(profile.get("id"))
    username = profile.get("login", f"gh_{github_id}")
    avatar = profile.get("avatar_url")

    # Upsert user
    user = db.query(User).filter(User.oauth_provider == "github", User.oauth_id == github_id).first()
    if not user:
        # Check if username conflicts
        existing = db.query(User).filter(User.username == username).first()
        if existing:
            username = f"{username}_{secrets.token_hex(3)}"
        user = User(
            username=username,
            avatar_url=avatar,
            oauth_provider="github",
            oauth_id=github_id,
        )
        db.add(user)
    else:
        user.avatar_url = avatar
        user.username = username

    db.commit()
    db.refresh(user)

    # Redirect to frontend with JWT
    jwt_token = create_token(user.id)
    return RedirectResponse(f"{config.FRONTEND_URL}/#/login?token={jwt_token}")


# ── Google OAuth ──────────────────────────────────────
@router.get("/oauth/google")
def oauth_google():
    url = (
        f"https://accounts.google.com/o/oauth2/v2/auth"
        f"?client_id={config.GOOGLE_CLIENT_ID}"
        f"&redirect_uri={config.GOOGLE_REDIRECT_URI}"
        f"&response_type=code"
        f"&scope=openid email profile"
    )
    return RedirectResponse(url)


@router.get("/oauth/google/callback")
def oauth_google_callback(code: str, db: Session = Depends(get_db)):
    import secrets
    # Exchange code -> tokens
    resp = httpx.post(
        "https://oauth2.googleapis.com/token",
        data={
            "client_id": config.GOOGLE_CLIENT_ID,
            "client_secret": config.GOOGLE_CLIENT_SECRET,
            "code": code,
            "grant_type": "authorization_code",
            "redirect_uri": config.GOOGLE_REDIRECT_URI,
        },
        timeout=10,
    )
    token_data = resp.json()
    access_token = token_data.get("access_token")
    if not access_token:
        raise HTTPException(status_code=400, detail="Google OAuth failed")

    # Fetch user info
    user_resp = httpx.get(
        "https://www.googleapis.com/oauth2/v2/userinfo",
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=10,
    )
    profile = user_resp.json()
    google_id = str(profile.get("id"))
    email = profile.get("email", f"google_{google_id}@oauth.local")
    name = profile.get("name", email.split("@")[0])
    avatar = profile.get("picture")

    # Upsert
    user = db.query(User).filter(User.oauth_provider == "google", User.oauth_id == google_id).first()
    if not user:
        existing = db.query(User).filter(User.email == email).first()
        if existing:
            # Link OAuth to existing account
            existing.oauth_provider = "google"
            existing.oauth_id = google_id
            existing.avatar_url = avatar
            user = existing
        else:
            username = name.replace(" ", "_").lower()
            if db.query(User).filter(User.username == username).first():
                username = f"{username}_{secrets.token_hex(3)}"
            user = User(
                username=username,
                email=email,
                avatar_url=avatar,
                oauth_provider="google",
                oauth_id=google_id,
            )
            db.add(user)
    else:
        user.avatar_url = avatar

    db.commit()
    db.refresh(user)

    jwt_token = create_token(user.id)
    return RedirectResponse(f"{config.FRONTEND_URL}/#/login?token={jwt_token}")
