"""Build the five Florida agreement PDFs and their digital field coordinates together."""

import json
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.utils import simpleSplit
from reportlab.pdfgen import canvas

DEST = Path(__file__).resolve().parents[1] / "assets" / "real-estate"
WIDTH, HEIGHT = 612, 792
INK, GREEN, MUTED, LINE = (colors.HexColor(value) for value in
                            ("#172e2c", "#316558", "#495e5a", "#bbc9c4"))


def field(key, label, box, *, kind="text", limit=140, optional=False, hint="", choices=None):
    item = {"key": key, "label": label, "box": box, "type": kind, "limit": limit, "required": not optional}
    if hint:
        item["hint"] = hint
    if choices:
        item["options"] = choices
    return item


def dates():
    return [
        field("startDate", "Start date", [48, 389, 153, 32], kind="date", limit=10),
        field("endDate", "Expiration date", [223, 389, 153, 32], kind="date", limit=10),
    ]


def fee(method):
    return [
        field("feeBasis", "Negotiated fee basis", [48, 506, 328, 35], choices=["Flat fee in USD", method]),
        field("feeValue", "Agreed amount or rate", [396, 506, 168, 35], kind="fee", limit=18),
    ]


def listing_fields(rental):
    marketing = field("marketing", "Authorized marketing", [48, 563, 516, 37],
                      choices=["Private outreach", "Public advertising", "Public advertising and eligible MLS entry"])
    items = [
        field("owner", "Owner legal name", [48, 157, 247, 34], limit=120, hint="Individual or entity holding title"),
        field("coOwner", "Second owner legal name", [317, 157, 247, 34], limit=120, optional=True),
        field("brokerage", "Listing brokerage legal name", [48, 211, 328, 34], limit=120),
        field("brokerLicense", "Florida brokerage license number", [396, 211, 168, 34], limit=40),
        field("address", "Florida property address", [48, 265, 328, 40], limit=160, hint="Street, unit, city, and ZIP"),
        field("county", "Florida county", [396, 265, 168, 40], limit=55),
        field("propertyDescription", "Property description or county parcel ID", [48, 323, 516, 44],
              limit=220, hint="Identify the real property and any included unit or parcel"),
        *dates(),
        field("price", "Monthly asking rent (USD)" if rental else "Asking price (USD)",
              [396, 389, 168, 32], kind="money", limit=16),
        field("offerTerms", "Proposed lease terms" if rental else "Proposed sale terms", [48, 440, 516, 45],
              limit=220, hint="Lease length, availability, and deposit terms" if rental else "Financing, inclusions, exclusions, or other offering terms"),
        *fee("Percent of initial lease base rent" if rental else "Percent of final sale price"),
    ]
    if rental:
        items.append(field("appointment", "Rental appointment", [48, 563, 232, 37],
                           choices=["Exclusive right to lease", "Exclusive agency", "Open rental listing"]))
        marketing["box"] = [300, 563, 264, 37]
    return items + [marketing, field("access", "Showing and access instructions", [48, 623, 516, 41],
                                     optional=True, limit=200, hint="Scheduling instructions and occupancy restrictions")]


REFERRAL_FIELDS = [
    field("referringFirm", "Referring brokerage legal name", [48, 157, 290, 34], limit=120),
    field("referringLicense", "Referring license jurisdiction and number", [359, 157, 205, 34], limit=75),
    field("receivingFirm", "Receiving brokerage legal name", [48, 211, 290, 34], limit=120),
    field("receivingLicense", "Receiving Florida brokerage license number", [359, 211, 205, 34], limit=40),
    field("client", "Referred client name", [48, 265, 290, 40], limit=120),
    field("transaction", "Covered transaction", [359, 265, 205, 40],
          choices=["Buyer purchase", "Seller sale", "Landlord lease", "Tenant lease"]),
    field("scope", "Florida property, area, and scope of referral", [48, 323, 516, 44],
          limit=220, hint="Identify the property or search area and the business being referred"),
    *dates(),
    field("payDays", "Payment due in calendar days", [396, 389, 168, 32], kind="days", limit=4,
          hint="After the transaction and fee collection"),
    field("introduction", "Introduction and follow-up instructions", [48, 440, 516, 45],
          optional=True, limit=220, hint="How the client has agreed to be introduced"),
    *fee("Percent of receiving brokerage compensation"),
    field("exclusions", "Excluded clients, properties, or transactions", [48, 563, 516, 45],
          optional=True, limit=220),
]

LISTING_ROLES = [
    {"role": "Brokerage representative"},
    {"role": "Owner", "nameKey": "owner"},
    {"role": "Second owner", "nameKey": "coOwner", "when": "coOwner"},
]
REFERRAL_ROLES = [{"role": "Referring broker"}, {"role": "Receiving broker"}]

