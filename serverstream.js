// serverstream.js
// Streamlined OpenAI-compatible API server with minimal text processing and chalk logging

const express = require('express');

// ANSI color codes for logging
const BLUE = '\x1b[34m';
const YELLOW = '\x1b[33m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

// Constants
const PORT = process.env.PORT || 3001;
const app = express();

// Middleware
app.use(express.json({ limit: '10mb' }));

// Modular logging utilities with chalk
function logInfo(message, id = null) {
  const prefix = id ? `[${id}]` : '';
  console.log(`${BLUE}INFO${prefix}: ${message}${RESET}`);
}

function logWarn(message, id = null) {
  const prefix = id ? `[${id}]` : '';
  console.log(`${YELLOW}WARN${prefix}: ${message}${RESET}`);
}

function logError(message, id = null) {
  const prefix = id ? `[${id}]` : '';
  console.error(`${RED}ERROR${prefix}: ${message}${RESET}`);
}

// Helper to generate request ID
function makeReqId() {
  return Date.now().toString(36) + '-' + Math.random().toString(36).substr(2, 5);
}

// Minimal text processing: Prepend system prompt (if exists) to uppercase of last user message
function processText(messages) {
  let systemPrompt = '';
  let userMessage = '';

  // Extract system prompt if present (first message with role 'system')
  if (messages && messages.length > 0 && messages[0].role === 'system') {
    systemPrompt = messages[0].content + ' ';
  }

  // Find last user message
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === 'user') {
      userMessage = messages[i].content;
      break;
    }
  }

  if (!userMessage) {
    return 'No user message provided.';
  }

  return systemPrompt + userMessage.toUpperCase();
}

// OpenAI-like response formatter
function makeChatCompletion(messages, model = 'minimal-model', reqId) {
  const content = processText(messages);
  const id = `chatcmpl-${reqId}`;
  const created = Math.floor(Date.now() / 1000);

  return {
    id,
    object: 'chat.completion',
    created,
    model,
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        logprobs: null,
        finish_reason: 'stop'
      }
    ],
    usage: { prompt_tokens: 0, completion_tokens: content.length, total_tokens: content.length }
  };
}

// Streaming response function
function streamResponse(res, messages, model = 'minimal-model', reqId) {
  const content = processText(messages);
  const id = `chatcmpl-${reqId}`;
  const created = Math.floor(Date.now() / 1000);

  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });

  // Send initial chunk
  res.write(`data: ${JSON.stringify({
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{ index: 0, delta: { role: 'assistant' }, logprobs: null, finish_reason: null }]
  })}\n\n`);

  // Stream content in chunks
  const chunkSize = 10;
  for (let i = 0; i < content.length; i += chunkSize) {
    const chunk = content.slice(i, i + chunkSize);
    res.write(`data: ${JSON.stringify({
      id,
      object: 'chat.completion.chunk',
      created,
      model,
      choices: [{ index: 0, delta: { content: chunk }, logprobs: null, finish_reason: null }]
    })}\n\n`);
  }

  // Final chunk
  res.write(`data: ${JSON.stringify({
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{ index: 0, delta: {}, logprobs: null, finish_reason: 'stop' }]
  })}\n\n`);
  res.write('data: [DONE]\n\n');
  res.end();

  logInfo(`Streamed response for ${reqId}: ${content.length} chars`, reqId);
}

// Main endpoint: /v1/chat/completions
app.post('/v1/chat/completions', (req, res) => {
  const reqId = makeReqId();
  const { model = 'minimal-model', messages, stream = false, temperature, max_tokens } = req.body;

  logInfo(`Received ${req.method} ${req.url} from ${req.ip}`, reqId);
  logInfo(`Model: ${model}, Stream: ${stream}, Messages: ${messages?.length || 0}`, reqId);

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    logWarn('Invalid messages array', reqId);
    return res.status(400).json({
      error: { message: 'Invalid request: messages must be a non-empty array', type: 'invalid_request_error' }
    });
  }

  // Ignore temperature/max_tokens for minimal impl, but log if set
  if (temperature) logWarn(`Temperature ${temperature} ignored in minimal mode`, reqId);
  if (max_tokens) logWarn(`Max tokens ${max_tokens} ignored in minimal mode`, reqId);

  const responseObj = makeChatCompletion(messages, model, reqId);

  if (stream) {
    streamResponse(res, messages, model, reqId);
  } else {
    logInfo('Sending non-stream response', reqId);
    res.json(responseObj);
  }
});

// Catch-all for other routes
app.use((req, res) => {
  const reqId = makeReqId();
  logWarn(`${req.method} ${req.url} not found`, reqId);
  res.status(404).json({
    error: { message: 'Route not found', type: 'invalid_request_error', code: 'not_found' }
  });
});

// Error handler
app.use((err, req, res, next) => {
  const reqId = req.id || makeReqId();
  logError(err.message || 'Unhandled error', reqId);
  res.status(500).json({
    error: { message: 'Internal server error', type: 'server_error' }
  });
});

// Start server
app.listen(PORT, () => {
  logInfo(`Serverstream running on port ${PORT}`);
  logInfo(`Test with: curl -X POST http://localhost:${PORT}/v1/chat/completions -H "Content-Type: application/json" -d '{"messages":[{"role":"user","content":"Hello"}]}'`);
});