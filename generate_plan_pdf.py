"""
Generate Famto Microservice Migration Plan PDF
"""
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm, inch
from reportlab.lib.colors import HexColor, white, black
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_JUSTIFY
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    PageBreak, KeepTogether, HRFlowable
)
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from datetime import datetime

# ── Colors ───────────────────────────────────────────────
BRAND_DARK   = HexColor("#0f172a")   # slate-900
BRAND_BLUE   = HexColor("#0ea5e9")   # sky-500
BRAND_GREEN  = HexColor("#10b981")   # emerald-500
ACCENT_GRAY  = HexColor("#64748b")   # slate-500
LIGHT_BG     = HexColor("#f8fafc")   # slate-50
BORDER_GRAY  = HexColor("#e2e8f0")   # slate-200
HEADER_BG    = HexColor("#0f172a")   # slate-900
ROW_ALT      = HexColor("#f1f5f9")   # slate-100
PHASE_COLORS = {
    0: HexColor("#6366f1"),  # indigo
    1: HexColor("#0ea5e9"),  # sky
    2: HexColor("#8b5cf6"),  # violet
    3: HexColor("#f59e0b"),  # amber
    4: HexColor("#10b981"),  # emerald
    5: HexColor("#ec4899"),  # pink
    6: HexColor("#ef4444"),  # red
    7: HexColor("#14b8a6"),  # teal
}

# ── Styles ───────────────────────────────────────────────
styles = getSampleStyleSheet()

title_style = ParagraphStyle(
    "DocTitle", parent=styles["Title"],
    fontSize=28, leading=34, textColor=BRAND_DARK,
    spaceAfter=6, alignment=TA_LEFT,
    fontName="Helvetica-Bold"
)

subtitle_style = ParagraphStyle(
    "DocSubtitle", parent=styles["Normal"],
    fontSize=13, leading=18, textColor=ACCENT_GRAY,
    spaceAfter=20, fontName="Helvetica"
)

h1_style = ParagraphStyle(
    "H1", parent=styles["Heading1"],
    fontSize=20, leading=26, textColor=BRAND_DARK,
    spaceBefore=24, spaceAfter=10,
    fontName="Helvetica-Bold",
    borderPadding=(0, 0, 4, 0),
)

h2_style = ParagraphStyle(
    "H2", parent=styles["Heading2"],
    fontSize=14, leading=19, textColor=BRAND_DARK,
    spaceBefore=16, spaceAfter=6,
    fontName="Helvetica-Bold"
)

h3_style = ParagraphStyle(
    "H3", parent=styles["Heading3"],
    fontSize=12, leading=16, textColor=HexColor("#334155"),
    spaceBefore=10, spaceAfter=4,
    fontName="Helvetica-Bold"
)

body_style = ParagraphStyle(
    "Body", parent=styles["Normal"],
    fontSize=10, leading=15, textColor=HexColor("#1e293b"),
    spaceAfter=6, alignment=TA_JUSTIFY,
    fontName="Helvetica"
)

bullet_style = ParagraphStyle(
    "Bullet", parent=body_style,
    leftIndent=18, bulletIndent=6,
    spaceBefore=2, spaceAfter=2,
)

sub_bullet_style = ParagraphStyle(
    "SubBullet", parent=bullet_style,
    leftIndent=36, bulletIndent=22,
    fontSize=9.5, leading=14,
)

code_style = ParagraphStyle(
    "Code", parent=styles["Code"],
    fontSize=8.5, leading=12,
    fontName="Courier", textColor=HexColor("#1e293b"),
    backColor=HexColor("#f1f5f9"),
    borderPadding=8, spaceBefore=6, spaceAfter=6,
    leftIndent=12
)

phase_title_style = ParagraphStyle(
    "PhaseTitle", parent=h1_style,
    fontSize=18, leading=24,
)

deliverable_style = ParagraphStyle(
    "Deliverable", parent=body_style,
    fontSize=10, leading=14,
    textColor=HexColor("#065f46"),
    backColor=HexColor("#ecfdf5"),
    borderPadding=8, spaceBefore=8, spaceAfter=8,
    fontName="Helvetica-Bold"
)

table_header_style = ParagraphStyle(
    "TableHeader", parent=body_style,
    fontSize=9, leading=12, textColor=white,
    fontName="Helvetica-Bold", alignment=TA_LEFT,
)

table_cell_style = ParagraphStyle(
    "TableCell", parent=body_style,
    fontSize=9, leading=13, spaceAfter=0,
    fontName="Helvetica"
)

table_cell_bold = ParagraphStyle(
    "TableCellBold", parent=table_cell_style,
    fontName="Helvetica-Bold"
)

