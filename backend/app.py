from fastapi import FastAPI, Query, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
import os
import jwt
import time
import uuid
import httpx
import asyncio
from typing import Dict, Optional, List
import json
from datetime import datetime
import logging

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load environment variables
load_dotenv()

# Configuration
LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET")
LIVEKIT_URL = os.getenv("LIVEKIT_URL", "ws://localhost:7880")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

# In-memory storage for call sessions and transfers
active_calls: Dict[str, Dict] = {}
transfer_sessions: Dict[str, Dict] = {}
call_transcripts: Dict[str, str] = {}
room_participants: Dict[str, List[str]] = {}

app = FastAPI(title="LiveKit Warm Transfer API", version="1.0.0")

# CORS setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000", 
        "http://localhost:3001",
        "http://localhost:3002",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "http://127.0.0.1:3002"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------
# Utility Functions
# -------------------
def generate_token(identity: str, room: str, can_publish: bool = True, can_subscribe: bool = True):
    """Generate LiveKit JWT token"""
    if not LIVEKIT_API_KEY or not LIVEKIT_API_SECRET:
        raise HTTPException(status_code=500, detail="LiveKit credentials not configured")
    
    iat = int(time.time())
    exp = iat + 24 * 3600  # 24 hours
    
    grant = {
        "room": room,
        "roomJoin": True,
        "canPublish": can_publish,
        "canSubscribe": can_subscribe,
        "canPublishData": True
    }
    
    payload = {
        "jti": str(uuid.uuid4()),
        "iss": LIVEKIT_API_KEY,
        "sub": identity,
        "iat": iat,
        "exp": exp,
        "video": grant
    }
    
    return jwt.encode(payload, LIVEKIT_API_SECRET, algorithm="HS256")

async def generate_summary_with_llm(transcript: str, caller_info: Optional[Dict] = None) -> str:
    """Generate call summary using OpenRouter LLM"""
    if not OPENROUTER_API_KEY or not transcript.strip():
        return "No transcript available for summary generation."
    
    try:
        caller_context = ""
        if caller_info:
            caller_context = f"Caller: {caller_info.get('name', 'Unknown')}\n"
            caller_context += f"Phone: {caller_info.get('phone', 'Unknown')}\n"
            caller_context += f"Issue: {caller_info.get('issue', 'General inquiry')}\n"
        
        system_prompt = """You are an expert call center supervisor creating handoff summaries for warm transfers. 
        Create a concise, professional summary that includes:
        1. Customer's main concern/request
        2. Key details discussed
        3. Current status/progress  
        4. Recommended next steps
        5. Customer sentiment/mood
        
        Keep it under 150 words for quick verbal handoff."""
        
        user_prompt = f"""{caller_context}
Call Transcript:
{transcript}

Please provide a comprehensive warm transfer summary for the next agent."""
        
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "meta-llama/llama-3.1-8b-instruct",
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_prompt}
                    ],
                    "temperature": 0.3,
                    "max_tokens": 200
                }
            )
            
            if response.status_code == 200:
                data = response.json()
                summary = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                return summary.strip()
            else:
                logger.error(f"OpenRouter API error: {response.status_code} - {response.text}")
                return "Unable to generate summary due to API error."
                
    except Exception as e:
        logger.error(f"Summary generation failed: {str(e)}")
        return "Error occurred during summary generation."

async def generate_agent_script(summary: str, agent_b_name: str, caller_name: str) -> str:
    """Generate natural script for Agent A to read during transfer"""
    if not OPENROUTER_API_KEY:
        return f"Hi {agent_b_name}, I have {caller_name} on the line. Here's the summary: {summary}. I'll transfer them over to you now."
    
    try:
        prompt = f"""Create a natural, conversational script for Agent A to read aloud to Agent B ({agent_b_name}) during a warm call transfer.

Customer: {caller_name}
Call Summary: {summary}

Requirements:
- Natural spoken language (not robotic)
- 45-60 seconds reading time
- Include key information from summary
- End with smooth handoff
- Sound professional but friendly
- Direct speech for Agent A to read

Format as a script that Agent A will speak."""
        
        async with httpx.AsyncClient(timeout=20.0) as client:
            response = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "meta-llama/llama-3.1-8b-instruct", 
                    "messages": [
                        {"role": "system", "content": "You create natural conversation scripts for call center warm transfers. Make them sound conversational and professional."},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.4,
                    "max_tokens": 300
                }
            )
            
            if response.status_code == 200:
                data = response.json()
                script = data.get("choices", [{}])[0].get("message", {}).get("content", "")
                return script.strip()
            else:
                return f"Hi {agent_b_name}, I have {caller_name} on the line for you. Here's what's been discussed: {summary}. I'll transfer them over to you now."
                
    except Exception as e:
        logger.error(f"Agent script generation failed: {str(e)}")
        return f"Hi {agent_b_name}, transferring {caller_name} to you. Summary: {summary}"

# -------------------
# API Endpoints
# -------------------

