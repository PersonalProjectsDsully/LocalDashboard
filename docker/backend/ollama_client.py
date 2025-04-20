import requests
import json
import logging

logger = logging.getLogger(__name__)

class OllamaClient:
    def __init__(self, base_url="http://host.docker.internal:11434"):
        self.base_url = base_url
        logger.info(f"Initialized Ollama client with base URL: {self.base_url}")

    def get_models(self):
        """Get all available models from Ollama."""
        try:
            response = requests.get(f"{self.base_url}/api/tags")
            if response.status_code == 200:
                data = response.json()
                models = []
                for model in data.get("models", []):
                    models.append({
                        "id": model["name"],
                        "name": model["name"],
                        "provider": "ollama",
                        "description": f"Ollama model: {model['name']}"
                    })
                return models
            else:
                logger.error(f"Failed to get models from Ollama: {response.status_code} - {response.text}")
                return []
        except Exception as e:
            logger.error(f"Error connecting to Ollama API: {e}")
            # Fallback to some default models
            return [
                {"id": "llama3", "name": "Llama 3", "provider": "ollama", "description": "Meta's Llama 3 model"},
                {"id": "mistral", "name": "Mistral", "provider": "ollama", "description": "Mistral AI's model"}
            ]

    def chat_completion(self, model_id, messages, temperature=0.7):
        """Get a chat completion from Ollama."""
        try:
            # Convert messages to Ollama format
            formatted_messages = []
            for msg in messages:
                formatted_messages.append({
                    "role": msg["role"],
                    "content": msg["content"]
                })

            payload = {
                "model": model_id,
                "messages": formatted_messages,
                "stream": False,
                "temperature": temperature
            }

            logger.info(f"Sending chat request to Ollama for model: {model_id}")
            response = requests.post(
                f"{self.base_url}/api/chat", 
                json=payload,
                headers={"Content-Type": "application/json"}
            )

            if response.status_code == 200:
                data = response.json()
                return {
                    "id": f"resp_{data.get('created', 0)}",
                    "role": "assistant",
                    "content": data.get("message", {}).get("content", "No response from model"),
                    "model": model_id
                }
            else:
                logger.error(f"Ollama API error: {response.status_code} - {response.text}")
                return {
                    "id": f"error_{int(time.time())}",
                    "role": "assistant",
                    "content": f"Error from Ollama API: {response.status_code}. The model may not be available or there might be a connection issue.",
                    "model": model_id
                }
        except Exception as e:
            logger.error(f"Error in chat completion: {e}", exc_info=True)
            return {
                "id": f"error_{int(time.time())}",
                "role": "assistant",
                "content": f"Failed to communicate with Ollama: {str(e)}",
                "model": model_id
            }
