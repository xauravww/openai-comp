require('dotenv').config();
const express = require('express');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Utilities for logging
function makeReqId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function redactHeaders(headers) {
  const clone = { ...(headers || {}) };
  Object.keys(clone).forEach((k) => {
    const lk = k.toLowerCase();
    if ([
      'authorization',
      'proxy-authorization',
      'x-api-key',
      'api-key',
      'x-openai-api-key',
      'cookie',
      'set-cookie'
    ].includes(lk)) {
      clone[k] = '[REDACTED]';
    }
  });
  return clone;
}

function truncate(val, max = 5000) {
  try {
    const s = typeof val === 'string' ? val : JSON.stringify(val);
    if (s == null) return '';
    return s.length > max ? s.slice(0, max) + `... [truncated ${s.length - max} chars]` : s;
  } catch {
    return '[Unserializable]';
  }
}

function requestLogger(req, res, next) {
  req.id = req.id || makeReqId();
  const start = Date.now();
  const headers = redactHeaders(req.headers || {});
  console.log(JSON.stringify({
    level: 'info',
    type: 'request_in',
    id: req.id,
    method: req.method,
    url: req.originalUrl,
    ip: req.ip,
    query: req.query,
    headers,
    body: truncate(req.body)
  }));

  res.on('finish', () => {
    console.log(JSON.stringify({
      level: 'info',
      type: 'response_out',
      id: req.id,
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration_ms: Date.now() - start,
      content_length: res.getHeader('content-length')
    }));
  });

  next();
}

// Axios instance - only error logging
const axiosInstance = axios.create();
axiosInstance.interceptors.response.use((response) => {
  return response;
}, (error) => {
  console.error(`[ERROR] Upstream request failed: ${error.config?.url || 'unknown'} - ${error.message}`);
  return Promise.reject(error);
});

// Middleware to parse JSON bodies
app.use(express.json({ limit: '1000mb' }));
app.use(requestLogger);

// Helpers to produce OpenAI-compatible responses
function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

function makeChatCompletionId() {
  return 'chatcmpl-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function extractTextFromUpstream(upstream) {
  // Try common shapes; fallback to stringified body
  try {
    if (!upstream) return '';
    if (typeof upstream === 'string') return upstream;
    if (upstream.choices && upstream.choices.length) {
      const c0 = upstream.choices[0];
      if (c0.message && typeof c0.message.content === 'string') return c0.message.content;
      if (typeof c0.text === 'string') return c0.text;
      if (c0.delta && typeof c0.delta.content === 'string') return c0.delta.content; // in case of chunk
    }
    if (upstream.message && typeof upstream.message.content === 'string') return upstream.message.content;
    if (typeof upstream.content === 'string') return upstream.content;
    if (typeof upstream.text === 'string') return upstream.text;
    return JSON.stringify(upstream);
  } catch {
    return '';
  }
}

function toOpenAIChatCompletion(upstream, model) {
  // If already in OpenAI shape, return as-is
  if (upstream && upstream.object === 'chat.completion' && Array.isArray(upstream.choices)) {
    return upstream;
  }
  const id = makeChatCompletionId();
  const created = nowSeconds();
  const content = extractTextFromUpstream(upstream);
  const usage = upstream && upstream.usage ? upstream.usage : {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0
  };
  return {
    id,
    object: 'chat.completion',
    created,
    model: model || 'gpt-3.5-turbo',
    choices: [
      {
        index: 0,
        message: { role: 'assistant', content },
        logprobs: null,
        finish_reason: 'stop'
      }
    ],
    usage
  };
}

function streamOpenAIFromText(res, text, model) {
  const id = makeChatCompletionId();
  const created = nowSeconds();

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');

  function send(data) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  }

  // Initial chunk with role
  send({
    id,
    object: 'chat.completion.chunk',
    created,
    model: model || 'gpt-3.5-turbo',
    choices: [
      { index: 0, delta: { role: 'assistant' }, logprobs: null, finish_reason: null }
    ]
  });

  // Content chunks
  const size = 500;
  for (let i = 0; i < text.length; i += size) {
    const part = text.slice(i, i + size);
    send({
      id,
      object: 'chat.completion.chunk',
      created,
      model: model || 'gpt-3.5-turbo',
      choices: [
        { index: 0, delta: { content: part }, logprobs: null, finish_reason: null }
      ]
    });
  }

  // Final chunk with finish_reason
  send({
    id,
    object: 'chat.completion.chunk',
    created,
    model: model || 'gpt-3.5-turbo',
    choices: [
      { index: 0, delta: {}, logprobs: null, finish_reason: 'stop' }
    ]
  });
  res.write('data: [DONE]\n\n');
  res.end();
}

