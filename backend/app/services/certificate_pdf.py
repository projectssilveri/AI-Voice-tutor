"""Render a certificate as a PDF.

Step 8: "On pass, issue a certificate (a simple generated PDF is
enough for v1)."

Generated on request rather than stored. The `certificates` row is the record
that the certificate exists; the PDF is a rendering of it, so there is no file
to back up, no storage bucket to configure, and no way for a stored copy to
drift from the row it represents. It is deterministic — the same certificate
always renders identically.

Everything is drawn with reportlab primitives and the built-in Helvetica family
so the output has no external font or image dependency.
"""

from __future__ import annotations

import io
import uuid
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4, landscape
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

# Matches the brand colour the frontend uses (Tailwind brand-500), so a printed
# certificate and the site look like the same product.
BRAND = colors.HexColor("#465FFF")
INK = colors.HexColor("#1D2939")
MUTED = colors.HexColor("#667085")

PAGE_SIZE = landscape(A4)


def _centre_text(
    pdf: canvas.Canvas, y: float, text: str, font: str, size: float, colour: colors.Color
) -> None:
    pdf.setFillColor(colour)
    pdf.setFont(font, size)
    pdf.drawCentredString(PAGE_SIZE[0] / 2, y, text)


def render_certificate(
    *,
    certificate_id: uuid.UUID,
    student_name: str,
    course_title: str,
    exam_title: str,
    score: float | None,
    issued_at: datetime,
) -> bytes:
    """Return the certificate as PDF bytes."""
    buffer = io.BytesIO()
    width, height = PAGE_SIZE
    pdf = canvas.Canvas(buffer, pagesize=PAGE_SIZE)
    pdf.setTitle(f"Certificate — {course_title}")
    pdf.setAuthor("Voice Tutor LMS")
    pdf.setSubject(exam_title)

    # Double border.
    pdf.setStrokeColor(BRAND)
    pdf.setLineWidth(3)
    pdf.rect(12 * mm, 12 * mm, width - 24 * mm, height - 24 * mm)
    pdf.setLineWidth(0.75)
    pdf.setStrokeColor(colors.HexColor("#C7D2FE"))
    pdf.rect(17 * mm, 17 * mm, width - 34 * mm, height - 34 * mm)

    _centre_text(pdf, height - 42 * mm, "VOICE TUTOR LMS", "Helvetica-Bold", 11, BRAND)
    _centre_text(
        pdf, height - 60 * mm, "Certificate of Completion", "Helvetica-Bold", 30, INK
    )

    _centre_text(pdf, height - 78 * mm, "This certifies that", "Helvetica", 12, MUTED)
    _centre_text(pdf, height - 96 * mm, student_name, "Helvetica-Bold", 26, INK)

    # Rule under the name, sized to the text so it frames it at any length.
    name_width = pdf.stringWidth(student_name, "Helvetica-Bold", 26)
    rule = max(name_width + 30 * mm, 90 * mm)
    pdf.setStrokeColor(colors.HexColor("#E4E7EC"))
    pdf.setLineWidth(1)
    pdf.line(
        (width - rule) / 2, height - 102 * mm, (width + rule) / 2, height - 102 * mm
    )

    _centre_text(
        pdf, height - 116 * mm, "has successfully completed", "Helvetica", 12, MUTED
    )
    _centre_text(pdf, height - 132 * mm, course_title, "Helvetica-Bold", 20, BRAND)
    _centre_text(pdf, height - 145 * mm, exam_title, "Helvetica", 12, MUTED)

    if score is not None:
        _centre_text(
            pdf, height - 160 * mm, f"Final score: {score:.0f}%", "Helvetica-Bold", 13, INK
        )

    # Footer: issue date on the left, verification id on the right. The id is
    # the certificates row's primary key, so a printed copy can be checked
    # against the database.
    pdf.setFont("Helvetica", 9)
    pdf.setFillColor(MUTED)
    pdf.drawString(30 * mm, 30 * mm, f"Issued {issued_at.strftime('%d %B %Y')}")
    pdf.drawRightString(width - 30 * mm, 30 * mm, f"Verification ID: {certificate_id}")

    pdf.showPage()
    pdf.save()
    return buffer.getvalue()
