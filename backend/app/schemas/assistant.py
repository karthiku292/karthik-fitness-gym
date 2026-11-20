"""Assistant ask-request and answer-response schemas (stateless; Req 4)."""
from typing import Literal, Optional

from pydantic import BaseModel, Field, field_validator

# The only roles a client may supply for short-term context; the system
# message is authored server-side and is never accepted from the client.
ChatRole = Literal["user", "assistant"]


class ChatMessage(BaseModel):
    role: ChatRole
    content: str = Field(min_length=1, max_length=2000)


class AskRequest(BaseModel):
    question: str = Field(min_length=1, max_length=2000)                    # Req 4.2, 4.3
    recent_messages: list[ChatMessage] = Field(default_factory=list, max_length=10)  # Req 4.4

    @field_validator("question")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        if not v.strip():                                                   # whitespace-only == empty (Req 4.2)
            raise ValueError("question must not be blank")
        return v


class AskResponse(BaseModel):
    answer: str
    ai_configured: bool                        # Configuration Indicator (Req 4.5, 7.3)
    source: Literal["ai", "local"]             # which path produced the answer
    model: Optional[str] = None                # AI_MODEL when source == "ai", else None
