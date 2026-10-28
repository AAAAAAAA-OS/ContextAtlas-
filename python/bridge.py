"""Non-streaming OpenAI-compatible transport. No credentials are serialized."""
import concurrent.futures
import hashlib
import json
import os
import sys
import threading
import time
from openai import OpenAI


def request_kwargs(item):
    settings = item["settings"]
    kwargs = dict(model=settings["model"], messages=item["messages"], stream=False,
                  response_format={"type": "json_object"}, max_tokens=settings["maxOutputTokens"])
    if settings.get("reasoningEffort"):
        kwargs["reasoning_effort"] = settings["reasoningEffort"]
    if settings.get("extraBody"):
        kwargs["extra_body"] = settings["extraBody"]
    return kwargs


def main():
    sys.stdin.reconfigure(encoding="utf-8", errors="strict")
    sys.stdout.reconfigure(encoding="utf-8", errors="strict")
    lock = threading.Lock()

    def emit(value):
        with lock:
            print(json.dumps(value, ensure_ascii=True), flush=True)

    def run(item):
        settings = item["settings"]
        key = os.environ["LLM_API_KEY"]
        message_hash = hashlib.sha256(json.dumps(item["messages"], ensure_ascii=False, separators=(",", ":")).encode("utf-8")).hexdigest()
        started = time.monotonic()
        # SDK retries are disabled so the ledger records each explicit retry.
        client = OpenAI(api_key=key, base_url=settings["baseUrl"], max_retries=0, timeout=settings["timeoutSeconds"])
        try:
            for attempt in range(settings["maxRetries"] + 1):
                try:
                    response = client.chat.completions.create(**request_kwargs(item))
                    choice = response.choices[0]
                    emit(dict(id=item["id"], content=choice.message.content, messagesSha256=message_hash,
                              finishReason=choice.finish_reason, providerModel=response.model,
                              usage=response.usage.model_dump() if response.usage else {}, attempts=attempt+1,
                              elapsedSeconds=round(time.monotonic()-started, 3)))
                    return
                except Exception as exc:
                    status = getattr(exc, "status_code", None)
                    kind = type(exc).__name__
                    # Timeouts/connections have an uncertain completion status; do not replay them silently.
                    uncertain = kind in ("APITimeoutError", "APIConnectionError")
                    retry = not uncertain and (status == 429 or (status is not None and status >= 500)) and attempt < settings["maxRetries"]
                    message = str(exc).replace(key, "[REDACTED]")[:1000]
                    emit(dict(id=item["id"], event="provider_error", error=kind, httpStatus=status,
                              message=message, attempt=attempt+1, willRetry=retry))
                    if retry:
                        time.sleep(2 ** attempt)
                        continue
                    emit(dict(id=item["id"], error=kind, httpStatus=status, message=message,
                              messagesSha256=message_hash, uncertain=uncertain, attempts=attempt+1,
                              elapsedSeconds=round(time.monotonic()-started, 3)))
                    return
        finally:
            client.close()

    with concurrent.futures.ThreadPoolExecutor(max_workers=64) as executor:
        for line in sys.stdin:
            if line.strip():
                executor.submit(run, json.loads(line))


if __name__ == "__main__":
    main()