# ── Helpers ──────────────────────────────────────────────
def hr():
    return HRFlowable(width="100%", thickness=1, color=BORDER_GRAY, spaceBefore=8, spaceAfter=8)

def small_spacer(h=6):
    return Spacer(1, h)

def make_table(headers, rows, col_widths=None):
    """Create a styled table."""
    w = col_widths or [None] * len(headers)
    data = [[Paragraph(h, table_header_style) for h in headers]]
    for row in rows:
        data.append([Paragraph(str(c), table_cell_style) for c in row])

    t = Table(data, colWidths=col_widths, repeatRows=1)
    style_cmds = [
        ("BACKGROUND", (0, 0), (-1, 0), HEADER_BG),
        ("TEXTCOLOR", (0, 0), (-1, 0), white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, 0), 9),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 8),
        ("TOPPADDING", (0, 0), (-1, 0), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 8),
        ("RIGHTPADDING", (0, 0), (-1, -1), 8),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER_GRAY),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("TOPPADDING", (0, 1), (-1, -1), 6),
        ("BOTTOMPADDING", (0, 1), (-1, -1), 6),
    ]
    for i in range(1, len(data)):
        if i % 2 == 0:
            style_cmds.append(("BACKGROUND", (0, i), (-1, i), ROW_ALT))
    t.setStyle(TableStyle(style_cmds))
    return t

def phase_header(num, title, weeks, color):
    """Phase section header with colored badge."""
    badge = f'<font color="{color.hexval()}"><b>PHASE {num}</b></font>'
    full = f'{badge}  {title} <font color="{ACCENT_GRAY.hexval()}" size="11">({weeks})</font>'
    return Paragraph(full, phase_title_style)

def bullet(text, style=bullet_style):
    return Paragraph(f"•  {text}", style)

def sub_bullet_item(text):
    return Paragraph(f"    ◦  {text}", sub_bullet_style)

def dev_block(label, items):
    """Dev A / Dev B block."""
    elements = [Paragraph(f'<b><font color="{BRAND_BLUE.hexval()}">{label}</font></b>', h3_style)]
    for item in items:
        elements.append(bullet(item))
    return elements

# ── Page Template ────────────────────────────────────────
def header_footer(canvas, doc):
    canvas.saveState()
    # Header line
    canvas.setStrokeColor(BRAND_BLUE)
    canvas.setLineWidth(2)
    canvas.line(doc.leftMargin, A4[1] - 28*mm, A4[0] - doc.rightMargin, A4[1] - 28*mm)
    # Header text
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(ACCENT_GRAY)
    canvas.drawString(doc.leftMargin, A4[1] - 26*mm, "FAMTO BACKEND")
    canvas.drawRightString(A4[0] - doc.rightMargin, A4[1] - 26*mm, "Microservice Migration Plan")
    # Footer
    canvas.setFont("Helvetica", 8)
    canvas.setFillColor(ACCENT_GRAY)
    canvas.drawString(doc.leftMargin, 18*mm, f"Confidential  |  Generated {datetime.now().strftime('%B %d, %Y')}")
    canvas.drawRightString(A4[0] - doc.rightMargin, 18*mm, f"Page {doc.page}")
    canvas.restoreState()

