"""
User model for authentication and user management.
"""
from pydantic import BaseModel, EmailStr, Field
from typing import Optional
from datetime import datetime


class UserCreate(BaseModel):
    """Model for user registration"""
    name: str = Field(..., min_length=1, max_length=100)
    email: EmailStr
    password: str = Field(..., min_length=6)


class UserLogin(BaseModel):
    """Model for user login"""
    email: EmailStr
    password: str


class UserInDB(BaseModel):
    """User model as stored in database"""
    user_id: str
    name: str
    email: str
    hashed_password: str
    created_at: datetime = Field(default_factory=datetime.utcnow)
    is_active: bool = True


class UserResponse(BaseModel):
    """User model for API responses (no password)"""
    user_id: str
    name: str
    email: str
    created_at: datetime
    is_active: bool


class Token(BaseModel):
    """JWT token response"""
    access_token: str
    token_type: str = "bearer"


class TokenData(BaseModel):
    """Data stored in JWT token"""
    email: Optional[str] = None
    user_id: Optional[str] = None

