from typing import Any, Optional


class ApiError(Exception):
    """Exception raised when the Antidetect API returns an error."""

    def __init__(
        self,
        message: str,
        status_code: int = 0,
        code: int = -1,
        body: Optional[Any] = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code
        self.body = body

    def __str__(self) -> str:
        return f"ApiError(status={self.status_code}, code={self.code}): {self.message}"