FORMS = [
    ("fl-exclusive-right-of-sale", "Exclusive Right of Sale Listing Agreement", "sale",
     "One listing brokerage earns the agreed fee on a qualifying sale, whoever finds the buyer.",
     "Owner appoints Brokerage as the exclusive listing broker. If Owner enters a binding sale contract during the listing term and the sale closes, Owner will pay Brokerage the page 1 fee at closing. This applies whether Brokerage, Owner, or another person procures the buyer."),
    ("fl-exclusive-agency-listing", "Exclusive Agency Listing Agreement", "sale",
     "One listing brokerage markets the property. The owner retains the independent-sale exception.",
     "Owner appoints Brokerage as the sole listing broker. Owner will pay the page 1 fee at closing on a sale contracted during the term through Brokerage or another broker. An owner who independently procures the buyer, without a broker procuring that buyer, owes no listing fee on that sale."),
    ("fl-open-listing", "Open Listing Agreement", "sale",
     "The owner may engage several brokers. This brokerage earns its fee when it procures the buyer.",
     "Owner gives Brokerage a nonexclusive appointment and may engage others or sell directly. Brokerage earns the page 1 fee only if its efforts procure the buyer, Owner enters a binding sale contract with that buyer during the term, and the sale closes. The fee is payable at that closing."),
    ("fl-rental-listing", "Residential Rental Listing Agreement", "rental",
     "A landlord appoints a brokerage to find a tenant and chooses the type of rental listing.",
     "Owner appoints Brokerage under the option selected on page 1. Exclusive right to lease covers a tenant found by anyone. Exclusive agency appoints only Brokerage and exempts a tenant independently procured by Owner without a broker. An open rental listing allows other brokers and pays Brokerage only for a tenant it procures. In each qualifying case, Owner pays the agreed fee when Owner and tenant execute an initial lease during the term."),
    ("fl-broker-referral", "Broker-to-Broker Referral Agreement", "referral",
     "Two licensed brokerages agree on a client introduction, the referral fee, and payment timing.", ""),
]

NEGOTIATION = "Brokerage fees are fully negotiable. No law sets a fee or commission rate."


def provisions(kind, appointment):
    if kind == "referral":
        return [
            ("Referral and client choice", "Referring Brokerage will introduce the named client to Receiving Brokerage for the Florida business described on page 1. The client chooses whom to engage. Before sharing private contact details, Referring Brokerage will obtain the client's permission. Both firms will use the information for the agreed introduction and transaction."),
            ("Qualifying transaction", "The first covered sale that closes or lease that is executed within the stated term qualifies, subject to the written exclusions. Receiving Brokerage earns and collects real estate brokerage compensation on the referred side of that transaction before it owes a referral fee."),
            ("Fee and payment", "Receiving Brokerage will pay Referring Brokerage the flat amount or agreed percentage on page 1. A percentage uses the compensation actually received for the referred side, after external co-broker shares and client credits and before internal agent splits. Payment is due within the stated number of calendar days after both the transaction and collection occur. The firms will retain a record of the calculation and payment."),
            ("Licenses and scope", "Both signers act for licensed real estate brokerages. Each firm will verify the other's license and observe the rules of each jurisdiction where it acts. Receiving Brokerage will conduct Florida brokerage work under its Florida license. The fee covers real estate brokerage services only. Mortgage, title, insurance, and other settlement-service referrals fall outside this agreement."),
            ("Term and changes", "The agreement takes effect once both brokerages sign and the start date arrives. It expires at the end of the stated expiration date in the Florida market named on page 1. A fee on a transaction that qualified during the term remains payable when collected. Both brokerages must sign any amendment. Florida law governs."),
        ]
    if kind == "rental":
        services = "Brokerage will market as authorized, arrange lawful showings, present applications and proposals, and assist lease negotiations. Owner chooses the tenant using lawful, consistent criteria and signs the lease. Owner retains rent collection, deposit handling, and property management. This appointment covers residential leasing without a purchase option."
        pricing = "A percentage fee uses base rent payable over the initial signed lease term, excluding deposits, utilities, and renewal periods. Any payment to a tenant representative requires Owner's separate written authority stating the amount or rate before Brokerage offers or pays it."
    else:
        services = "Brokerage acts as a Florida transaction broker under section 475.278(2). It will market as authorized, arrange showings, present offers promptly, handle funds properly, use care and diligence, deal fairly, maintain limited confidentiality, and disclose known, material facts affecting value that a buyer cannot readily observe. Owner decides whether to accept an offer and signs any sale contract."
        pricing = "A percentage fee uses the final sale price at closing. Any payment to a buyer representative requires Owner's separate written authority stating the amount or rate before Brokerage offers or pays it. A qualifying sale contracted during the term may close after expiration."
    return [
        ("Appointment and fee trigger", appointment),
        ("Brokerage services", services),
        ("Authority and property information", "Owner confirms authority to offer the property and will give Brokerage accurate information, disclose known material conditions, and arrange lawful access subject to occupancy rights. Both parties will follow fair housing law. Advertising follows the selection on page 1 and applicable listing-service rules. Owner's written approval is required for additional expenses."),
        ("Compensation terms", pricing),
        ("Expiration and signed copies", "The listing starts once all parties sign and the stated start date arrives. It expires automatically at 11:59 p.m. at the property on the stated expiration date. The parties may amend or terminate it earlier by signed agreement. Florida law governs. Brokerage will give each owner a legible, accurate signed copy within 24 hours of obtaining the written listing."),
    ]


