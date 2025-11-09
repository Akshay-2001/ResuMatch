from fastapi import APIRouter, HTTPException, status, Body, Query, Depends
from pymongo.collection import Collection
from bson import ObjectId
from bson.errors import InvalidId
from pydantic import BaseModel, Field, ConfigDict, EmailStr
from typing import List, Optional
import uuid # Used for generating unique IDs
import asyncio # <-- NEW: For running summarizations in parallel
import logging # For logging

# Import all our models
from models.resume import (
    UserResume, 
    UserResumeCreate, 
    WorkExperience, 
    Project, 
    Education, 
    Skill,
    IngestResume
)
from db.database import get_resume_collection
# --- NEW: Import our async summarizer ---
from services.summarizer import summarize_item, MODEL_LOADED as DEEPSEEK_MODEL_LOADED
# --- NEW: Import authentication dependency ---
from routes.auth import get_current_user

# --- Model Loading (Sentence Transformer) ---
try:
    from sentence_transformers import SentenceTransformer, util
    import torch
    print("--- Loading SentenceTransformer model 'all-MiniLM-L6-v2' ---")
    st_model = SentenceTransformer('all-MiniLM-L6-v2')
    print("--- SentenceTransformer Model loaded successfully ---")
    ST_MODEL_LOADED = True
except ImportError:
    print("--- WARNING: 'sentence-transformers' not installed. Ranking endpoint will not work. ---")
    print("--- Run 'pip install sentence-transformers' ---")
    ST_MODEL_LOADED = False


# Create a router for resume-related endpoints
resume_router = APIRouter(
    prefix="/resumes",
    tags=["Resumes"]
)

# --- Response model for successful creation ---
class CreateSuccessResponse(BaseModel):
    message: str = Field(default="Resume created successfully")
    inserted_id: str = Field(..., 
                             description="The MongoDB _id of the newly created resume.",
                             example="67f51b7a216e83d8e1f51f4c")

# --- Response model for just Experience and Projects ---
class ExperienceAndProjectsResponse(BaseModel):
    work_experience: List[WorkExperience] = Field(..., description="List of work experiences")
    projects: List[Project] = Field(..., description="List of projects")
    
    model_config = ConfigDict(
        extra='ignore' 
    )

# -----------------------------------------------------------------
# --- Endpoint to Create a New Resume (This is what was missing) ---
# -----------------------------------------------------------------
@resume_router.post(
    "/",
    response_model=CreateSuccessResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new resume from the UI payload"
)
def create_resume(
    payload: IngestResume = Body(...),
    current_user: dict = Depends(get_current_user)
):
    """
    Receives the JSON payload from the UI, transforms it into the
    internal UserResumeCreate model, and saves it to the database.
    
    This function is robust and will skip items that are missing
    necessary fields (e.g., an education item without an institution).
    
    Requires authentication. Resume will be associated with the authenticated user.
    """
    
    # --- 1. Transform IngestResume -> UserResumeCreate ---
    
    if not payload.personal or not payload.personal.name or not payload.personal.email:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="The 'personal' object with a valid 'name' and 'email' is required."
        )
    
    personal = payload.personal
    name_parts = personal.name.strip().split(' ', 1)
    first_name = name_parts[0]
    last_name = name_parts[1] if len(name_parts) > 1 else None

    # Check if user already has a resume
    collection = get_resume_collection()
    existing_resume = collection.find_one({"user_id": current_user["user_id"]})
    if existing_resume:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"You already have a resume. Use the PUT endpoint to update it."
        )

    transformed_education = []
    if payload.education:
        for edu in payload.education:
            if not edu.institution or not edu.degree:
                continue
            transformed_education.append(
                Education(
                    education_id=f"edu-{uuid.uuid4()}",
                    institution_name=edu.institution,
                    degree=edu.degree,
                    field_of_study=edu.details,
                    graduation_date=edu.end,
                    start_date=edu.start
                )
            )
    
    transformed_work_ex = []
    if payload.experience:
        for exp in payload.experience:
            if not exp.company or not exp.role:
                continue
            bullets = []
            if exp.description:
                bullets.extend(exp.description.strip().split('\n'))
            if exp.achievements:
                bullets.extend(exp.achievements.strip().split('\n'))
            transformed_work_ex.append(
                WorkExperience(
                    work_ex_id=f"work-{uuid.uuid4()}",
                    job_title=exp.role,
                    company_name=exp.company,
                    location=None,
                    start_date=exp.start,
                    end_date=exp.end,
                    description_bullets=bullets
                )
            )

    transformed_projects = []
    if payload.projects:
        for proj in payload.projects:
            if not proj.title:
                continue
            bullets = []
            if proj.description:
                bullets = proj.description.strip().split('\n')
            transformed_projects.append(
                Project(
                    project_id=f"proj-{uuid.uuid4()}",
                    project_name=proj.title,
                    repository_url=None,
                    description_bullets=bullets
                )
            )

    transformed_skills = []
    if payload.skills:
        for skill in payload.skills:
            if not skill.skill_name or not skill.skill_name.strip():
                continue
            transformed_skills.append(
                Skill(
                    skill_id=f"skill-{uuid.uuid4()}",
                    skill_name=skill.skill_name.strip(),
                    category=skill.category.strip() if skill.category else None
                )
            )

    resume_to_create = UserResumeCreate(
        user_id=current_user["user_id"],  # Use authenticated user's ID
        email=personal.email,
        first_name=first_name,
        last_name=last_name,
        phone=personal.phone,
        linkedin_url=personal.linkedin,
        portfolio_url=personal.github,
        work_experience=transformed_work_ex,
        projects=transformed_projects,
        education=transformed_education,
        skills=transformed_skills
    )

    # --- 2. Save to Database ---
    resume_dict = resume_to_create.model_dump(mode='json') 
    
    try:
        insert_result = collection.insert_one(resume_dict)
        if not insert_result.acknowledged:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail="Failed to insert resume into database."
            )
        # Return the ID as a string
        return {
            "message": "Resume created successfully",
            "inserted_id": str(insert_result.inserted_id)
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An error occurred: {e}"
        )

