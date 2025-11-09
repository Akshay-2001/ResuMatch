from fastapi import FastAPI
# 1. Import the CORSMiddleware
from fastapi.middleware.cors import CORSMiddleware
from routes.resume import resume_router
from routes.auth import auth_router
import uvicorn
import os

# Create the FastAPI application instance
app = FastAPI(
    title="Resume Builder API",
    description="API for creating, reading, updating, and deleting resumes.",
    version="1.0.0"
)

# 2. Define the "origins" (addresses) that are allowed to make requests
#    Your Vite dev server runs on 5173 by default.
origins = [
    "http://localhost:5173",  # React+Vite default
    "http://localhost:3000",  # Common React default
    "http://localhost",
]

# 3. Add the middleware to your app
app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,  # Allow specific origins
    allow_credentials=True, # Allow cookies (if you use them later)
    allow_methods=["*"],    # Allow all methods (GET, POST, PUT, etc.)
    allow_headers=["*"],    # Allow all headers
)


# Include authentication routes
app.include_router(auth_router)

# Include your resume routes
app.include_router(resume_router)

# --- Root Endpoint ---
@app.get("/", tags=["Root"])
def read_root():
    return {"message": "Welcome to the Resume Builder API!"}

# --- Main execution ---
if __name__ == "__main__":
    # Get port from environment variables, default to 8000
    port = int(os.environ.get("PORT", 8000))
    print(f"--- Starting server on http://localhost:{port} ---")
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)