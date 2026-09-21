"""SQLAlchemy ORM models.

Every model is re-exported here so that importing this package registers all
tables on `Base.metadata` — which is what Alembic's autogenerate diffs against.
Import a model from here, not from its module, so nothing depends on the file
layout.
"""

from __future__ import annotations

from app.models.assignment import (
    Assignment,
    AssignmentSubmission,
    GradedBy,
    MatchMode,
)
from app.models.audit import AuditAction, AuditEvent
from app.models.base import Base, TimestampMixin, uuid_pk
from app.models.cart import CartItem
from app.models.certification import (
    AttemptGrant,
    CertAttempt,
    CertExam,
    Certificate,
)
from app.models.contact import ContactMessage
from app.models.course import Course, Module
from app.models.deletion import DeletionRequest, DeletionStatus, DeletionTarget
from app.models.enrollment import Enrollment, ModuleProgress, ProgressStatus
from app.models.material import ModuleMaterial
from app.models.message import DirectMessage
from app.models.order import Order, OrderStatus
from app.models.org_document import DocumentVisibility, OrganizationDocument
from app.models.organization import Branch, Department, Organization
from app.models.profile import AccessExtension, UserAvatar
from app.models.quiz import QuizAttempt, QuizQuestion
from app.models.subscription import (
    BillingInterval,
    PlanCourse,
    Subscription,
    SubscriptionPlan,
    SubscriptionStatus,
)
from app.models.suspension import SuspensionRequest, SuspensionStatus
from app.models.user import User, UserRole
from app.models.voice import Transcript, TranscriptRole, VoiceSession

__all__ = [
    "AccessExtension",
    "Assignment",
    "AssignmentSubmission",
    "AttemptGrant",
    "AuditAction",
    "AuditEvent",
    "Base",
    "BillingInterval",
    "Branch",
    "CartItem",
    "CertAttempt",
    "CertExam",
    "Certificate",
    "ContactMessage",
    "Course",
    "DeletionRequest",
    "DeletionStatus",
    "DeletionTarget",
    "Department",
    "DirectMessage",
    "DocumentVisibility",
    "Enrollment",
    "GradedBy",
    "MatchMode",
    "Module",
    "ModuleMaterial",
    "ModuleProgress",
    "Order",
    "OrderStatus",
    "Organization",
    "OrganizationDocument",
    "PlanCourse",
    "ProgressStatus",
    "QuizAttempt",
    "QuizQuestion",
    "Subscription",
    "SubscriptionPlan",
    "SubscriptionStatus",
    "SuspensionRequest",
    "SuspensionStatus",
    "TimestampMixin",
    "Transcript",
    "TranscriptRole",
    "User",
    "UserAvatar",
    "UserRole",
    "VoiceSession",
    "uuid_pk",
]
