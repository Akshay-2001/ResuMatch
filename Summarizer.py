import json
import os
import time
import logging
from openai import OpenAI

# DeepSeek API configuration
DEEPSEEK_API_KEY = "sk-6eb55d09bf0944a39559b1f65f31cbad"
model = "deepseek-chat"

client = OpenAI(api_key=DEEPSEEK_API_KEY, base_url="https://api.deepseek.com")

# Set up logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(message)s')

def call_deepseek_api(messages, model="deepseek-chat"):
    """Call DeepSeek API for a single request using OpenAI client"""
    max_retries = 3
    for attempt in range(max_retries):
        try:
            response = client.chat.completions.create(
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
                time.sleep(2 ** attempt)  # Exponential backoff
            else:
                raise

def summarize_description_bullets(title, description_bullets, item_type="project"):
    """Summarize description bullets into 2-3 concise bullet points for resume"""
    
    system_message = "You are a professional resume writer who creates impactful, concise bullet points that highlight technical achievements and skills."
    
    # Join the description bullets into a single text
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
        response = call_deepseek_api(messages, model)
        raw_summary = response["content"].strip()
        
        # Split into individual bullet points and return as list
        bullet_lines = [line.strip().lstrip('•*-–—').strip() 
                       for line in raw_summary.split('\n') 
                       if line.strip()]
        
        return {
            "bullets": bullet_lines,
            "input_tokens": response["usage"]["prompt_tokens"],
            "output_tokens": response["usage"]["completion_tokens"],
            "success": True
        }
    except Exception as e:
        logging.error(f"Error summarizing {item_type} '{title}': {e}")
        return {
            "bullets": [],
            "input_tokens": 0,
            "output_tokens": 0,
            "success": False,
            "error": str(e)
        }

def main():
    # Input and output file paths
    input_file = 'D:/Source/UBH2025/input.json'
    output_file = 'D:/Source/UBH2025/summaries.json'
    
    # Check if input file exists
    if not os.path.exists(input_file):
        print(f"Error: Input file '{input_file}' not found!")
        return
    
    # Read the input JSON file
    with open(input_file, 'r', encoding='utf-8') as f:
        data = json.load(f)
    
    work_experiences = data.get('top_work_experiences', [])
    projects = data.get('top_projects', [])
    
    if not work_experiences and not projects:
        print("No work experiences or projects found in the input file!")
        return
    
    print(f"Found {len(work_experiences)} work experience(s) and {len(projects)} project(s) to summarize...\n")
    
    total_input_tokens = 0
    total_output_tokens = 0
    
    # Process work experiences
    summarized_work_experiences = []
    if work_experiences:
        print("=" * 60)
        print("Processing Work Experiences")
        print("=" * 60)
        
        for i, work_ex in enumerate(work_experiences):
            job_title = work_ex.get('job_title', f'Job {i+1}')
            company_name = work_ex.get('company_name', '')
            description_bullets = work_ex.get('description_bullets', [])
            
            print(f"\nSummarizing: {job_title} at {company_name}")
            
            result = summarize_description_bullets(
                f"{job_title} at {company_name}", 
                description_bullets, 
                item_type="work experience"
            )
            
            if result['success']:
                print(f"✓ Summary generated successfully")
                print(f"  Tokens used: {result['input_tokens']} input, {result['output_tokens']} output")
                
                total_input_tokens += result['input_tokens']
                total_output_tokens += result['output_tokens']
                
                # Create work experience entry with all original fields
                work_ex_result = {
                    "work_ex_id": work_ex.get('work_ex_id', ''),
                    "job_title": work_ex.get('job_title', ''),
                    "company_name": work_ex.get('company_name', ''),
                    "location": work_ex.get('location', ''),
                    "start_date": work_ex.get('start_date', ''),
                    "end_date": work_ex.get('end_date', ''),
                    "description_bullets": result['bullets'],
                    "score": work_ex.get('score', 0.0)
                }
                summarized_work_experiences.append(work_ex_result)
            else:
                print(f"✗ Failed to generate summary: {result.get('error', 'Unknown error')}")
                # Keep original if summarization fails
                summarized_work_experiences.append(work_ex)
            
            # Small delay to avoid rate limiting
            if i < len(work_experiences) - 1:
                time.sleep(0.5)
    
    # Process projects
    summarized_projects = []
    if projects:
        print("\n" + "=" * 60)
        print("Processing Projects")
        print("=" * 60)
        
        for i, project in enumerate(projects):
            project_name = project.get('project_name', f'Project {i+1}')
            description_bullets = project.get('description_bullets', [])
            
            print(f"\nSummarizing: {project_name}")
            
            result = summarize_description_bullets(
                project_name, 
                description_bullets, 
                item_type="project"
            )
            
            if result['success']:
                print(f"✓ Summary generated successfully")
                print(f"  Tokens used: {result['input_tokens']} input, {result['output_tokens']} output")
                
                total_input_tokens += result['input_tokens']
                total_output_tokens += result['output_tokens']
                
                # Create project entry with all original fields
                project_result = {
                    "project_id": project.get('project_id', ''),
                    "project_name": project.get('project_name', ''),
                    "repository_url": project.get('repository_url', ''),
                    "description_bullets": result['bullets'],
                    "score": project.get('score', 0.0)
                }
                summarized_projects.append(project_result)
            else:
                print(f"✗ Failed to generate summary: {result.get('error', 'Unknown error')}")
                # Keep original if summarization fails
                summarized_projects.append(project)
            
            # Small delay to avoid rate limiting
            if i < len(projects) - 1:
                time.sleep(0.5)
    
    # Save results to output file - same format as input
    output_data = {
        "work_experiences": summarized_work_experiences,
        "projects": summarized_projects
    }
    
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(output_data, f, indent=4)
    
    print("\n" + "=" * 60)
    print(f"All summaries saved to: {output_file}")
    print(f"Successfully processed:")
    print(f"  - Work Experiences: {len(summarized_work_experiences)}")
    print(f"  - Projects: {len(summarized_projects)}")
    print(f"Total tokens used: {total_input_tokens + total_output_tokens}")
    print(f"  - Input tokens: {total_input_tokens}")
    print(f"  - Output tokens: {total_output_tokens}")
    print("=" * 60)

if __name__ == "__main__":
    main()