# -----------------------------------------------------------------
# --- Get Full Resume by Email ---
# -----------------------------------------------------------------
@resume_router.get(
    "/lookup/full",
    response_model=UserResume,
    status_code=status.HTTP_200_OK,
    summary="Get the authenticated user's full resume"
)
def get_full_resume_by_email(
    email: EmailStr = Query(..., example="student@buffalo.edu"),
    current_user: dict = Depends(get_current_user)
):
    """
    Finds the authenticated user's resume in the database and returns
    the entire resume document.
    
    Requires authentication. Only returns the resume for the logged-in user.
    """
    collection = get_resume_collection()
    # Query by user_id to ensure users only see their own resume
    resume_doc = collection.find_one({"user_id": current_user["user_id"]})
    
    if resume_doc:
        return UserResume.model_validate(resume_doc)
    
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"Resume not found. Please create your resume first."
    )

# -----------------------------------------------------------------
# --- Get Experience/Projects by Email ---
# -----------------------------------------------------------------
@resume_router.get(
    "/lookup/experience-projects",
    response_model=ExperienceAndProjectsResponse,
    status_code=status.HTTP_200_OK,
    summary="Get just experience and projects by email address"
)
def get_experience_projects_by_email(email: EmailStr = Query(..., example="student@buffalo.edu")):
    """
    Finds a resume in the database using the email address
    and returns *only* the work_experience and projects fields.
    """
    collection = get_resume_collection()
    projection = {
        "work_experience": 1,
        "projects": 1,
        "_id": 0
    }
    
    resume_data = collection.find_one(
        {"email": email},
        projection
    )
    
    if resume_data:
        return ExperienceAndProjectsResponse.model_validate(resume_data)
    
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"Resume with email {email} not found."
    )

# -----------------------------------------------------------------
# --- Endpoints that use MongoDB _id ---
# -----------------------------------------------------------------

@resume_router.get(
    "/{resume_id}",
    response_model=UserResume,
    status_code=status.HTTP_200_OK,
    summary="Get a single resume by its MongoDB ID"
)
def get_resume_by_id(resume_id: str):
    collection = get_resume_collection()
    try:
        object_id_to_find = ObjectId(resume_id)
    except InvalidId:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"'{resume_id}' is not a valid MongoDB ObjectId."
        )
    
    resume_doc = collection.find_one({"_id": object_id_to_find})
    
    if resume_doc:
        return UserResume.model_validate(resume_doc)
    
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"Resume with ID {resume_id} not found."
    )

@resume_router.get(
    "/{resume_id}/experience-projects",
    response_model=ExperienceAndProjectsResponse,
    status_code=status.HTTP_200_OK,
    summary="Get only the work experience and projects for a resume by ID"
)
def get_resume_experience_projects_by_id(resume_id: str):
    collection = get_resume_collection()
    
    try:
        object_id_to_find = ObjectId(resume_id)
    except InvalidId:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"'{resume_id}' is not a valid MongoDB ObjectId."
        )
    
    projection = {
        "work_experience": 1,
        "projects": 1,
        "_id": 0
    }
    
    resume_data = collection.find_one(
        {"_id": object_id_to_find},
        projection
    )
    
    if resume_data:
        return ExperienceAndProjectsResponse.model_validate(resume_data)
    
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=f"Resume with ID {resume_id} not found."
    )

# -----------------------------------------------------------------
# --- MODIFIED: AI Ranking Endpoint (Now Async w/ Summarization) ---
# -----------------------------------------------------------------

class RankRequest(BaseModel):
    job_description: str = Field(..., 
                                 description="The full text of the job description.",
                                 example="We are looking for a Python developer...")

class RankedWorkExperience(WorkExperience):
    score: float = Field(..., 
                         description="The cosine similarity score (0.0 to 1.0)",
                         example=0.85)

