"""HTTP middleware.

Registration order lives in `app/main.py` and matters: `add_middleware` puts
the most recently added outermost, so CORS is registered last in order to wrap
everything below it (decision 21).
"""

from app.middleware.audit import AuditMiddleware
from app.middleware.nul_bytes import RejectNulBytes

__all__ = ["AuditMiddleware", "RejectNulBytes"]