// OpenAI-compatible models endpoint
app.get(['/v1/models', '/v1/chat/models'], (req, res) => {
  res.json({
    object: 'list',
    data: [
      {
        id: 'gpt-5',
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'custom',
        permission: [],
        root: 'gpt-5',
        parent: null
      }
    ]
  });
});

// OpenAI-compatible chat completions endpoint
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { model, messages, temperature, max_tokens, stream } = req.body;
    const streamFlag = Boolean(stream);

    // Build the payload for the external API
    const payload = {
      model: model || 'gpt-5',
      parameters: {
        temperature: temperature || 0,
        max_tokens: max_tokens || 8192,
        stream: false,
        stream_options: { include_usage: true },
        stop_sequences: ['<plan_result>', '</plan>']
      },
      persona: 'You are a custom model, a highly skilled software engineer.',
      user_task: {
        objective: 'Respond to the user query based on the conversation.'
      },
      workflow_guidelines: [
        'Understand the user task by analyzing it.',
        'If the environment has many files, search for relevant ones. (Skip if < 10 files).',
        'Read potential files related to the query.',
        'After understanding the files, create a comprehensive plan. This is a mandatory step.',
        'Confirm the plan with the user before executing.'
      ],
      environment: {
        working_directory: process.cwd(),
        open_tabs: [],
        visible_files: []
      },
      messages: messages || []
    };

    let headers = {
      'accept': 'application/json',
      'content-type': 'application/json',
      'user-agent': 'qi/JS 4.73.1',
      'x-stainless-lang': 'js',
      'x-stainless-package-version': '4.73.1',
      'x-stainless-os': 'Linux',
      'x-stainless-arch': 'x64',
      'x-stainless-runtime': 'node',
      'x-stainless-runtime-version': 'v22.17.0',
      'version': '1.1',
      'x-stainless-retry-count': '0',
      'Connection': 'close',
      'x-request-id': req.id,
      'userid': '142678589-9626076655-7454352729-1817530871'
    };

    const response = await axiosInstance.post(
      process.env.AI_URL,
      payload,
      { headers }
    );

    if (streamFlag) {
      const text = extractTextFromUpstream(response.data);
      return streamOpenAIFromText(res, text, model || 'gpt-5');
    }

    const mapped = toOpenAIChatCompletion(response.data, model || 'gpt-5');
    res.json(mapped);
  } catch (error) {
    const status = error.response?.status || 500;
    const upstreamError = error.response?.data?.error;
    const message = upstreamError?.message || error.message || 'Internal server error';
    // Map to OpenAI-like error types
    let type = 'api_error';
    if (status === 400) type = 'invalid_request_error';
    else if (status === 401) type = 'authentication_error';
    else if (status === 403) type = 'permission_error';
    else if (status === 404) type = 'invalid_request_error';
    else if (status === 429) type = 'rate_limit_exceeded';
    else if (status >= 500) type = 'server_error';

    const code = upstreamError?.code || (status >= 400 ? String(status) : null);

    console.error('API Error:', error.response?.data || error.message);
    res.status(status).json({
      error: {
        message,
        type,
        param: upstreamError?.param ?? null,
        code
      }
    });
  }
});

// 404 handler for unmatched routes
app.use((req, res) => {
  console.warn(JSON.stringify({
    level: 'warn',
    type: 'not_found',
    id: req.id || null,
    method: req.method,
    url: req.originalUrl
  }));
  res.status(404).json({
    error: {
      message: `Route not found: ${req.method} ${req.originalUrl}`,
      type: 'invalid_request_error',
      param: null,
      code: 'not_found'
    }
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(JSON.stringify({
    level: 'error',
    type: 'unhandled_error',
    id: req.id || null,
    method: req.method,
    url: req.originalUrl,
    message: err.message,
    stack: err.stack
  }));
  const status = err.status || 500;
  let type = 'api_error';
  if (status === 400) type = 'invalid_request_error';
  else if (status === 401) type = 'authentication_error';
  else if (status === 403) type = 'permission_error';
  else if (status === 404) type = 'invalid_request_error';
  else if (status === 429) type = 'rate_limit_exceeded';
  else if (status >= 500) type = 'server_error';

  res.status(status).json({
    error: {
      message: err.message || 'Internal server error',
      type,
      param: null,
      code: String(status)
    }
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`OpenAI-compatible API server running on port ${PORT}`);
  console.log(`Chat completions endpoint: http://localhost:${PORT}/v1/chat/completions`);
});