def signature_slots():
    slots = []
    for top in (542, 605, 668):
        slots.append({"text": [48, top + 12, 151, 32], "signature": [218, top, 208, 44],
                      "date": [447, top + 9, 117, 35]})
    return slots


def generate(form, spec, rows):
    slug, title, kind, description, appointment = form
    pdf = canvas.Canvas(str(DEST / (slug + ".pdf")), pagesize=(WIDTH, HEIGHT), invariant=1, pageCompression=1)
    pdf.setTitle(title)
    pdf.setAuthor("LumoDossier")
    pdf.setSubject("Florida residential real estate | " + description)

    def text(x, top, value, face="Helvetica", size=10, color=INK):
        pdf.setFillColor(color)
        pdf.setFont(face, size)
        pdf.drawString(x, HEIGHT - top, value)

    def rule(left, right, top, color=LINE):
        pdf.setStrokeColor(color)
        pdf.setLineWidth(.6)
        pdf.line(left, HEIGHT - top, right, HEIGHT - top)

    def paragraph(value, top, size=10.2, leading=13.1):
        for line in simpleSplit(value, "Helvetica", size, 516):
            text(48, top, line, size=size)
            top += leading
        return top

    def header():
        text(48, 45, "LumoDossier", "Times-Bold", 16)
        pdf.setFillColor(GREEN)
        pdf.setFont("Helvetica-Bold", 9)
        pdf.drawRightString(564, HEIGHT-44, "FLORIDA  /  RESIDENTIAL BROKERAGE")
        rule(48, 564, 58, GREEN)

    def footer(number):
        rule(48, 564, 742)
        text(48, 761, title, size=8.5, color=MUTED)
        pdf.setFont("Helvetica", 9)
        pdf.drawRightString(564, HEIGHT-761, str(number) + " / 2")
        pdf.showPage()

    header()
    text(47, 97, title, "Times-Roman", 27)
    paragraph(description, 119, 10, 12)
    for item in spec["inputs"]:
        x, top, width, height = item["box"]
        text(x, top - 5, item["label"] + (" (optional)" if not item["required"] else ""),
             "Helvetica-Bold", 8.4, GREEN)
        rule(x, x + width, top + height)
    pdf.setFillColor(colors.HexColor("#edf4f0"))
    pdf.roundRect(48, HEIGHT - 718, 516, 32, 4, fill=1, stroke=0)
    text(58, 706, NEGOTIATION, "Helvetica-Bold", 10.7)
    footer(1)
    header()
    text(47, 93, "Agreement terms", "Times-Roman", 24)
    top = 117
    for label, wording in provisions(kind, appointment):
        text(48, top, label, "Helvetica-Bold", 11, GREEN)
        top = paragraph(wording, top+15) + 8
    if top > 503:
        raise ValueError(f"{slug}: provisions overlap signatures at {top}")
    text(48, 515, "Acceptance and signatures", "Times-Bold", 15)
    for left, label in [(48,"Signer / printed name"),(218,"Signature"),(447,"Date signed")]:
        text(left, 532, label, "Helvetica-Bold", 8.5, MUTED)
    for role, slot in zip(spec["signers"], rows):
        x, top, _, _ = slot["text"]
        text(x, top - 4, role["role"] + (" (if named)" if "when" in role else ""),
             "Helvetica", 8.4, GREEN)
        for x, y, w, h in slot.values():
            rule(x, x + w, y + h + 2)
    footer(2)
    pdf.save()


if __name__ == "__main__":
    specs = {
        "sale": {"inputs": listing_fields(False), "signers": LISTING_ROLES},
        "rental": {"inputs": listing_fields(True), "signers": LISTING_ROLES},
        "referral": {"inputs": REFERRAL_FIELDS, "signers": REFERRAL_ROLES},
    }
    rows = signature_slots()
    forms = []
    for form in FORMS:
        slug, title, kind, description, _ = form
        generate(form, specs[kind], rows)
        forms.append({"id":slug, "title":title, "kind":kind, "description":description})
    manifest = {"templates":forms, "specs":specs, "signaturePage":1, "signatureSlots":rows}
    (DEST / "florida.json").write_bytes((json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode())
