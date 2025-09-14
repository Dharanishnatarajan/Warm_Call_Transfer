from fastapi import FastAPI, Query, Request, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
import os, jwt, time, uuid, httpx

# Load env variables
load_dotenv()
LIVEKIT_API_KEY = os.getenv("LIVEKIT_API_KEY")
LIVEKIT_API_SECRET = os.getenv("LIVEKIT_API_SECRET")
LIVEKIT_URL = os.getenv("LIVEKIT_URL")
OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")  # ✅ use OpenRouter, not OpenAI

app = FastAPI()

# CORS setup
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# -------------------
# Token generation
# -------------------
def generate_token(identity: str, room: str):
    iat = int(time.time())
    exp = iat + 24 * 3600
    grant = {
        "room": room,
        "roomJoin": True,
        "canPublish": True,
        "canSubscribe": True
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

@app.get("/")
def root():
    return {"message": "Backend running successfully!"}

@app.get("/token")
def get_token(identity: str = "guest", room: str = "test-room"):
    try:
        token = generate_token(identity, room)
        return JSONResponse({"token": token, "url": LIVEKIT_URL})
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Token generation failed: {str(e)}")

# -------------------
# Summarize Endpoint (OpenRouter)
# -------------------
@app.post("/summarize")
async def summarize(request: Request):
    try:
        body = await request.json()
        transcript = body.get("transcript", "")
        if not transcript:
            return {"summary": "No transcript provided."}

        if not OPENROUTER_API_KEY:
            return {"summary": "OpenRouter API key not configured."}

        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "meta-llama/llama-3.1-8b-instruct",  # ✅ working model
                    "messages": [
                        {
                            "role": "system",
                            "content": "You are a helpful assistant that summarizes phone calls for warm transfers. Focus on call context, key points, and next actions for the new agent."
                        },
                        {
                            "role": "user",
                            "content": f"Transcript:\n{transcript}"
                        }
                    ],
                    "temperature": 0.3,
                    "max_tokens": 250
                },
                timeout=30.0
            )

            if response.status_code != 200:
                print("OpenRouter error:", response.text)
                return {"summary": f"Error generating summary (status {response.status_code})."}

            data = response.json()
            summary = data.get("choices", [{}])[0].get("message", {}).get("content", "Summary not available.")
            if summary.startswith("Summary:"):
                summary = summary.replace("Summary:", "").strip()

        return {"summary": summary}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Summary generation failed: {str(e)}")

# -------------------
# Transfer Endpoint
# -------------------
@app.post("/transfer")
async def transfer(
    original_room: str = Query(...),
    new_room: str = Query(...),
    agent_a: str = Query(...),
    agent_b: str = Query(...),
    transcript: str = Query("")
):
    try:
        token_b = generate_token(agent_b, new_room)
        summary_text = "No transcript provided for summary."

        if transcript and OPENROUTER_API_KEY:
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    "https://openrouter.ai/api/v1/chat/completions",
                    headers={
                        "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                        "Content-Type": "application/json",
                    },
                    json={
                        "model": "meta-llama/llama-3.1-8b-instruct",
                        "messages": [
                            {"role": "system", "content": "Summarize phone calls for warm transfer between agents."},
                            {"role": "user", "content": transcript}
                        ],
                        "temperature": 0.3,
                        "max_tokens": 250,
                    },
                    timeout=30.0
                )

                if response.status_code == 200:
                    data = response.json()
                    summary_text = data.get("choices", [{}])[0].get("message", {}).get("content", "Summary not available.")

        return {
            "agentB_token": token_b,
            "livekit_url": LIVEKIT_URL,
            "summary": summary_text
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transfer process failed: {str(e)}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
