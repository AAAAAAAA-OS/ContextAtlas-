"""Exercise the real bridge and OpenAI SDK using an in-memory HTTP transport."""
import importlib.util
import json
from pathlib import Path
import httpx
from openai import OpenAI

spec = importlib.util.spec_from_file_location("contextatlas_bridge", Path(__file__).parents[1] / "python" / "bridge.py")
bridge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bridge)


def handle(request):
    body = json.loads(request.content)
    echo = dict(path=request.url.path, body=body, authorization=request.headers.get("authorization"))
    return httpx.Response(200, json={"id": "mock", "object": "chat.completion", "created": 1, "model": "mock-model",
        "choices": [{"index": 0, "finish_reason": "stop", "message": {"role": "assistant", "content": json.dumps(echo)}}],
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15}})


def mock_client(**kwargs):
    return OpenAI(**kwargs, http_client=httpx.Client(transport=httpx.MockTransport(handle)))

bridge.OpenAI = mock_client
bridge.main()
