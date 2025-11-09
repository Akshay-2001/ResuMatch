import os
import asyncio
import logging
from openai import AsyncOpenAI  # Import the Async client
from typing import List, Dict, Any

# --- Client Initialization ---
# Load the API key from the .env file
DEEPSEEK_API_KEY = os.getenv("DEEPSEEK_API_KEY")
DEEPSEEK_BASE_URL = "https://api.deepseek.com"

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')

# Initialize the Asynchronous client
if DEEPSEEK_API_KEY:
    client = AsyncOpenAI(
        api_key=DEEPSEEK_API_KEY,
        base_url=DEEPSEEK_BASE_URL
    )
    logging.info("AsyncOpenAI client initialized for DeepSeek.")
else:
    client = None
    logging.warning("DEEPSEEK_API_KEY not found in .env file. Summarizer will not work.")

# --- THE FIX ---
# Export a boolean flag to check if the client is ready
MODEL_LOADED = client is not None
# --- END OF FIX ---

async def call_deepseek_api_async(messages: List[Dict[str, str]], model: str = "deepseek-chat") -> Dict[str, Any]:
    """
    Calls the DeepSeek API asynchronously.
    """
    if not client:
        raise Exception("DeepSeek client is not initialized. Check API key.")
    
    max_retries = 3
    for attempt in range(max_retries):
        try:
            response = await client.chat.completions.create(
                model=model,
                messages=messages,
                temperature=0.7,
                max_tokens=512,
                stream=False
            )
            
            return {
                "content": response.choices[0].message.content,
                "usage": {
                    "prompt_tokens": response.usage.prompt_tokens,
                    "completion_tokens": response.usage.completion_tokens,
                    "total_tokens": response.usage.total_tokens
                }
            }
        except Exception as e:
            logging.warning(f"API call failed (attempt {attempt + 1}/{max_retries}): {e}")
            if attempt < max_retries - 1:
                await asyncio.sleep(2 ** attempt)  # Async exponential backoff
            else:
                raise

async def summarize_item(item: Dict[str, Any], item_type: str = "project") -> Dict[str, Any]:
    """
    Summarizes description bullets for a single project or work experience item.
    This is an async function.
    """
    if item_type == "work experience":
        title = f"{item.get('job_title', 'Job')} at {item.get('company_name', 'Company')}"
    else:
        title = item.get('project_name', 'Project')
    
    description_bullets = item.get('description_bullets', [])
    
    # If no bullets, just return the original item
    if not description_bullets:
        return item

    system_message = "You are a professional resume writer who creates impactful, concise bullet points that highlight technical achievements and skills."
    description_text = "\n".join(description_bullets)
    
    user_message = f"""Please summarize the following {item_type} description into 2-3 concise bullet points suitable for a resume. 
Each bullet point should:
- Start with a strong action verb
- Highlight key technical skills, technologies, or achievements
- Be clear and impactful for resume readers
- Use professional, achievement-oriented language

{item_type.capitalize()} Title: {title}

Description Bullets:
{description_text}

Provide only the 2-3 bullet points, nothing else. Do not include dashes or any other formatting - just the text of each point on separate lines."""
    
    messages = [
        {"role": "system", "content": system_message},
        {"role": "user", "content": user_message}
    ]
    
    try:
        response = await call_deepseek_api_async(messages)
        raw_summary = response["content"].strip()
        
        # Split into individual bullet points
        bullet_lines = [line.strip().lstrip('•*-–—').strip() 
                       for line in raw_summary.split('\n') 
                       if line.strip()]
        
        # Replace old bullets with new summarized bullets
        item['description_bullets'] = bullet_lines
        logging.info(f"Successfully summarized item: {title}")
        
    except Exception as e:
        logging.error(f"Error summarizing {item_type} '{title}': {e}")
        # If summarization fails, we just log it but return the original item
        # so the API call doesn't fail completely.
    
    return item