"""One explicit provider, one attempt. No fallbacks or paid-service activation."""
import json
import hashlib
import os
import socket
import time
import urllib.error
import urllib.request
from urllib.parse import urlparse

LOCAL_MODEL = 'Qwen3-4B-Instruct-2507-Q4_K_M'

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

class Provider:
    def __init__(self, endpoint='http://127.0.0.1:18765/v1/chat/completions',
                 model=LOCAL_MODEL, timeout=120, max_requests=200, max_tokens=768,
                 free_tier=False, thinking=False, reasoning_budget=512, transport=None):
        url = urlparse(endpoint)
        self.local = url.scheme == 'http' and url.hostname == '127.0.0.1'
        self.groq = endpoint == 'https://api.groq.com/openai/v1/chat/completions'
        if not self.local and not (self.groq and free_tier):
            raise ValueError('Only loopback or explicitly enabled existing Groq free tier is supported')
        self.key = os.environ.get('GROQ_API_KEY') if self.groq else os.environ.get('FLOSI_SMART_LOCAL_TOKEN')
        if self.groq and not self.key:
            raise ValueError('Existing GROQ_API_KEY is not configured; never paste a key into the UI')
        if not (1 <= timeout <= 180 and 1 <= max_requests <= 1000 and 64 <= max_tokens <= 4096):
            raise ValueError('Invalid provider limits')
        if type(thinking) is not bool or type(reasoning_budget) is not int or not 0 <= reasoning_budget <= 4096:
            raise ValueError('Invalid reasoning settings')
        self.endpoint, self.model, self.timeout = endpoint, model, timeout
        self.max_requests, self.max_tokens, self.attempts = max_requests, max_tokens, 0
        self.thinking, self.reasoning_budget = thinking, reasoning_budget
        self.last_request, self.stopped = 0, None
        self.response_ids = set()
        self.transport = transport
        # External calls retain inherited TLS and proxy configuration. Loopback
        # communication is local and must not go through an external HTTP proxy.
        handlers = [NoRedirect()]
        if self.local:
            handlers.append(urllib.request.ProxyHandler({}))
        self.opener = urllib.request.build_opener(*handlers)

    def complete(self, system, user, schema=None):
        started = time.perf_counter()
        base = {'status': 'error', 'content': None, 'usage': None, 'model': self.model,
                'latencyMs': 0, 'error': None, 'responseId': None,
                'externalInferenceCostUsd': 0 if self.local else None, 'attempt': self.attempts}
        if self.stopped or self.attempts >= self.max_requests:
            return {**base, 'error': self.stopped or 'request_cap'}
        if self.groq and self.last_request and time.monotonic()-self.last_request < 15:
            return {**base, 'error': 'minimum_interval_15s'}
        body = {'model': self.model, 'temperature': 0, 'seed': 42, 'stream': False,
                'messages': [{'role': 'system', 'content': system}, {'role': 'user', 'content': user}]}
        if self.local:
            body.update(max_tokens=self.max_tokens, chat_template_kwargs={'enable_thinking': self.thinking}, cache_prompt=True)
            if self.thinking:
                # llama.cpp b12078 server-common.cpp:1519, OpenAI route.
                body['reasoning_budget_tokens'] = self.reasoning_budget
        else:
            body.update(max_completion_tokens=self.max_tokens, reasoning_effort='low')
        if schema is not None:
            body['response_format'] = {'type': 'json_schema', 'json_schema': {
                'name': 'dictation_edits', 'strict': True, 'schema': schema}}
        base['requestSha256'] = hashlib.sha256(json.dumps(body, ensure_ascii=False, sort_keys=True).encode()).hexdigest()
        headers = {'Content-Type': 'application/json'}
        if self.key:
            headers['Authorization'] = 'Bearer ' + self.key
        self.attempts += 1
        self.last_request = time.monotonic()
        base['attempt'] = self.attempts
        try:
            if self.transport:
                payload = self.transport(body)
            else:
                request = urllib.request.Request(self.endpoint, data=json.dumps(body).encode(), headers=headers, method='POST')
                with self.opener.open(request, timeout=self.timeout) as response:
                    raw = response.read(4*1024*1024 + 1)
                    if len(raw) > 4*1024*1024:
                        raise ValueError('response_limit')
                    payload = json.loads(raw)
            if not isinstance(payload, dict):
                raise ValueError('invalid_envelope')
            # Do not persist arbitrary provider metadata or exceptions.
            usage = payload.get('usage')
            if isinstance(usage, dict) and all(type(usage.get(k)) is int and usage[k] >= 0 for k in ('prompt_tokens', 'completion_tokens', 'total_tokens')) and usage['total_tokens'] == usage['prompt_tokens'] + usage['completion_tokens']:
                base['usage'] = {k: usage[k] for k in ('prompt_tokens', 'completion_tokens', 'total_tokens')}
                details = usage.get('completion_tokens_details')
                reasoning = details.get('reasoning_tokens') if isinstance(details, dict) else None
                if type(reasoning) is int and 0 <= reasoning <= usage['completion_tokens']:
                    base['reasoningTokens'] = reasoning
            returned_model = payload.get('model')
            if returned_model != self.model:
                raise ValueError('unexpected_model')
            choice = payload.get('choices', [])[0]
            if choice.get('finish_reason') != 'stop':
                raise ValueError('truncated' if choice.get('finish_reason') == 'length' else 'unexpected_finish')
            message = choice.get('message', {})
            if message.get('role') != 'assistant' or message.get('tool_calls') or not isinstance(message.get('content'), str) or not message['content'].strip():
                raise ValueError('invalid_content')
            if not base['usage']:
                raise ValueError('invalid_usage')
            content = message['content']
            if self.key and self.key in content:
                raise ValueError('secret_echo')
            if '<think>' in content or '</think>' in content:
                raise ValueError('reasoning_leak')
            response_id = payload.get('id')
            if isinstance(response_id, str) and response_id in self.response_ids:
                raise ValueError('duplicate_response')
            if isinstance(response_id, str):
                self.response_ids.add(response_id)
            base.update(status='ok', content=content, responseId=payload.get('id') if isinstance(payload.get('id'), str) else None)
        except urllib.error.HTTPError as error:
            base['error'] = 'http_' + str(error.code)
            # Do not read an untrusted error body which may echo credentials.
            if error.code in (401, 403, 429) or error.code >= 500:
                self.stopped = base['error']
            error.close()
        except (socket.timeout, TimeoutError):
            base['error'] = 'timeout'
            self.stopped = 'timeout'
        except (ValueError, KeyError, IndexError, TypeError, AttributeError) as error:
            allowed = {'response_limit', 'unexpected_model', 'truncated', 'unexpected_finish', 'invalid_content', 'invalid_usage', 'secret_echo', 'reasoning_leak', 'duplicate_response'}
            base['error'] = str(error) if str(error) in allowed else 'invalid_response'
            self.stopped = 'invalid_response_' + base['error']
        except (urllib.error.URLError, OSError):
            base['error'] = 'network'
            self.stopped = 'network'
        base['latencyMs'] = round((time.perf_counter()-started)*1000, 3)
        return base
