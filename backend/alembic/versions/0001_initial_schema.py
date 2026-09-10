"""initial schema

Creates the pgvector extension and all thirteen tables from the project schema.
Tables are created in foreign-key dependency order and dropped in the reverse.

Revision ID: 0001_initial_schema
Revises:
Create Date: 2026-08-06
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

revision: str = "0001_initial_schema"
down_revision: str | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # pgvector is declared in the stack but no column uses it yet. Enabling it
    # here means the RAG work later is a plain column addition rather than a
    # privileged DDL step. On Neon/Supabase this is permitted; on a locked-down
    # instance it may need a superuser to run it once by hand.
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        "courses",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_courses"),
    )

    op.create_table(
        "users",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        # Named per the brief; the ORM attribute is `hashed_password` so
        # fastapi-users can bind to it unchanged.
        sa.Column("password_hash", sa.String(length=1024), nullable=False),
        sa.Column(
            "role",
            sa.String(length=20),
            server_default="student",
            nullable=False,
        ),
        sa.Column(
            "is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False
        ),
        sa.Column(
            "is_superuser",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "is_verified",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_users"),
        # Enforced at the database because this column decides who reaches
        # admin data.
        sa.CheckConstraint(
            "role IN ('student', 'teacher', 'admin')", name="ck_users_role"
        ),
    )
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_index("ix_users_role", "users", ["role"])

    op.create_table(
        "cert_exams",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("course_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column(
            "default_max_attempts",
            sa.Integer(),
            server_default="3",
            nullable=False,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_cert_exams"),
        sa.ForeignKeyConstraint(
            ["course_id"],
            ["courses.id"],
            name="fk_cert_exams_course_id_courses",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "default_max_attempts >= 1",
            name="ck_cert_exams_default_max_attempts_positive",
        ),
    )
    op.create_index("ix_cert_exams_course_id", "cert_exams", ["course_id"])

    op.create_table(
        "enrollments",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("course_id", sa.Uuid(), nullable=False),
        sa.Column(
            "enrolled_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_enrollments"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_enrollments_user_id_users",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["course_id"],
            ["courses.id"],
            name="fk_enrollments_course_id_courses",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "user_id", "course_id", name="uq_enrollments_user_course"
        ),
    )
    op.create_index("ix_enrollments_user_id", "enrollments", ["user_id"])
    op.create_index("ix_enrollments_course_id", "enrollments", ["course_id"])

    op.create_table(
        "modules",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("course_id", sa.Uuid(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("order", sa.Integer(), nullable=False),
        # Fed into the Gemini Live system instruction to ground the tutor.
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_modules"),
        sa.ForeignKeyConstraint(
            ["course_id"],
            ["courses.id"],
            name="fk_modules_course_id_courses",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint("course_id", "order", name="uq_modules_course_order"),
        sa.CheckConstraint('"order" >= 0', name="ck_modules_order_non_negative"),
    )
    op.create_index("ix_modules_course_id", "modules", ["course_id"])

    op.create_table(
        "attempt_grants",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("cert_exam_id", sa.Uuid(), nullable=False),
        sa.Column("extra_attempts_granted", sa.Integer(), nullable=False),
        sa.Column("granted_by", sa.Uuid(), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column(
            "ts",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_attempt_grants"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_attempt_grants_user_id_users",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["cert_exam_id"],
            ["cert_exams.id"],
            name="fk_attempt_grants_cert_exam_id_cert_exams",
            ondelete="CASCADE",
        ),
        # RESTRICT, not CASCADE: removing an admin must not silently revoke
        # attempts students were already granted.
        sa.ForeignKeyConstraint(
            ["granted_by"],
            ["users.id"],
            name="fk_attempt_grants_granted_by_users",
            ondelete="RESTRICT",
        ),
        sa.CheckConstraint(
            "extra_attempts_granted >= 1",
            name="ck_attempt_grants_extra_attempts_positive",
        ),
    )
    op.create_index("ix_attempt_grants_user_id", "attempt_grants", ["user_id"])
    op.create_index(
        "ix_attempt_grants_cert_exam_id", "attempt_grants", ["cert_exam_id"]
    )
    op.create_index(
        "ix_attempt_grants_user_exam", "attempt_grants", ["user_id", "cert_exam_id"]
    )

    op.create_table(
        "cert_attempts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("cert_exam_id", sa.Uuid(), nullable=False),
        sa.Column("attempt_number", sa.Integer(), nullable=False),
        sa.Column("score", sa.Numeric(precision=5, scale=2), nullable=False),
        sa.Column("passed", sa.Boolean(), nullable=False),
        sa.Column(
            "ts",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_cert_attempts"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_cert_attempts_user_id_users",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["cert_exam_id"],
            ["cert_exams.id"],
            name="fk_cert_attempts_cert_exam_id_cert_exams",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "user_id",
            "cert_exam_id",
            "attempt_number",
            name="uq_cert_attempts_sequence",
        ),
        sa.CheckConstraint(
            "attempt_number >= 1", name="ck_cert_attempts_attempt_number_positive"
        ),
        sa.CheckConstraint(
            "score >= 0 AND score <= 100", name="ck_cert_attempts_score_range"
        ),
    )
    op.create_index("ix_cert_attempts_user_id", "cert_attempts", ["user_id"])
    op.create_index("ix_cert_attempts_cert_exam_id", "cert_attempts", ["cert_exam_id"])
    # On the hot path of the attempt-limit gate, which counts by (user, exam).
    op.create_index(
        "ix_cert_attempts_user_exam", "cert_attempts", ["user_id", "cert_exam_id"]
    )

    op.create_table(
        "certificates",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("cert_exam_id", sa.Uuid(), nullable=False),
        sa.Column(
            "issued_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_certificates"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_certificates_user_id_users",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["cert_exam_id"],
            ["cert_exams.id"],
            name="fk_certificates_cert_exam_id_cert_exams",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "user_id", "cert_exam_id", name="uq_certificates_user_exam"
        ),
    )
    op.create_index("ix_certificates_user_id", "certificates", ["user_id"])
    op.create_index("ix_certificates_cert_exam_id", "certificates", ["cert_exam_id"])

    op.create_table(
        "module_progress",
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("module_id", sa.Uuid(), nullable=False),
        sa.Column(
            "status",
            sa.String(length=20),
            server_default="not_started",
            nullable=False,
        ),
        sa.Column(
            "last_position", sa.Integer(), server_default="0", nullable=False
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        # Composite natural key: one progress row per student per module is a
        # database guarantee, not an application convention.
        sa.PrimaryKeyConstraint("user_id", "module_id", name="pk_module_progress"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_module_progress_user_id_users",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["module_id"],
            ["modules.id"],
            name="fk_module_progress_module_id_modules",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "last_position >= 0",
            name="ck_module_progress_last_position_non_negative",
        ),
        sa.CheckConstraint(
            "status IN ('not_started', 'in_progress', 'completed')",
            name="ck_module_progress_status",
        ),
    )
    op.create_index("ix_module_progress_user_id", "module_progress", ["user_id"])
    op.create_index("ix_module_progress_module_id", "module_progress", ["module_id"])

    op.create_table(
        "quiz_attempts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        # The brief calls this `quiz_id`, but there is no `quizzes` table --
        # `quiz_questions` is keyed by module, so a quiz is a module's question
        # set. Flagged for confirmation.
        sa.Column("module_id", sa.Uuid(), nullable=False),
        sa.Column("score", sa.Numeric(precision=5, scale=2), nullable=False),
        # A counter for reporting only. Quizzes have unlimited retakes; nothing
        # anywhere caps this.
        sa.Column("attempt_number", sa.Integer(), nullable=False),
        sa.Column(
            "ts",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_quiz_attempts"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_quiz_attempts_user_id_users",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["module_id"],
            ["modules.id"],
            name="fk_quiz_attempts_module_id_modules",
            ondelete="CASCADE",
        ),
        sa.UniqueConstraint(
            "user_id", "module_id", "attempt_number", name="uq_quiz_attempts_sequence"
        ),
        sa.CheckConstraint(
            "attempt_number >= 1", name="ck_quiz_attempts_attempt_number_positive"
        ),
        sa.CheckConstraint(
            "score >= 0 AND score <= 100", name="ck_quiz_attempts_score_range"
        ),
    )
    op.create_index("ix_quiz_attempts_user_id", "quiz_attempts", ["user_id"])
    op.create_index("ix_quiz_attempts_module_id", "quiz_attempts", ["module_id"])
    op.create_index(
        "ix_quiz_attempts_user_module", "quiz_attempts", ["user_id", "module_id"]
    )

    op.create_table(
        "quiz_questions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("module_id", sa.Uuid(), nullable=False),
        sa.Column("question", sa.Text(), nullable=False),
        sa.Column("options", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        # Zero-based index into `options`, not the answer text, so grading
        # cannot break when an editor fixes a typo in an option.
        sa.Column("correct_answer", sa.Integer(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_quiz_questions"),
        sa.ForeignKeyConstraint(
            ["module_id"],
            ["modules.id"],
            name="fk_quiz_questions_module_id_modules",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint(
            "correct_answer >= 0", name="ck_quiz_questions_correct_answer_valid"
        ),
    )
    op.create_index("ix_quiz_questions_module_id", "quiz_questions", ["module_id"])

    op.create_table(
        "voice_sessions",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("module_id", sa.Uuid(), nullable=False),
        sa.Column(
            "started_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        # Null while the session is still open.
        sa.Column("ended_at", sa.DateTime(timezone=True), nullable=True),
        # Gemini's session-resumption token. Treated as a secret: never logged,
        # never returned to the browser.
        sa.Column("resumption_handle", sa.Text(), nullable=True),
        # Recorded per session because the Live model is preview-status and
        # will change; without it old transcripts lose that context.
        sa.Column("model_name", sa.String(length=128), nullable=False),
        sa.PrimaryKeyConstraint("id", name="pk_voice_sessions"),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name="fk_voice_sessions_user_id_users",
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["module_id"],
            ["modules.id"],
            name="fk_voice_sessions_module_id_modules",
            ondelete="CASCADE",
        ),
    )
    op.create_index("ix_voice_sessions_user_id", "voice_sessions", ["user_id"])
    op.create_index("ix_voice_sessions_module_id", "voice_sessions", ["module_id"])
    # Admin usage graphs aggregate per user over time (step 10).
    op.create_index(
        "ix_voice_sessions_user_started", "voice_sessions", ["user_id", "started_at"]
    )

    op.create_table(
        "transcripts",
        sa.Column("id", sa.Uuid(), nullable=False),
        sa.Column("session_id", sa.Uuid(), nullable=False),
        sa.Column("role", sa.String(length=10), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column(
            "ts",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        # The only record that barge-in actually fired.
        sa.Column(
            "is_interruption",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.PrimaryKeyConstraint("id", name="pk_transcripts"),
        sa.ForeignKeyConstraint(
            ["session_id"],
            ["voice_sessions.id"],
            name="fk_transcripts_session_id_voice_sessions",
            ondelete="CASCADE",
        ),
        sa.CheckConstraint("role IN ('user', 'model')", name="ck_transcripts_role"),
    )
    op.create_index("ix_transcripts_session_id", "transcripts", ["session_id"])
    op.create_index("ix_transcripts_session_ts", "transcripts", ["session_id", "ts"])


def downgrade() -> None:
    # Reverse of the creation order. Indexes and constraints go with the table.
    for table in (
        "transcripts",
        "voice_sessions",
        "quiz_questions",
        "quiz_attempts",
        "module_progress",
        "certificates",
        "cert_attempts",
        "attempt_grants",
        "modules",
        "enrollments",
        "cert_exams",
        "users",
        "courses",
    ):
        op.drop_table(table)

    # The extension is deliberately left in place: other schemas in the same
    # database may depend on it, and dropping it is not this migration's to
    # undo.