class RankedProject(Project):
    score: float = Field(..., 
                         description="The cosine similarity score (0.0 to 1.0)",
                         example=0.72)

class RankResponse(BaseModel):
    top_work_experiences: List[RankedWorkExperience] = Field(..., 
                                description="List of top N work experiences, sorted by score.")
    top_projects: List[RankedProject] = Field(..., 
                                description="List of top N projects, sorted by score.")


@resume_router.post(
    "/{resume_id}/rank-items",
    response_model=RankResponse,
    status_code=status.HTTP_200_OK,
    summary="Rank, Summarize, and Return top work/projects"
)
async def rank_and_summarize_resume_items( # <-- Changed to async def
    resume_id: str,
    request: RankRequest = Body(...),
    current_user: dict = Depends(get_current_user)
):
    """
    Ranks all work experience and projects against a job description,
    then sends the top 2 work-ex and top 3 projects to an AI
    to summarize their bullet points, and returns the final result.
    
    Requires authentication. Only works with the logged-in user's resume.
    """
    if not ST_MODEL_LOADED:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The local AI ranking model is not loaded. Please install 'sentence-transformers' and restart."
        )
    if not DEEPSEEK_MODEL_LOADED:
         raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="The summarization service is not available. Check your DEEPSEEK_API_KEY in the .env file."
        )

    collection = get_resume_collection()
    try:
        object_id_to_find = ObjectId(resume_id)
    except InvalidId:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"'{resume_id}' is not a valid MongoDB ObjectId."
        )

    projection = {"work_experience": 1, "projects": 1, "user_id": 1, "_id": 0}
    resume_data = collection.find_one({"_id": object_id_to_find}, projection)
    
    if not resume_data:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Resume with ID {resume_id} not found."
        )
    
    # Verify resume belongs to the authenticated user
    if resume_data.get("user_id") != current_user["user_id"]:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You don't have permission to access this resume."
        )

    items_to_rank = []
    
    for work_ex in resume_data.get('work_experience', []):
        combined_text = ". ".join(work_ex.get('description_bullets', []))
        items_to_rank.append(('Work Ex', work_ex, combined_text))

    for project in resume_data.get('projects', []):
        combined_text = ". ".join(project.get('description_bullets', []))
        items_to_rank.append(('Project', project, combined_text))

    if not items_to_rank:
        return RankResponse(top_work_experiences=[], top_projects=[])

    try:
        # --- 1. Ranking (Fast, Local) ---
        item_descriptions = [text for _, _, text in items_to_rank]
        jd_embedding = st_model.encode(request.job_description, convert_to_tensor=True)
        item_embeddings = st_model.encode(item_descriptions, convert_to_tensor=True)
        cosine_scores = util.cos_sim(jd_embedding, item_embeddings)

        ranked_items = []
        for i in range(len(items_to_rank)):
            score = cosine_scores[0][i].item()
            category, original_object, _ = items_to_rank[i]
            original_object['score'] = score
            ranked_items.append((score, category, original_object))

        ranked_items.sort(key=lambda x: x[0], reverse=True)

        # --- 2. Filtering (Fast, Local) ---
        top_work_ex_items = []
        top_project_items = []
        
        for score, category, item_data in ranked_items:
            if category == 'Work Ex' and len(top_work_ex_items) < 2:
                top_work_ex_items.append(item_data)
            elif category == 'Project' and len(top_project_items) < 3:
                top_project_items.append(item_data)

        # --- 3. Summarization (Slow, External, now in PARALLEL) ---
        
        # Create a list of async tasks to run
        tasks = []
        for item in top_work_ex_items:
            tasks.append(summarize_item(item, item_type="work experience"))
        for item in top_project_items:
            tasks.append(summarize_item(item, item_type="project"))

        # Run all summarization tasks concurrently
        # We get back a list of the modified (summarized) items
        summarized_results = await asyncio.gather(*tasks)

        # --- 4. Validation and Final Response ---
        # Separate the results back into work_ex and projects
        final_work_ex = []
        final_projects = []
        
        # We need to find our items in the summarized_results list
        work_ex_ids = {item['work_ex_id'] for item in top_work_ex_items}
        project_ids = {item['project_id'] for item in top_project_items}

        for item in summarized_results:
            if 'work_ex_id' in item and item['work_ex_id'] in work_ex_ids:
                final_work_ex.append(RankedWorkExperience.model_validate(item))
            elif 'project_id' in item and item['project_id'] in project_ids:
                final_projects.append(RankedProject.model_validate(item))
        
        # Sort them again by score just to be sure
        final_work_ex.sort(key=lambda x: x.score, reverse=True)
        final_projects.sort(key=lambda x: x.score, reverse=True)

        return RankResponse(
            top_work_experiences=final_work_ex,
            top_projects=final_projects
        )
    
    except Exception as e:
        logging.error(f"Error during AI ranking/summarization: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"An error occurred during the AI ranking/summarization process: {e}"
        )