@app.get("/")
def root():
    return {
        "message": "LiveKit Warm Transfer API", 
        "version": "1.0.0",
        "status": "running",
        "timestamp": datetime.now().isoformat()
    }

@app.get("/health")
def health_check():
    return {
        "status": "healthy", 
        "livekit_configured": bool(LIVEKIT_API_KEY and LIVEKIT_API_SECRET),
        "llm_configured": bool(OPENROUTER_API_KEY)
    }

@app.get("/token")
def get_token(identity: str = Query(...), room: str = Query(...)):
    """Generate LiveKit access token - Compatible with existing frontend"""
    try:
        token = generate_token(identity, room)
        logger.info(f"Generated token for {identity} in room {room}")
        return JSONResponse({
            "token": token, 
            "url": LIVEKIT_URL,
            "identity": identity,
            "room": room
        })
    except Exception as e:
        logger.error(f"Token generation failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Token generation failed: {str(e)}")

@app.post("/call/start")
async def start_call(request: Request):
    """Initialize a new call session"""
    try:
        body = await request.json()
        caller_name = body.get("caller_name", f"caller_{uuid.uuid4().hex[:8]}")
        caller_info = body.get("caller_info", {})
        
        call_id = str(uuid.uuid4())
        room_name = f"call_{call_id}"
        
        # Generate tokens
        caller_token = generate_token(caller_name, room_name)
        agent_a_token = generate_token("agent_a", room_name)
        
        # Store call session
        active_calls[call_id] = {
            "call_id": call_id,
            "room_name": room_name,
            "caller_name": caller_name,
            "caller_info": caller_info,
            "agent_a": "agent_a",
            "agent_b": None,
            "status": "active",
            "created_at": datetime.now().isoformat(),
            "transcript": ""
        }
        
        logger.info(f"Started call {call_id} for {caller_name}")
        
        return {
            "call_id": call_id,
            "room_name": room_name,
            "caller_token": caller_token,
            "agent_a_token": agent_a_token,
            "livekit_url": LIVEKIT_URL,
            "status": "initiated"
        }
        
    except Exception as e:
        logger.error(f"Call initialization failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to start call: {str(e)}")

@app.post("/summarize")
async def summarize_call(request: Request):
    """Generate call summary from transcript - Compatible with existing frontend"""
    try:
        body = await request.json()
        transcript = body.get("transcript", "").strip()
        call_id = body.get("call_id")
        caller_info = body.get("caller_info")
        
        if not transcript:
            return {"summary": "No transcript provided for summary generation."}
        
        # Store transcript if call_id provided
        if call_id and call_id in active_calls:
            active_calls[call_id]["transcript"] = transcript
            call_transcripts[call_id] = transcript
        
        summary = await generate_summary_with_llm(transcript, caller_info)
        
        logger.info(f"Generated summary for call {call_id or 'unknown'}")
        return {"summary": summary}
        
    except Exception as e:
        logger.error(f"Summary generation failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Summary generation failed: {str(e)}")

@app.post("/transfer")  
async def initiate_transfer(
    original_room: str = Query(...),
    new_room: str = Query(...), 
    agent_a: str = Query(...),
    agent_b: str = Query(...),
    transcript: str = Query(""),
    caller_name: str = Query("Unknown Caller")
):
    """Initiate warm transfer process - Compatible with existing frontend"""
    try:
        transfer_id = str(uuid.uuid4())
        
        # Generate tokens for transfer room
        agent_a_transfer_token = generate_token(agent_a, new_room)
        agent_b_transfer_token = generate_token(agent_b, new_room)
        caller_final_token = generate_token(caller_name, new_room)
        
        # Generate summary and agent script
        summary = ""
        agent_script = ""
        
        if transcript.strip():
            summary = await generate_summary_with_llm(transcript)
            agent_script = await generate_agent_script(summary, agent_b, caller_name)
        else:
            summary = "No call context available."
            agent_script = f"Hi {agent_b}, I'm transferring {caller_name} to you. Please take over the call."
        
        # Store transfer session
        transfer_sessions[transfer_id] = {
            "transfer_id": transfer_id,
            "original_room": original_room,
            "transfer_room": new_room,
            "agent_a": agent_a,
            "agent_b": agent_b,
            "caller_name": caller_name,
            "summary": summary,
            "agent_script": agent_script,
            "status": "briefing",
            "created_at": datetime.now().isoformat()
        }
        
        logger.info(f"Initiated transfer {transfer_id} from {agent_a} to {agent_b}")
        
        return {
            "transfer_id": transfer_id,
            "agentA_transfer_token": agent_a_transfer_token,
            "agentB_token": agent_b_transfer_token,
            "caller_token": caller_final_token,
            "transfer_room": new_room,
            "livekit_url": LIVEKIT_URL,
            "summary": summary,
            "agent_script": agent_script,
            "status": "initiated"
        }
        
    except Exception as e:
        logger.error(f"Transfer initiation failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Transfer failed: {str(e)}")

