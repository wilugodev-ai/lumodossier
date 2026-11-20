"""Regenerate the blank, public real estate forms from the bundled print layout."""

import json
from pathlib import Path

from reportlab.lib import colors
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1] / "assets" / "real-estate"
CATALOG = json.loads((ROOT / "catalog.json").read_text(encoding="utf-8"))
WIDTH, HEIGHT = CATALOG["page"]
BOXES = CATALOG["layout"]
INK = colors.HexColor("#172e2c")
GREEN = colors.HexColor("#36665c")
MUTED = colors.HexColor("#506564")
LINE = colors.HexColor("#aebeb9")


def render(form):
    pdf = canvas.Canvas(str(ROOT / (form["id"] + ".pdf")), pagesize=(WIDTH, HEIGHT),
                        invariant=1, pageCompression=1)
    pdf.setTitle(form["title"])
    pdf.setAuthor("LumoDossier")
    pdf.setSubject(form["description"])

    def text(x, top, content, face="Helvetica", size=10, color=INK):
        pdf.setFillColor(color)
        pdf.setFont(face, size)
        pdf.drawString(x, HEIGHT - top, content)

    def rule(x1, x2, top, color=LINE, weight=0.65):
        pdf.setStrokeColor(color)
        pdf.setLineWidth(weight)
        pdf.line(x1, HEIGHT - top, x2, HEIGHT - top)

    text(48, 47, "LumoDossier", "Times-Bold", 17)
    text(475, 46, "REAL ESTATE", "Helvetica-Bold", 10, GREEN)
    rule(48, 564, 63, GREEN, 1.2)
    text(47, 106, form["title"], "Times-Roman", 31)
    text(48, 130, form["description"], size=10.5, color=MUTED)

    for key, label in [("address", "Property address / unit"), ("eventDate", form["dateLabel"])]:
        x, top, width, height = BOXES[key]
        text(x, top - 5, label, "Helvetica-Bold", 10, GREEN)
        rule(x, x + width, top + height)

    text(48, 260, form["section"], "Times-Bold", 16)
    for field, (x, top, width, height) in zip(form["details"], BOXES["rows"], strict=True):
        text(48, top + 22, field["label"], "Helvetica-Bold", 10)
        if field.get("options"):
            text(48, top + 37, " / ".join(field["options"]), size=8, color=MUTED)
        rule(48, 564, top + height + 2)

    text(48, 547, "Signatures", "Times-Bold", 16)
    text(48, 567, form["acknowledgment"], size=10, color=MUTED)
    for index, role in enumerate(form["roles"]):
        x, top, width, height = BOXES["signature"][index]
        text(x, top - 5, role + " signature", "Helvetica-Bold", 10, GREEN)
        rule(x, x + width, top + height + 2)
        x, top, width, height = BOXES["signedDate"][index]
        text(x, top - 5, "Date signed", size=9, color=MUTED)
        rule(x, x + width, top + height + 2)

    rule(48, 564, 744)
    text(48, 763, "lumodossier.com", size=9, color=MUTED)
    pdf.setFont("Helvetica", 9)
    pdf.drawRightString(564, HEIGHT - 763, "1 / 1")
    pdf.showPage()
    pdf.save()


if __name__ == "__main__":
    for template in CATALOG["templates"]:
        render(template)
