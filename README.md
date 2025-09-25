# OpenAI-Compatible API Proxy

A simple Express.js server that provides an OpenAI-compatible `/v1/chat/completions` endpoint, proxying requests to a custom chat API.

## Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Start the server:**
   ```bash
   npm start
   ```

3. **Server will run on:** `http://localhost:3000`

## API Usage

### Endpoint
```
POST http://localhost:3000/v1/chat/completions
```

### Request Format (OpenAI Compatible)
```bash
curl -X POST http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-5",
    "messages": [
      {"role": "user", "content": "Hello, how are you?"}
    ],
    "temperature": 0.7,
    "max_tokens": 1000
  }'
```

### Request Body Parameters
- `model` (string, optional): Model name (default: "gpt-5")
- `messages` (array): Array of message objects with `role` and `content`
- `temperature` (number, optional): Temperature for response generation (default: 0)
- `max_tokens` (number, optional): Maximum tokens in response (default: 8192)
- `stream` (boolean, optional): Whether to stream response (default: true)

### Example with JavaScript/Node.js
```javascript
const response = await fetch('http://localhost:3000/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'gpt-5',
    messages: [
      { role: 'user', content: 'What is the capital of France?' }
    ],
    temperature: 0.7,
    max_tokens: 1000
  })
});

const data = await response.json();
console.log(data);
```

### Example with Python
```python
import requests

response = requests.post('http://localhost:3000/v1/chat/completions', 
  json={
    "model": "gpt-5",
    "messages": [
      {"role": "user", "content": "What is the capital of France?"}
    ],
    "temperature": 0.7,
    "max_tokens": 1000
  }
)

print(response.json())
```

## Response Format

The API returns responses in OpenAI-compatible format:

```json
{
  "id": "gen-1758781991-gQtHBa6Dp3g1Xxtf2RTu",
  "created": 1758781991,
  "model": "x-ai/grok-code-fast-1",
  "object": "chat.completion",
  "choices": [
    {
      "finish_reason": "stop",
      "index": 0,
      "message": {
        "content": "Paris is the capital of France.",
        "role": "assistant"
      }
    }
  ],
  "usage": {
    "completion_tokens": 291,
    "prompt_tokens": 229,
    "total_tokens": 520
  }
}
```

## Configuration

### Environment Variables
Create a `.env` file (optional):
```
PORT=3000
```

### Custom Port
```bash
PORT=8080 npm start
```

## Files Structure
```
├── server.js          # Main server file
├── package.json       # Dependencies
├── README.md         # This file
└── .env              # Environment variables (optional)
```

## Dependencies
- `express`: Web framework
- `axios`: HTTP client for API requests
- `dotenv`: Environment variable loader

## Error Handling
The API returns OpenAI-compatible error responses:
```json
{
  "error": {
    "message": "Error description",
    "type": "api_error",
    "code": 500
  }
}
```

## Notes
- This proxy translates OpenAI-format requests to the custom API format
- All requests are forwarded to: `https://oi-vscode-server-0501.onrender.com/chat/completions`
- The server includes all required headers for the upstream API