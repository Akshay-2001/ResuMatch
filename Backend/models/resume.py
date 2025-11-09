from pydantic import BaseModel, Field, EmailStr, ConfigDict, BeforeValidator, HttpUrl
from bson import ObjectId
from typing import Optional, List, Annotated, Any
from datetime import date

# --- Fix for MongoDB ObjectId ---
def validate_object_id(v: Any) -> ObjectId:
    if isinstance(v, ObjectId):
        return v
    if ObjectId.is_valid(v):
        return ObjectId(v)
    raise ValueError("Invalid ObjectId")

PyObjectId = Annotated[ObjectId, BeforeValidator(validate_object_id)]

# --- Our Internal Resume Structure ---
# (No changes here, these are our internal "perfect" models)

class Education(BaseModel):
    education_id: str = Field(..., example="uuid-4444-dddd")
    institution_name: str = Field(..., example="University at Buffalo")
    degree: str = Field(..., example="Master of Science")
    field_of_study: Optional[str] = Field(None, example="Computer Science")
    graduation_date: Optional[str] = Field(None, example="2025-12-15 or Aug. 2024")
    start_date: Optional[str] = Field(None, example="Jul. 2022")

class WorkExperience(BaseModel):
    work_ex_id: str = Field(..., example="uuid-1111-aaaa")
    job_title: str = Field(..., example="Software Developer")
    company_name: str = Field(..., example="TCS")
    location: Optional[str] = Field(None, example="India")
    start_date: Optional[str] = Field(None, example="2021-06-01 or Jul. 2019")
    end_date: Optional[str] = Field(None, example="2024-08-01 or Jun. 2022")
    description_bullets: Optional[List[str]] = Field(
        None,
        example=[
            "Developed and maintained enterprise-level applications...",
            "Collaborated with cross-functional teams..."
        ]
    )

class Project(BaseModel):
    project_id: str = Field(..., example="uuid-3333-cccc")
    project_name: str = Field(..., example="Pathfinding Visualizer")
    repository_url: Optional[str] = Field(None, example="https://github.com/...")
    description_bullets: Optional[List[str]] = Field(
        None,
        example=[
            "Built an application to visualize Dijkstra's algorithm...",
            "Used React for the frontend..."
        ]
    )

class Skill(BaseModel):
    skill_id: str = Field(..., example="uuid-5555-eeee")
    skill_name: str = Field(..., example="Python")
    category: Optional[str] = Field(None, example="Language")

# --- Base Model for Creating a Resume (Used Internally) ---
class UserResumeCreate(BaseModel):
    user_id: str = Field(..., example="a_unique_user_id_you_manage")
    email: EmailStr = Field(..., example="student@buffalo.edu")
    first_name: str = Field(..., example="John")
    last_name: Optional[str] = Field(None, example="Doe")
    phone: Optional[str] = Field(None, example="716-555-1234")
    linkedin_url: Optional[str] = Field(None, example="https://linkedin.com/...")
    portfolio_url: Optional[str] = Field(None, example="https://johndoe.dev")
    
    work_experience: List[WorkExperience] = Field(default_factory=list)
    projects: List[Project] = Field(default_factory=list)
    education: List[Education] = Field(default_factory=list)
    skills: List[Skill] = Field(default_factory=list)

# --- Full Resume Model (Used for DB Responses) ---
class UserResume(UserResumeCreate):
    id: PyObjectId = Field(..., alias="_id")

    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
        json_encoders={ObjectId: str}
    )

# -----------------------------------------------------------------
# --- MODIFIED: Ingestion Models (To match your new JSON payload) ---
# --- All fields are now optional, except for name/email ---
# -----------------------------------------------------------------

class IngestPersonal(BaseModel):
    name: str  # Still required, we can't create a user without a name
    email: EmailStr # Still required, we need a unique identifier
    phone: Optional[str] = None
    location: Optional[str] = None
    linkedin: Optional[str] = None
    github: Optional[str] = None

class IngestEducation(BaseModel):
    institution: Optional[str] = None # Now optional
    degree: Optional[str] = None      # Now optional
    start: Optional[str] = None
    end: Optional[str] = None
    details: Optional[str] = None

class IngestExperience(BaseModel):
    company: Optional[str] = None     # Now optional
    role: Optional[str] = None        # Now optional
    start: Optional[str] = None
    end: Optional[str] = None
    description: Optional[str] = None
    achievements: Optional[str] = None

class IngestProject(BaseModel):
    title: Optional[str] = None       # Now optional
    description: Optional[str] = None

class IngestSkill(BaseModel):
    skill_name: Optional[str] = None  # Skill name (e.g., "Python")
    category: Optional[str] = None    # Category (e.g., "Language", "Framework")

class IngestResume(BaseModel):
    """
    This is the main model that matches the new JSON payload.
    All fields are now optional to prevent validation errors.
    """
    personal: Optional[IngestPersonal] = None # Now optional
    education: List[IngestEducation] = Field(default_factory=list)
    experience: List[IngestExperience] = Field(default_factory=list)
    projects: List[IngestProject] = Field(default_factory=list)
    skills: List[IngestSkill] = Field(default_factory=list)