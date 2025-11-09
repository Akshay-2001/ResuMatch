import os
from pymongo import MongoClient
from pymongo.server_api import ServerApi
from pymongo.database import Database
from pymongo.collection import Collection
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

class DatabaseClient:
    """
    A singleton class to manage the MongoDB client connection.
    """
    client: MongoClient | None = None
    db: Database | None = None

    def connect(self):
        """
        Establishes the connection to MongoDB.
        """
        uri = os.getenv("MONGO_URI")
        if not uri:
            raise Exception("MONGO_URI not found in environment variables")
        
        if self.client is None:
            self.client = MongoClient(uri, server_api=ServerApi('1'))
            try:
                self.client.admin.command('ping')
                print("Pinged your deployment. You successfully connected to MongoDB!")
                # Define your database here
                self.db = self.client["ResumeDB"]
            except Exception as e:
                print(f"Failed to connect to MongoDB: {e}")
                self.client = None
                self.db = None
                raise

    def get_database(self) -> Database:
        """
        Returns the database instance.
        """
        if self.db is None:
            self.connect()
        return self.db

    def get_resume_collection(self) -> Collection:
        """
        Helper function to get the 'resumes' collection.
        """
        db = self.get_database()
        return db["resumes"]

    def close(self):
        """
        Closes the MongoDB connection.
        """
        if self.client:
            self.client.close()
            self.client = None
            self.db = None
            print("MongoDB connection closed.")

# Create a single instance of the database client
# This instance will be shared across the application
db_client = DatabaseClient()

# Helper functions to easily access database and collections in your routes
def get_database() -> Database:
    """Get the database instance"""
    return db_client.get_database()

def get_resume_collection() -> Collection:
    """Get the resumes collection"""
    return db_client.get_resume_collection()