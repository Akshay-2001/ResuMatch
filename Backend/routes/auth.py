"""
Authentication routes for user signup, login, and management.
"""
from fastapi import APIRouter, HTTPException, status, Depends
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from typing import Optional
import uuid
from datetime import datetime

from models.user import UserCreate, UserLogin, UserResponse, Token, TokenData
from services.auth_service import (
    verify_password,
    get_password_hash,
    create_access_token,
    decode_access_token
)
from db.database import get_database

auth_router = APIRouter(prefix="/auth", tags=["Authentication"])
security = HTTPBearer()


def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)) -> dict:
    """
    Dependency to get the current authenticated user from JWT token.
    
    Args:
        credentials: HTTP Bearer token from request header
    
    Returns:
        User data dict with user_id and email
    
    Raises:
        HTTPException: If token is invalid or expired
    """
    token = credentials.credentials
    payload = decode_access_token(token)
    
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    email: str = payload.get("email")
    user_id: str = payload.get("user_id")
    
    if email is None or user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Could not validate credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    return {"email": email, "user_id": user_id}


@auth_router.post("/signup", response_model=Token, status_code=status.HTTP_201_CREATED)
async def signup(user_data: UserCreate):
    """
    Register a new user.
    
    Args:
        user_data: User registration data (name, email, password)
    
    Returns:
        JWT access token
    
    Raises:
        HTTPException: If email already exists
    """
    db = get_database()
    users_collection = db["users"]
    
    # Check if user already exists
    existing_user = users_collection.find_one({"email": user_data.email})
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Email already registered"
        )
    
    # Create new user
    user_id = f"user-{uuid.uuid4()}"
    hashed_password = get_password_hash(user_data.password)
    
    user_doc = {
        "user_id": user_id,
        "name": user_data.name,
        "email": user_data.email,
        "hashed_password": hashed_password,
        "created_at": datetime.utcnow(),
        "is_active": True
    }
    
    users_collection.insert_one(user_doc)
    
    # Create access token
    access_token = create_access_token(
        data={"email": user_data.email, "user_id": user_id}
    )
    
    return Token(access_token=access_token)


@auth_router.post("/login", response_model=Token)
async def login(user_data: UserLogin):
    """
    Authenticate user and return JWT token.
    
    Args:
        user_data: User login credentials (email, password)
    
    Returns:
        JWT access token
    
    Raises:
        HTTPException: If credentials are invalid
    """
    db = get_database()
    users_collection = db["users"]
    
    # Find user by email
    user = users_collection.find_one({"email": user_data.email})
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password"
        )
    
    # Verify password
    if not verify_password(user_data.password, user["hashed_password"]):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect email or password"
        )
    
    # Check if user is active
    if not user.get("is_active", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User account is inactive"
        )
    
    # Create access token
    access_token = create_access_token(
        data={"email": user["email"], "user_id": user["user_id"]}
    )
    
    return Token(access_token=access_token)


@auth_router.get("/me", response_model=UserResponse)
async def get_current_user_info(current_user: dict = Depends(get_current_user)):
    """
    Get current authenticated user's information.
    
    Args:
        current_user: Current user from JWT token (injected by dependency)
    
    Returns:
        User information (without password)
    
    Raises:
        HTTPException: If user not found
    """
    db = get_database()
    users_collection = db["users"]
    
    user = users_collection.find_one({"user_id": current_user["user_id"]})
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
    
    return UserResponse(
        user_id=user["user_id"],
        name=user["name"],
        email=user["email"],
        created_at=user["created_at"],
        is_active=user.get("is_active", True)
    )