@app.post("/transfer/complete")
async def complete_transfer(request: Request):
    """Complete the warm transfer by connecting caller to Agent B"""
    try:
        body = await request.json()
        transfer_id = body.get("transfer_id")
        original_room = body.get("original_room")
        caller_name = body.get("caller_name", "Unknown")
        agent_b = body.get("agent_b")
        
        if not transfer_id or transfer_id not in transfer_sessions:
            raise HTTPException(status_code=404, detail="Transfer session not found")
        
        transfer_session = transfer_sessions[transfer_id]
        
        # Generate token for caller to join agent B's room
        caller_final_token = generate_token(caller_name, transfer_session["transfer_room"])
        
        # Update transfer status
        transfer_session["status"] = "completed" 
        transfer_session["completed_at"] = datetime.now().isoformat()
        
        logger.info(f"Completed transfer {transfer_id}")
        
        return {
            "status": "transfer_completed",
            "caller_token": caller_final_token,
            "final_room": transfer_session["transfer_room"],
            "agent_b": agent_b,
            "livekit_url": LIVEKIT_URL
        }
        
    except Exception as e:
        logger.error(f"Transfer completion failed: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Transfer completion failed: {str(e)}")

@app.get("/calls/latest")
def get_latest_call():
    """Get the most recent active call for Agent A to join automatically"""
    if not active_calls:
        raise HTTPException(status_code=404, detail="No active calls found")
    
    # Get the most recent call
    latest_call = max(active_calls.values(), key=lambda x: x["created_at"])
    
    return {
        "call_id": latest_call["call_id"],
        "room_name": latest_call["room_name"],
        "caller_name": latest_call["caller_name"],
        "status": latest_call["status"],
        "created_at": latest_call["created_at"]
    }

@app.get("/transfers/active")
def get_active_transfers():
    """Get list of active transfer sessions for Agent B to join"""
    active_transfers = [
        {
            "transfer_id": tid,
            "agent_a": session["agent_a"],
            "agent_b": session["agent_b"],
            "caller_name": session["caller_name"],
            "status": session["status"],
            "created_at": session["created_at"],
            "summary": session.get("summary", "")
        }
        for tid, session in transfer_sessions.items()
        if session["status"] == "briefing"
    ]
    return {"active_transfers": active_transfers}

@app.get("/transfer/{transfer_id}")
def get_transfer_status(transfer_id: str):
    """Get transfer session details"""
    if transfer_id not in transfer_sessions:
        raise HTTPException(status_code=404, detail="Transfer not found")
    
    return transfer_sessions[transfer_id]

@app.get("/calls/active")
def get_active_calls():
    """Get list of active calls"""
    return {"active_calls": list(active_calls.values())}

@app.post("/call/end")
async def end_call(request: Request):
    """End a call session"""
    try:
        body = await request.json()
        call_id = body.get("call_id")
        
        if call_id and call_id in active_calls:
            active_calls[call_id]["status"] = "ended"
            active_calls[call_id]["ended_at"] = datetime.now().isoformat()
            
        return {"status": "call_ended", "call_id": call_id}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/room/participants")
async def update_room_participants(request: Request):
    """Update room participants list"""
    try:
        body = await request.json()
        room_name = body.get("room_name")
        participants = body.get("participants", [])
        
        if room_name:
            room_participants[room_name] = participants
            
        return {"status": "updated", "room": room_name, "participants": participants}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/room/{room_name}/participants")
def get_room_participants(room_name: str):
    """Get participants in a room"""
    return {"room": room_name, "participants": room_participants.get(room_name, [])}

@app.get("/caller/{caller_name}/transfer-status")
def get_caller_transfer_status(caller_name: str):
    """Check if there's a completed transfer waiting for this caller"""
    for transfer_id, session in transfer_sessions.items():
        if (session["caller_name"] == caller_name and 
            session["status"] == "completed"):
            # Generate fresh token for caller
            caller_token = generate_token(caller_name, session["transfer_room"])
            return {
                "transfer_complete": True,
                "transfer_id": transfer_id,
                "final_room": session["transfer_room"],
                "agent_b": session["agent_b"],
                "caller_token": caller_token,
                "livekit_url": LIVEKIT_URL
            }
    
    return {"transfer_complete": False}

@app.get("/agent/{agent_name}/transfer-status")
def get_agent_transfer_status(agent_name: str):
    """Check if Agent B should move to final room for completed transfer"""
    for transfer_id, session in transfer_sessions.items():
        if (session["agent_b"] == agent_name and 
            session["status"] == "completed"):
            # Generate fresh token for Agent B
            agent_token = generate_token(agent_name, session["transfer_room"])
            return {
                "transfer_complete": True,
                "transfer_id": transfer_id,
                "final_room": session["transfer_room"],
                "caller_name": session["caller_name"],
                "agent_token": agent_token,
                "livekit_url": LIVEKIT_URL
            }
    
    return {"transfer_complete": False}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")