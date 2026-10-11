"""AI mind-map generation routes with SSE streaming."""
import json
from typing import AsyncGenerator

import httpx
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from .. import config
from ..schemas import AIGenerateRequest
from ..auth import get_current_user
from ..models import User

router = APIRouter(prefix="/api/ai", tags=["ai"])

SYSTEM_PROMPT = """你是一个专业的思维导图生成助手。根据用户的输入主题，生成一个结构化的 JSON 思维导图。

严格要求：
1. 只输出合法的 JSON，不要包含任何其他文字或 markdown 标记
2. 格式：{"text": "中心主题", "children": [{"text": "分支1", "children": [...]}, ...]}
3. 中心主题使用用户的输入
4. 生成 3-6 个一级分支
5. 每个一级分支下可有 2-4 个二级分支
6. 二级分支下最多再有 1-2 个三级分支
7. 内容要专业、有深度、条理清晰
8. 文本简洁，每个节点不超过 15 个字"""


async def _stream_ai(prompt: str) -> AsyncGenerator[str, None]:
    """Stream DeepSeek API response as SSE events."""
    headers = {
        "Authorization": f"Bearer {config.AI_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": config.AI_MODEL,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        "stream": True,
        "temperature": 0.7,
        "max_tokens": 4096,
    }

    async with httpx.AsyncClient(timeout=60) as client:
        async with client.stream(
            "POST",
            f"{config.AI_BASE_URL}/chat/completions",
            headers=headers,
            json=payload,
        ) as response:
            if response.status_code != 200:
                error_body = await response.aread()
                yield f"data: {json.dumps({'error': error_body.decode()})}\n\n"
                yield "data: [DONE]\n\n"
                return

            async for line in response.aiter_lines():
                if not line.startswith("data: "):
                    continue
                chunk = line[6:]  # strip "data: "
                if chunk.strip() == "[DONE]":
                    break
                try:
                    data = json.loads(chunk)
                    delta = data.get("choices", [{}])[0].get("delta", {})
                    content = delta.get("content", "")
                    if content:
                        yield f"data: {json.dumps({'content': content})}\n\n"
                except json.JSONDecodeError:
                    continue

    yield "data: [DONE]\n\n"


@router.post("/generate")
def generate(
    req: AIGenerateRequest,
    user: User | None = Depends(get_current_user),
):
    """Stream AI-generated mind map JSON via SSE.

    Both authenticated users and guests can use this endpoint.
    """
    return StreamingResponse(
        _stream_ai(req.prompt),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable nginx buffering
        },
    )
