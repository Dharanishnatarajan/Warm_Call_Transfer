# test_openrouter_models.py
import os
from dotenv import load_dotenv
import httpx
import asyncio

load_dotenv()

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY")

async def test_model(model_name):
    try:
        print(f"\nTesting model: {model_name}")
        
        async with httpx.AsyncClient() as client:
            response = await client.post(
                "https://openrouter.ai/api/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {OPENROUTER_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model_name,
                    "messages": [
                        {"role": "system", "content": "You are a helpful assistant that summarizes phone calls."},
                        {"role": "user", "content": "Agent: Hello, how can I help? Customer: I have an issue with my order."}
                    ],
                    "temperature": 0.5,
                    "max_tokens": 100
                },
                timeout=30.0
            )
            
            print(f"Status Code: {response.status_code}")
            
            if response.status_code == 200:
                data = response.json()
                print("✅ Success!")
                print("Summary:", data["choices"][0]["message"]["content"])
                return True
            else:
                print(f"❌ Error: {response.status_code}")
                if response.status_code != 404:  # Don't print full response for 404
                    print("Response:", response.text)
                return False
                
    except Exception as e:
        print(f"❌ Error: {e}")
        return False

async def main():
    # List of models to test
    models = [
        "meta-llama/llama-3.1-8b-instruct",
        "mistralai/mistral-7b-instruct",
        "google/gemini-pro",
        "anthropic/claude-3-haiku",
        "openai/gpt-3.5-turbo",
        "huggingfaceh4/zephyr-7b-beta",
        "microsoft/wizardlm-2-8x22b",
        "cognitivecomputations/dolphin-mixtral-8x7b"
    ]
    
    print("Testing available OpenRouter models...")
    
    working_models = []
    for model in models:
        success = await test_model(model)
        if success:
            working_models.append(model)
    
    print(f"\n🎯 Working models: {working_models}")

if __name__ == "__main__":
    asyncio.run(main())