# ── Build Document ───────────────────────────────────────
def build_pdf(output_path):
    doc = SimpleDocTemplate(
        output_path, pagesize=A4,
        leftMargin=22*mm, rightMargin=22*mm,
        topMargin=32*mm, bottomMargin=25*mm
    )
    W = doc.width
    story = []

    # ── COVER ────────────────────────────────────────────
    story.append(Spacer(1, 40))
    story.append(Paragraph("Famto Backend", title_style))
    story.append(Paragraph("Microservice Architecture<br/>Migration Plan", ParagraphStyle(
        "BigTitle", parent=title_style, fontSize=32, leading=40, textColor=BRAND_BLUE
    )))
    story.append(Spacer(1, 20))
    story.append(HRFlowable(width="40%", thickness=3, color=BRAND_BLUE, spaceBefore=0, spaceAfter=16))
    story.append(Paragraph(
        f"Prepared: {datetime.now().strftime('%B %d, %Y')}  |  Team: 2 Developers  |  Timeline: 52 Weeks",
        subtitle_style
    ))
    story.append(Spacer(1, 30))

    # Key metrics box
    metrics = [
        ["Current State", "Target State"],
        ["22,500 lines monolith", "8 independent microservices"],
        ["65 controllers, 79 models", "Domain-driven service boundaries"],
        ["Single process, no caching", "Docker + Kubernetes + Redis"],
        ["No message queue", "Kafka + RabbitMQ event-driven"],
        ["268+ console.log calls", "Structured Pino logging"],
        ["Zero automated tests", "Integration tests per service"],
    ]
    metric_table = Table(metrics, colWidths=[W/2, W/2])
    metric_table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), HEADER_BG),
        ("TEXTCOLOR", (0, 0), (-1, 0), white),
        ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
        ("FONTSIZE", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 8),
        ("LEFTPADDING", (0, 0), (-1, -1), 10),
        ("GRID", (0, 0), (-1, -1), 0.5, BORDER_GRAY),
        ("BACKGROUND", (0, 1), (0, -1), HexColor("#fef2f2")),
        ("BACKGROUND", (1, 1), (1, -1), HexColor("#ecfdf5")),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(metric_table)
    story.append(PageBreak())

    # ── TABLE OF CONTENTS ────────────────────────────────
    story.append(Paragraph("Contents", h1_style))
    story.append(hr())
    toc_items = [
        "1. Architecture Overview",
        "2. Service Ownership Matrix",
        "3. Phase 0: Foundation Hardening (Weeks 1-6)",
        "4. Phase 1: Notification Service (Weeks 7-12)",
        "5. Phase 2: Auth Service (Weeks 13-16)",
        "6. Phase 3: Pricing & Billing Service (Weeks 17-22)",
        "7. Phase 4: Merchant Service (Weeks 23-28)",
        "8. Phase 5: Customer + Agent Services (Weeks 29-36)",
        "9. Phase 6: Order Service + Kafka (Weeks 37-46)",
        "10. Phase 7: Kubernetes + Decommission (Weeks 47-52)",
        "11. Data Migration Strategy",
        "12. Technology Stack",
        "13. Developer Week-by-Week Allocation",
        "14. Risk Mitigations",
        "15. Timeline & Recommendation",
        "16. Verification Checklist",
    ]
    for item in toc_items:
        story.append(Paragraph(item, ParagraphStyle(
            "TOC", parent=body_style, fontSize=11, leading=20, leftIndent=10,
            textColor=BRAND_DARK
        )))
    story.append(PageBreak())

    # ── 1. ARCHITECTURE ──────────────────────────────────
    story.append(Paragraph("1. Architecture Overview", h1_style))
    story.append(hr())
    story.append(Paragraph(
        "The migration follows the <b>Strangler Fig</b> pattern: services are extracted one at a time "
        "behind an API Gateway. The frontend sees zero URL changes (except Socket.io connection URL, once). "
        "Production traffic is never interrupted.",
        body_style
    ))
    story.append(small_spacer(10))
    story.append(Paragraph("<b>Target: 8 Microservices</b>", h2_style))

    # Architecture diagram as table
    arch_top = [
        [Paragraph('<font color="white"><b>API GATEWAY</b><br/>Rate Limiting  |  Auth Verify  |  Route Proxy</font>',
                    ParagraphStyle("ArchGW", parent=table_cell_style, alignment=TA_CENTER, textColor=white, fontSize=11, fontName="Helvetica-Bold"))]
    ]
    arch_top_t = Table(arch_top, colWidths=[W])
    arch_top_t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), BRAND_DARK),
        ("TOPPADDING", (0, 0), (-1, -1), 14),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 14),
        ("BOX", (0, 0), (-1, -1), 1, BRAND_DARK),
    ]))
    story.append(arch_top_t)
    story.append(small_spacer(4))

    svc_names = ["Auth\nService", "Order\nService", "Merchant\nService", "Customer\nService", "Agent\nService", "Pricing &\nBilling"]
    svc_colors = [PHASE_COLORS[2], PHASE_COLORS[6], PHASE_COLORS[4], PHASE_COLORS[5], PHASE_COLORS[3], PHASE_COLORS[3]]
    svc_cells = []
    for i, (name, color) in enumerate(zip(svc_names, svc_colors)):
        svc_cells.append(Paragraph(
            f'<font color="white"><b>{name}</b></font>',
            ParagraphStyle("SvcBox", parent=table_cell_style, alignment=TA_CENTER, textColor=white, fontSize=9, fontName="Helvetica-Bold")
        ))
    svc_row = Table([svc_cells], colWidths=[W/6]*6)
    svc_style_cmds = [
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]
    for i, color in enumerate(svc_colors):
        svc_style_cmds.append(("BACKGROUND", (i, 0), (i, 0), color))
    svc_row.setStyle(TableStyle(svc_style_cmds))
    story.append(svc_row)
    story.append(small_spacer(4))

    # Message brokers row
    mq_cells = [
        Paragraph('<font color="white"><b>RabbitMQ</b><br/>Task Queues</font>',
                  ParagraphStyle("MQ", parent=table_cell_style, alignment=TA_CENTER, textColor=white, fontSize=9, fontName="Helvetica-Bold")),
        Paragraph('<font color="white"><b>Kafka</b><br/>Event Streaming</font>',
                  ParagraphStyle("KF", parent=table_cell_style, alignment=TA_CENTER, textColor=white, fontSize=9, fontName="Helvetica-Bold")),
        Paragraph('<font color="white"><b>Redis</b><br/>Cache / Pub-Sub</font>',
                  ParagraphStyle("RD", parent=table_cell_style, alignment=TA_CENTER, textColor=white, fontSize=9, fontName="Helvetica-Bold")),
    ]
    mq_row = Table([mq_cells], colWidths=[W/3]*3)
    mq_row.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (0, 0), HexColor("#7c3aed")),
        ("BACKGROUND", (1, 0), (1, 0), HexColor("#059669")),
        ("BACKGROUND", (2, 0), (2, 0), HexColor("#dc2626")),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    story.append(mq_row)
    story.append(small_spacer(4))

    notif_cells = [
        Paragraph('<font color="white"><b>NOTIFICATION SERVICE</b><br/>Push (Firebase)  |  SMS (2Factor)  |  Email  |  WhatsApp (Meta)  |  Socket.io Real-time</font>',
                  ParagraphStyle("Notif", parent=table_cell_style, alignment=TA_CENTER, textColor=white, fontSize=10, fontName="Helvetica-Bold"))
    ]
    notif_row = Table([notif_cells], colWidths=[W])
    notif_row.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), BRAND_BLUE),
        ("TOPPADDING", (0, 0), (-1, -1), 12),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 12),
    ]))
    story.append(notif_row)
    story.append(PageBreak())

    # ── 2. SERVICE OWNERSHIP ─────────────────────────────
    story.append(Paragraph("2. Service Ownership Matrix", h1_style))
    story.append(hr())
    story.append(make_table(
        ["Service", "Models Owned", "Key Controllers"],
        [
            ["Auth", "Admin, Manager, ManagerRoles, Token", "authController"],
            ["Order", "Order, TemporaryOrder, ScheduledOrder, Task, PickAndCustomCart, DatabaseCounter",
             "adminOrderController, merchantOrderController, universalOrderController, pickAndDropController"],
            ["Merchant", "Merchant, Category, Product, BusinessCategory, Discounts, Banners",
             "merchantController, categoryController, productController"],
            ["Customer", "Customer, CustomerCart, Wallet, LoyaltyPoint, Referral, PromoCode", "customerController"],
            ["Agent", "Agent, AgentTransaction, AgentWorkHistory, AutoAllocation", "agentController"],
            ["Pricing & Billing", "CustomerPricing, MerchantPricing, AgentPricing, *Surge, Tax, Commission, Subscription",
             "pricingControllers, subscriptionController, homeController"],
            ["Notification", "NotificationSettings, FCMToken, all NotificationLogs, all Whatsapp* (8 models)",
             "pushNotificationController, whatsapp/*, socket.js"],
            ["API Gateway", "None (stateless)", "Route proxying, rate limiting, JWT verification"],
        ],
        col_widths=[W*0.13, W*0.42, W*0.45]
    ))
    story.append(PageBreak())

    # ── PHASES ───────────────────────────────────────────

    # Phase 0
    story.append(phase_header(0, "Foundation Hardening", "Weeks 1-6", PHASE_COLORS[0]))
    story.append(hr())
    story.append(Paragraph(
        "<b>No service split yet.</b> Harden the monolith with structured logging, Redis caching, "
        "Docker Compose, database optimization, and graceful shutdown. This phase prevents cascading "
        "problems in every subsequent phase.",
        body_style
    ))
    story.append(small_spacer(6))

    story.append(Paragraph("<b>Week 1-2: Logging + Error Handling + Graceful Shutdown</b>", h2_style))
    story.extend(dev_block("Dev A - Structured Logging", [
        "Install Pino (pino + pino-http). Create utils/logger.js shared module",
        "Replace all 268+ console.log/console.error calls with logger.info/logger.error",
        "Add pino-http middleware to index.js for request-level logging with request-id correlation",
    ]))
    story.extend(dev_block("Dev B - Error Handling + Shutdown", [
        "Enhance middlewares/globalErrorHandler.js: distinguish 4xx vs 5xx, log stack traces",
        "Add process.on('unhandledRejection') and process.on('uncaughtException') handlers",
        "Implement graceful shutdown: SIGTERM/SIGINT -> drain Socket.io -> close MongoDB -> exit",
    ]))

    story.append(Paragraph("<b>Week 3-4: Redis + Docker Compose</b>", h2_style))
    story.extend(dev_block("Dev A - Redis Integration", [
        "Add Redis to stack. Create config/redis.js connection module",
        "Replace in-memory distanceCache with Redis (TTL: 5 min)",
        "Replace node-cache in isAuthenticated.js with Redis",
        "Add Redis-based rate limiting (express-rate-limit + rate-limit-redis)",
    ]))
    story.extend(dev_block("Dev B - Docker Compose + Firebase Refactor", [
        "Create docker-compose.yml with: app, MongoDB (local dev), Redis",
        "Add GET /health endpoint returning MongoDB + Redis connection status",
        "Move Firebase Admin SDK init from socket.js into shared config/firebaseAdmin.js",
    ]))

    story.append(Paragraph("<b>Week 5-6: Database Optimization + Service Layer</b>", h2_style))
    story.extend(dev_block("Dev A - DB Performance", [
        "Audit all 79 models for missing indexes (Order, Merchant, Task are critical)",
        "Add .lean() to all read-only queries in top-5 controllers",
        "Fix N+1 patterns: merge sequential countDocuments into single aggregation",
    ]))
    story.extend(dev_block("Dev B - Service Layer Template", [
        "Create services/ and repositories/ directories",
        "Refactor geofenceController (155 lines) and customerPricingController (305 lines) as templates",
        "Document Controller -> Service -> Repository pattern in CONTRIBUTING.md",
    ]))
    story.append(Paragraph(
        "Deliverable: Structured logging, Redis caching, Docker Compose dev setup, health checks, "
        "DB indexes, graceful shutdown. Monolith is production-hardened.",
        deliverable_style
    ))
    story.append(PageBreak())

    # Phase 1
    story.append(phase_header(1, "Extract Notification Service", "Weeks 7-12", PHASE_COLORS[1]))
    story.append(hr())
    story.append(Paragraph(
        "<b>Why first:</b> socket.js is imported by 20+ files and is the biggest coupling point. "
        "Notification logic has clear inputs (userId, event, data) and outputs (push/socket/log). "
        "Extracting it decouples every subsequent extraction.",
        body_style
    ))

    story.append(Paragraph("<b>Week 7-8: Service Scaffold + RabbitMQ</b>", h2_style))
    story.extend(dev_block("Dev A", [
        "Create services/notification-service/ project (separate package.json, Dockerfile)",
        "Add RabbitMQ to docker-compose.yml",
        "Define queues: notification.push, notification.socket, notification.sms, notification.email, notification.log",
    ]))
    story.extend(dev_block("Dev B", [
        "Extract sendPushNotificationToUser(), createNotificationLog(), sendNotification(), sendSocketData()",
        "Move Firebase Admin SDK config to Notification Service",
        "Create REST API endpoints for direct notification sends",
    ]))

    story.append(Paragraph("<b>Week 9-10: Event-Driven Integration</b>", h2_style))
    story.extend(dev_block("Dev A", [
        "Replace direct sendNotification()/sendSocketData() calls (20 files) with RabbitMQ publishers",
    ]))
    story.extend(dev_block("Dev B", [
        "Migrate Socket.io server to Notification Service with Redis adapter for horizontal scaling",
        "Monolith publishes events -> RabbitMQ -> Notification Service -> Socket.io emit",
    ]))

    story.append(Paragraph("<b>Week 11-12: WhatsApp Module + Testing</b>", h2_style))
    story.extend(dev_block("Dev A", ["Move all 9 WhatsApp controllers + 8 models into Notification Service"]))
    story.extend(dev_block("Dev B", [
        "Integration test all 22 socket events end-to-end",
        "Verify push notifications to both Firebase projects",
        "Load test RabbitMQ throughput",
    ]))
    story.append(Paragraph(
        "Deliverable: Notification Service running in Docker Compose. Monolith no longer contains "
        "socket.js notification logic. RabbitMQ connects them.",
        deliverable_style
    ))
    story.append(PageBreak())

    # Phase 2
    story.append(phase_header(2, "Extract Auth Service", "Weeks 13-16", PHASE_COLORS[2]))
    story.append(hr())
    story.append(Paragraph("<b>Week 13-14: Auth Service</b>", h2_style))
    story.extend(dev_block("Dev A", [
        "Create Auth Service: POST /auth/login (Admin/Merchant/Manager), POST /auth/otp/send + /verify (Customer/Agent), POST /auth/register, POST /auth/refresh-token",
    ]))
    story.extend(dev_block("Dev B", [
        "Create JWT validation as shared middleware (verify signature locally without calling Auth Service per request)",
        "Redis for token blacklisting (logout invalidation)",
    ]))
    story.append(Paragraph("<b>Week 15-16: API Gateway</b>", h2_style))
    story.extend(dev_block("Dev A", [
        "Set up Express-based API Gateway using http-proxy-middleware",
        "Route /api/v1/auth/* -> Auth Service, /api/v1/whatsapp/* -> Notification Service, everything else -> monolith",
    ]))
    story.extend(dev_block("Dev B", [
        "Remove auth controllers from monolith. Update isAuthenticated.js to verify JWT locally",
        "Test all 5 actor login flows end-to-end",
    ]))
    story.append(Paragraph(
        "Deliverable: Auth Service + API Gateway running. All traffic flows through gateway.",
        deliverable_style
    ))
    story.append(PageBreak())

    # Phase 3
    story.append(phase_header(3, "Extract Pricing & Billing Service", "Weeks 17-22", PHASE_COLORS[3]))
    story.append(hr())
    story.append(Paragraph("<b>Week 17-20:</b> Move 6 pricing controllers, 6 surge controllers, Tax, Commission, "
        "Subscription controllers and models. Expose internal API: GET /pricing/calculate?geofenceId=X&amp;distance=Y&amp;vehicleType=Z. "
        "Move billing cron jobs from index.js.", body_style))
    story.append(Paragraph("<b>Week 21-22:</b> Move homeController.js dashboard aggregations, "
        "createPerDayRevenueHelper.js, revenue models. Verify pricing calculations match monolith exactly.", body_style))
    story.append(Paragraph("Deliverable: Pricing Service running. Monolith calls Pricing API for all calculations.", deliverable_style))

    # Phase 4
    story.append(small_spacer(10))
    story.append(phase_header(4, "Extract Merchant Service", "Weeks 23-28", PHASE_COLORS[4]))
    story.append(hr())
    story.append(Paragraph(
        "Move Merchant, Category, Product, BusinessCategory, Discounts, Banners. Expose internal APIs "
        "for Order Service: GET /merchants/:id, GET /products/:id, PATCH /products/:id/stock. "
        "Publish Kafka events: merchant.status.changed, product.stock.updated. Move payout logic and merchant cron jobs.",
        body_style
    ))
    story.append(Paragraph("Deliverable: Merchant catalog served from Merchant Service.", deliverable_style))

    # Phase 5
    story.append(small_spacer(10))
    story.append(phase_header(5, "Extract Customer + Agent Services", "Weeks 29-36", PHASE_COLORS[5]))
    story.append(hr())
    story.append(Paragraph("<b>Weeks 29-31 (Customer):</b> Move Customer model, cart, wallet, loyalty, referral, "
        "promo codes. Expose GET /customers/:id/validate, POST /customers/:id/wallet/debit.", body_style))
    story.append(Paragraph("<b>Weeks 32-34 (Agent):</b> Move Agent model, transactions, work history, location tracking, "
        "auto-allocation. Expose GET /agents/available?geofenceId=X.", body_style))
    story.append(Paragraph("<b>Weeks 35-36:</b> Full integration testing across all extracted services.", body_style))
    story.append(Paragraph("Deliverable: Customer + Agent Services running independently.", deliverable_style))
    story.append(PageBreak())

    # Phase 6
    story.append(phase_header(6, "Extract Order Service + Kafka", "Weeks 37-46", PHASE_COLORS[6]))
    story.append(hr())
    story.append(Paragraph(
        "<b>The hardest phase.</b> Order domain is ~15,000 lines with deep coupling to every other service.",
        body_style
    ))
    story.append(Paragraph("<b>Week 37-38: Kafka Setup</b>", h2_style))
    story.append(Paragraph("Add Kafka to infrastructure. Define events: order.created, order.accepted, "
        "order.assigned, order.pickup.started, order.delivered, order.cancelled, order.payment.completed.", body_style))
    story.append(Paragraph("<b>Week 39-42: Order Service Core</b>", h2_style))
    story.append(Paragraph("Move Order, TemporaryOrder, ScheduledOrder, Task models. Move ProcessOrderService.js, "
        "createOrderHelpers.js, orderCreateTaskHelper.js. Replace all direct model imports with inter-service HTTP calls.", body_style))
    story.append(Paragraph("<b>Week 43-44: Payment + Socket Events</b>", h2_style))
    story.append(Paragraph("Move Razorpay integration. Move remaining order-related socket events. "
        "Order Service publishes to Kafka; Notification Service consumes and dispatches.", body_style))
    story.append(Paragraph("<b>Week 45-46: Cron Migration + E2E Testing</b>", h2_style))
    story.append(Paragraph("Full lifecycle test: Create -> Pay -> Assign -> Pickup -> Deliver -> Complete. "
        "Test all 4 delivery modes. Test scheduled orders. Test payment failure/refund paths.", body_style))
    story.append(Paragraph("Deliverable: Order Service is source of truth for all orders. Monolith is now the gateway.", deliverable_style))

    # Phase 7
    story.append(small_spacer(10))
    story.append(phase_header(7, "Kubernetes + Decommission", "Weeks 47-52", PHASE_COLORS[7]))
    story.append(hr())
    story.append(Paragraph("<b>Week 47-48:</b> Remove all extracted code from monolith. Remaining admin operations become thin Admin Service.", body_style))
    story.append(Paragraph("<b>Week 49-50:</b> Create K8s manifests (Deployments, Services, ConfigMaps, Secrets, HPA). "
        "Set up Helm charts. CI/CD pipeline with GitHub Actions.", body_style))
    story.append(Paragraph("<b>Week 51-52:</b> Blue-green deployment to K8s cluster. Old monolith as fallback for 2 weeks.", body_style))
    story.append(Paragraph("Deliverable: All 8 services on Kubernetes. Monolith decommissioned.", deliverable_style))
    story.append(PageBreak())

    # ── 11. DATA MIGRATION ───────────────────────────────
    story.append(Paragraph("11. Data Migration Strategy", h1_style))
    story.append(hr())
    story.append(make_table(
        ["Phase", "Strategy", "Risk Level"],
        [
            ["Phase 0-2", "All services share same MongoDB Atlas cluster + database. No data migration.", "Low"],
            ["Phase 3-5", "Each new service gets own database on same Atlas cluster. One-time migration script. Brief read-only cutover (minutes).", "Medium"],
            ["Phase 6+", "Each service owns its data. Cross-service reads via API calls. Eventual consistency via Kafka events.", "Medium"],
        ],
        col_widths=[W*0.15, W*0.65, W*0.20]
    ))

    # ── 12. TECH STACK ───────────────────────────────────
    story.append(small_spacer(16))
    story.append(Paragraph("12. Technology Stack Per Service", h1_style))
    story.append(hr())
    story.append(Paragraph(
        "src/config/ (DB, Redis, Kafka, RabbitMQ) | src/controllers/ (thin HTTP handlers) | "
        "src/services/ (business logic) | src/repositories/ (Mongoose data access) | "
        "src/middlewares/ (auth, validation) | src/events/ (Kafka) | src/queues/ (RabbitMQ) | src/utils/",
        code_style
    ))
    story.append(small_spacer(8))
    story.append(make_table(
        ["Technology", "Purpose"],
        [
            ["Pino", "Structured JSON logging with request-id correlation"],
            ["Joi / Zod", "Request validation (replaces express-validator)"],
            ["Redis", "Caching + rate limiting + session + Socket.io adapter"],
            ["RabbitMQ", "Task queues (notifications, campaigns, async jobs)"],
            ["Kafka", "Event streaming (order lifecycle, merchant status updates)"],
            ["Docker + K8s", "Containerization + orchestration + HPA autoscaling"],
            ["GitHub Actions", "CI/CD pipeline per service"],
        ],
        col_widths=[W*0.20, W*0.80]
    ))
    story.append(PageBreak())

    # ── 13. DEVELOPER ALLOCATION ─────────────────────────
    story.append(Paragraph("13. Developer Week-by-Week Allocation", h1_style))
    story.append(hr())
    story.append(make_table(
        ["Week", "Dev A", "Dev B"],
        [
            ["1-2", "Structured logging (Pino)", "Graceful shutdown, error handling"],
            ["3-4", "Redis, caching, rate limiting", "Docker Compose, Firebase refactor, health check"],
            ["5-6", "DB indexes, lean queries, N+1 fixes", "Service layer pattern, refactor 2 controllers"],
            ["7-8", "Notification Service scaffold, RabbitMQ", "Extract notification functions from socket.js"],
            ["9-10", "RabbitMQ producers in monolith", "Socket.io migration to Notification Service"],
            ["11-12", "WhatsApp module migration", "Integration testing all socket events"],
            ["13-14", "Auth Service implementation", "JWT shared validation, Redis token blacklist"],
            ["15-16", "API Gateway setup", "Monolith auth removal, testing"],
            ["17-20", "Pricing Service core", "Internal pricing API + subscription migration"],
            ["21-22", "Revenue/analytics migration", "Integration testing pricing"],
            ["23-26", "Merchant profiles + products + APIs", "Discounts, banners, Kafka events"],
            ["27-28", "Payout migration", "End-to-end testing"],
            ["29-31", "Customer Service core", "Customer controllers migration"],
            ["32-34", "Agent Service core", "Agent controllers migration"],
            ["35-36", "Integration testing", "Integration testing"],
            ["37-38", "Kafka setup, event schema", "Order flow refactor to service pattern"],
            ["39-42", "Order Service core models", "Inter-service call implementation"],
            ["43-44", "Socket order events migration", "Payment/Razorpay migration"],
            ["45-46", "Cron migration", "E2E order lifecycle testing"],
            ["47-48", "Monolith cleanup", "Admin Service remainder"],
            ["49-50", "Kubernetes manifests + Helm", "CI/CD pipeline"],
            ["51-52", "Production deployment", "Monitoring + fallback"],
        ],
        col_widths=[W*0.10, W*0.45, W*0.45]
    ))
    story.append(PageBreak())

    # ── 14. RISK MITIGATIONS ─────────────────────────────
    story.append(Paragraph("14. Risk Mitigations", h1_style))
    story.append(hr())
    story.append(make_table(
        ["Risk", "Likelihood", "Impact", "Mitigation"],
        [
            ["Socket.io migration breaks real-time", "High", "Critical",
             "Feature flag to toggle old/new. Keep monolith Socket.io as fallback for 2 weeks"],
            ["Order race conditions during split", "High", "Critical",
             "Redis distributed locks + MongoDB transactions. Never have two services writing to same order"],
            ["Team burnout / scope creep", "High", "High",
             "Strict phase gates. No new phase until previous is stable in production for 1 week"],
            ["Data inconsistency across services", "Medium", "Critical",
             "Start with shared DB. Move to separate DBs only when boundary is proven. Kafka dead-letter queues"],
            ["Inter-service HTTP latency", "Medium", "Medium",
             "Redis caching for hot data (pricing, merchant details). Connection pooling. Batch API calls"],
            ["Kafka/RabbitMQ operational complexity", "Medium", "Medium",
             "Start with RabbitMQ only. Add Kafka in Phase 6 when event ordering matters"],
            ["Custom ID generation (DatabaseCounter) conflicts", "Low", "Critical",
             "Keep DatabaseCounter in single service (Order). Uses findOneAndUpdate with $inc (atomic)"],
        ],
        col_widths=[W*0.20, W*0.10, W*0.10, W*0.60]
    ))

    # ── 15. TIMELINE ─────────────────────────────────────
    story.append(small_spacer(16))
    story.append(Paragraph("15. Timeline & Recommendation", h1_style))
    story.append(hr())
    story.append(make_table(
        ["Scenario", "Duration"],
        [
            ["With zero feature development", "52 weeks (12 months)"],
            ["With feature work interleaved", "15-18 months"],
            ["Phase 0 + Phase 1 only (80/20 rule)", "12 weeks (3 months)"],
        ],
        col_widths=[W*0.55, W*0.45]
    ))
    story.append(small_spacer(10))
    story.append(Paragraph(
        '<font color="#059669"><b>80/20 Recommendation:</b></font> Phase 0 + Phase 1 alone (12 weeks) delivers '
        '80% of the architectural improvement. Structured logging, Redis, Docker Compose, graceful shutdown, '
        'and decoupled notifications make the system dramatically more reliable. Treat Phase 2-7 as '
        'optional based on actual scaling needs.',
        ParagraphStyle("Rec", parent=body_style, fontSize=11, leading=16,
                       backColor=HexColor("#ecfdf5"), borderPadding=12,
                       fontName="Helvetica")
    ))
    story.append(PageBreak())

    # ── 16. VERIFICATION ─────────────────────────────────
    story.append(Paragraph("16. Verification Checklist", h1_style))
    story.append(hr())
    story.append(Paragraph("After each phase, verify:", body_style))
    checks = [
        "Run integration tests against extracted service (supertest / Newman collections)",
        "Compare API responses with monolith (same inputs -> same outputs)",
        "Monitor error rates in production for 1 week before starting next phase",
        "Verify all frontend flows (Famto Dashboard + mobile apps) work identically",
        "Load test the new service with production-like traffic patterns",
        "Verify RabbitMQ / Kafka message delivery with no dropped events",
        "Check Redis cache hit rates and memory usage",
        "Confirm zero data inconsistency between services",
    ]
    for check in checks:
        story.append(bullet(check))

    story.append(Spacer(1, 40))
    story.append(HRFlowable(width="100%", thickness=2, color=BRAND_BLUE, spaceBefore=20, spaceAfter=12))
    story.append(Paragraph(
        '<font color="#64748b">End of Document  |  Famto Microservice Migration Plan  |  Confidential</font>',
        ParagraphStyle("Footer", parent=body_style, alignment=TA_CENTER, fontSize=9)
    ))

    # ── BUILD ────────────────────────────────────────────
    doc.build(story, onFirstPage=header_footer, onLaterPages=header_footer)
    print(f"PDF generated: {output_path}")


if __name__ == "__main__":
    build_pdf(r"C:\Users\sarat\Projects\Famto_Backend_Native\Famto_Microservice_Migration_Plan.pdf")
