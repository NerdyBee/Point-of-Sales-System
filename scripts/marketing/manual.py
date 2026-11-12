"""Ajoke POS user manual (A4 PDF) from the demo screenshots.

    npx tsx scripts/marketing/demo.ts       (screenshots first)
    python scripts/marketing/manual.py      -> release/marketing/Ajoke-POS-User-Manual.pdf
"""
import json
from datetime import date
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (BaseDocTemplate, Flowable, Frame, Image, KeepTogether, ListFlowable, ListItem, NextPageTemplate,
                                PageBreak, PageTemplate, Paragraph, Spacer, Table, TableStyle)
from reportlab.platypus.tableofcontents import TableOfContents

root = Path(__file__).resolve().parents[2]
out = root / "release/marketing"
story_data = json.loads((root / "scripts/marketing/story.json").read_text(encoding="utf-8"))
demo = json.loads((out / "shots.json").read_text(encoding="utf-8"))
shots = {shot["id"]: out / "shots" / shot["file"] for shot in demo["shots"]}
vendor = story_data["vendor"]

# What the cover and page headers say; install_guide.py reuses this file with its own values.
DOCUMENT = {"name": "User Manual", "hero": "dashboard", "subject": "User manual for Ajoke POS", "file": "Ajoke-POS-User-Manual.pdf"}

for name, file in [("Segoe", "segoeui.ttf"), ("Segoe-Bold", "segoeuib.ttf"), ("Segoe-Semi", "seguisb.ttf"), ("Segoe-Italic", "segoeuii.ttf")]:
    pdfmetrics.registerFont(TTFont(name, f"C:/Windows/Fonts/{file}"))
pdfmetrics.registerFontFamily("Segoe", normal="Segoe", bold="Segoe-Bold", italic="Segoe-Italic", boldItalic="Segoe-Bold")

NAVY = colors.HexColor("#070235")
SOFT = colors.HexColor("#E3DFFF")
TEXT = colors.HexColor("#191C1E")
MUTED = colors.HexColor("#5F6670")
LINE = colors.HexColor("#C8CFD8")
TIP_BG = colors.HexColor("#EEF4FF")
WARN_BG = colors.HexColor("#FEF3C7")

body = ParagraphStyle("body", fontName="Segoe", fontSize=10.5, leading=15.5, textColor=TEXT, spaceAfter=6)
small = ParagraphStyle("small", parent=body, fontSize=9, leading=12.5, textColor=MUTED)
h1 = ParagraphStyle("h1", fontName="Segoe-Bold", fontSize=24, leading=30, textColor=NAVY, spaceAfter=4)
kicker = ParagraphStyle("kicker", fontName="Segoe-Semi", fontSize=10, leading=14, textColor=MUTED, spaceAfter=2)
h2 = ParagraphStyle("h2", fontName="Segoe-Bold", fontSize=14, leading=19, textColor=NAVY, spaceBefore=10, spaceAfter=5, keepWithNext=1)
caption = ParagraphStyle("caption", parent=small, alignment=TA_CENTER, spaceBefore=3, spaceAfter=10)
toc_level = ParagraphStyle("toc", fontName="Segoe", fontSize=12, leading=22, textColor=TEXT)

CONTENT_WIDTH = A4[0] - 40 * mm


class Doc(BaseDocTemplate):
    def __init__(self, path):
        super().__init__(str(path), pagesize=A4, leftMargin=20 * mm, rightMargin=20 * mm, topMargin=22 * mm, bottomMargin=20 * mm,
                         title=f"Ajoke POS - {DOCUMENT['name']}", author=vendor["name"], subject=DOCUMENT["subject"])
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="main")
        self.addPageTemplates([
            PageTemplate("cover", [Frame(0, 0, A4[0], A4[1], leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)], onPage=self.cover),
            PageTemplate("body", [frame], onPage=self.decorate)
        ])
        self.chapter = 0

    def afterFlowable(self, flowable):
        if isinstance(flowable, Paragraph) and flowable.style.name == "h1":
            self.notify("TOCEntry", (0, flowable.getPlainText(), self.page))

    def cover(self, canvas, doc):
        canvas.saveState()
        canvas.setFillColor(NAVY)
        canvas.rect(0, 0, A4[0], A4[1], stroke=0, fill=1)
        canvas.setFillColor(colors.white)
        canvas.roundRect(20 * mm, A4[1] - 52 * mm, 22 * mm, 22 * mm, 4 * mm, stroke=0, fill=1)
        canvas.setFillColor(NAVY)
        canvas.setFont("Segoe-Bold", 22)
        canvas.drawCentredString(31 * mm, A4[1] - 44 * mm, "AP")
        canvas.setFillColor(colors.white)
        canvas.setFont("Segoe-Bold", 44)
        canvas.drawString(20 * mm, A4[1] - 82 * mm, "Ajoke POS")
        canvas.setFont("Segoe", 20)
        canvas.setFillColor(SOFT)
        canvas.drawString(20 * mm, A4[1] - 96 * mm, DOCUMENT["name"])
        canvas.setFont("Segoe", 12.5)
        canvas.drawString(20 * mm, A4[1] - 108 * mm, story_data["tagline"])
        hero = out / DOCUMENT["hero"] if DOCUMENT["hero"].endswith(".png") else shots.get(DOCUMENT["hero"])
        if hero:
            width = A4[0] - 40 * mm
            height = width * 1080 / 1920
            canvas.drawImage(str(hero), 20 * mm, 62 * mm, width, height)
            canvas.setStrokeColor(colors.white)
            canvas.setLineWidth(1)
            canvas.rect(20 * mm, 62 * mm, width, height, stroke=1, fill=0)
        canvas.setFillColor(colors.white)
        canvas.setFont("Segoe-Semi", 12)
        canvas.drawString(20 * mm, 32 * mm, vendor["name"])
        canvas.setFont("Segoe", 11)
        canvas.setFillColor(SOFT)
        canvas.drawString(20 * mm, 25 * mm, f"WhatsApp {vendor['phone']}")
        canvas.drawRightString(A4[0] - 20 * mm, 25 * mm, f"Edition {date.today():%B %Y}")
        canvas.restoreState()

    def decorate(self, canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(LINE)
        canvas.setLineWidth(0.6)
        canvas.line(20 * mm, A4[1] - 14 * mm, A4[0] - 20 * mm, A4[1] - 14 * mm)
        canvas.setFont("Segoe-Semi", 8.5)
        canvas.setFillColor(NAVY)
        canvas.drawString(20 * mm, A4[1] - 12 * mm, f"Ajoke POS  |  {DOCUMENT['name']}")
        canvas.setFont("Segoe", 8.5)
        canvas.setFillColor(MUTED)
        canvas.drawRightString(A4[0] - 20 * mm, A4[1] - 12 * mm, vendor["name"])
        canvas.drawCentredString(A4[0] / 2, 11 * mm, str(doc.page))
        canvas.restoreState()


class Badge(Flowable):
    """Chapter number in a navy square."""

    def __init__(self, number):
        super().__init__()
        self.number = number
        self.width = self.height = 12 * mm

    def draw(self):
        self.canv.setFillColor(NAVY)
        self.canv.roundRect(0, 0, self.width, self.height, 2.5 * mm, stroke=0, fill=1)
        self.canv.setFillColor(colors.white)
        self.canv.setFont("Segoe-Bold", 16)
        self.canv.drawCentredString(self.width / 2, 3.6 * mm, str(self.number))


story = []
chapter_number = 0


def chapter(title, lead):
    global chapter_number
    chapter_number += 1
    story.append(PageBreak())
    story.append(Badge(chapter_number))
    story.append(Spacer(1, 4 * mm))
    story.append(Paragraph(title, h1))
    story.append(Paragraph(lead, kicker))
    story.append(Spacer(1, 3 * mm))


def para(text):
    story.append(Paragraph(text, body))


def heading(text):
    story.append(Paragraph(text, h2))


def bullets(items, numbered=False):
    story.append(ListFlowable(
        [ListItem(Paragraph(item, body), leftIndent=14) for item in items],
        bulletType="1" if numbered else "bullet", start="1" if numbered else "•", leftIndent=14, bulletFontName="Segoe-Bold" if numbered else "Segoe",
        bulletColor=NAVY, bulletFontSize=10 if numbered else 8
    ))
    story.append(Spacer(1, 2 * mm))


def steps(items):
    bullets(items, numbered=True)


def screen(shot_id, text, width=CONTENT_WIDTH):
    """An app screenshot by id, or an image file under release/marketing (e.g. install-art/extract.png)."""
    path = out / shot_id if shot_id.endswith(".png") else shots.get(shot_id)
    if not path:
        return
    from PIL import Image as PILImage
    with PILImage.open(path) as picture:
        ratio = picture.height / picture.width
    if ratio > 0.6:
        # A printed page (receipt, quotation, statement): narrower, so it fits on the page.
        width = min(width, 110 * mm / ratio if ratio > 1 else width * 0.7)
    image = Image(str(path), width=width, height=width * ratio)
    frame = Table([[image]], colWidths=[width], style=TableStyle([("BOX", (0, 0), (-1, -1), 0.6, LINE), ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("TOPPADDING", (0, 0), (-1, -1), 0), ("BOTTOMPADDING", (0, 0), (-1, -1), 0)]))
    story.append(KeepTogether([Spacer(1, 2 * mm), frame, Paragraph(text, caption)]))


def note(text, kind="Tip"):
    background = WARN_BG if kind == "Important" else TIP_BG
    cell = Paragraph(f"<b>{kind}:</b> {text}", body)
    story.append(Table([[cell]], colWidths=[CONTENT_WIDTH], style=TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), background), ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10),
        ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 4), ("LINEBEFORE", (0, 0), (0, -1), 3, NAVY)
    ])))
    story.append(Spacer(1, 4 * mm))


# ----- content ------------------------------------------------------------------------------

def manual_content():
    contents_page()

    chapter("Welcome to Ajoke POS", "What it does and how it fits your shop")
    para("Ajoke POS is a complete point of sale system for shops, supermarkets, cafes, pharmacies and restaurants. "
         "It runs on a computer in your shop, so it keeps selling when the internet is down. If you also have a cloud server, "
         "it copies everything there when you are online, so you can follow your business from anywhere.")
    heading("Highlights")
    bullets([
        "<b>Fast selling</b> with product pictures, categories, search and barcode scanning.",
        "<b>Every payment type</b>: cash, card, transfer, mobile money, customer credit and split payments.",
        "<b>Receipts</b> on thermal printers or sent by WhatsApp, and credit notes for refunds.",
        "<b>Quotations and proforma invoices</b>, sold at the till with one tap when the customer is ready.",
        "<b>Stock control</b>: deliveries, suppliers, expiry dates, stock counts and transfers between branches.",
        "<b>Customers</b> with loyalty points, credit accounts and statements of account.",
        "<b>Accounts and tax</b>: who owes you and who you owe, the VAT return and withholding tax, and an export for your accountant (Tally or a spreadsheet).",
        "<b>Excel import</b> of products, customers and opening balances when you move from another system.",
        "<b>Cash registers</b> with opening float, cash in and out, and end-of-day counts.",
        "<b>Reports</b> for sales, profit, tax, payments and staff, exportable to a spreadsheet.",
        "<b>Staff and roles</b> with their own sign-in, permissions, manager approvals and a full audit trail.",
        "<b>Over 40 currencies</b>, including prices with cents.",
        "<b>Works offline</b>, syncs with the cloud, and connects Android tablets on your shop Wi-Fi.",
    ])
    heading("How this manual is organised")
    para("Chapter 2 covers installation and the first start. Chapters 3 to 9 follow a normal trading day: selling, products and stock, "
         "customers, quotations, the cash register, expenses and reports. Chapter 10 covers accounts and tax. Chapters 11 to 14 cover "
         "staff and security, branches and sync, settings, and keeping your system safe. The screenshots show a sample shop called "
         "<i>Green Basket Market</i>.")

    chapter("Getting started", "Install, activate, create your business and sign in")
    heading("What you need")
    bullets([
        "A Windows 10 or 11 computer (64-bit) that stays on while the shop is open.",
        "Administrator access to that computer.",
        "The Ajoke POS installation file (a zip) from your provider.",
        "Optional: a receipt printer, cash drawer and barcode scanner.",
    ])
    heading("Install")
    steps([
        "Right-click the zip file and choose <b>Extract All</b>. Open the extracted <b>AjokePOS</b> folder.",
        "Double-click <b>Install.cmd</b> and click <b>Yes</b> when Windows asks for permission. If Windows shows "
        "<i>Windows protected your PC</i>, click <b>More info</b> and then <b>Run anyway</b>.",
        "If your provider gave you a cloud address and pairing code, type them when asked. Otherwise press Enter to skip.",
        "When it finishes, Ajoke POS opens in your browser and an <b>Ajoke POS</b> shortcut appears on the desktop.",
    ])
    note("Ajoke POS is installed in C:\\AjokePOS and starts by itself every time the computer starts.")
    heading("Activate")
    para("Each computer must be activated once. The first screen shows a code for this computer.")
    screen("activate", "The activation page shows this computer's code.")
    steps([
        "Click <b>Copy code</b> and send the code to your provider (for example on WhatsApp).",
        "Paste the activation code you receive into the box and click <b>Activate</b>.",
    ])
    note("An activation code only works on the computer it was made for. Each extra computer needs its own code.", "Important")
    heading("Create your business")
    para("Next, Ajoke POS asks for your business details. You only do this once.")
    screen("setup", "Create your business: name, currency, sales tax, shop name and the owner account.")
    steps([
        "Enter the business name, choose your <b>currency</b> and enter your <b>VAT / sales tax</b> percentage.",
        "Enter the shop (branch) name and city.",
        "Enter the owner's name, email, phone and a password of at least 8 characters.",
        "Optionally choose a 6-digit PIN for quick sign-in.",
        "Click <b>Create business</b>.",
    ])
    note("Choose the currency carefully: it cannot be changed later, because every price is stored in it.", "Important")
    screen("setup-done", "Write down your staff ID. You sign in with it.")
    para("Ajoke POS shows your <b>staff ID</b> (for example GRE-DOW-MAR). Write it down, then click <b>Continue</b> to go straight in.")
    heading("Signing in")
    screen("signin", "Sign in with a staff ID and password, or with a 6-digit PIN.")
    bullets([
        "<b>Password login</b>: enter your staff ID and password.",
        "<b>PIN login</b>: enter your staff ID and tap your 6-digit PIN.",
        "Leave <b>Remember this device</b> unticked on shared computers, so closing the browser signs you out.",
        "Ajoke POS signs out by itself after 10 minutes without use.",
    ])
    heading("Other computers and tablets")
    para("At the end of installation, Ajoke POS shows addresses such as <b>http://192.168.1.20:4000</b>. Open that address in the "
         "browser of any other computer or tablet on the same Wi-Fi to use Ajoke POS there. Ask whoever manages your router to give "
         "the main computer a fixed IP address so the address never changes.")

    chapter("Selling", "The POS terminal, payments and receipts")
    screen("pos", "The POS terminal: categories on the left, products in the middle, the sale on the right.")
    heading("Make a sale")
    steps([
        "Open <b>POS Terminal</b>. Pick a category, search, or scan a barcode.",
        "Tap a product to add it. Tap again to add more, or use + and - in the sale.",
        "To attach a customer (for loyalty points, credit or receipt history), choose them under <b>Customer</b>.",
        "Choose the payment method: <b>Cash</b>, <b>Card</b>, <b>Transfer</b> or <b>Credit</b>.",
        "For cash, enter the amount received; Ajoke POS shows the change. For card or transfer, enter the reference.",
        "Click <b>Pay now</b>.",
    ])
    screen("pos-cart", "Totals, tax and the amount due update as you add items.")
    screen("pos-paid", "After payment: print the receipt or send it by WhatsApp.")
    screen("receipt", "The printed receipt: business details, items, tax and payment.")
    heading("More options")
    bullets([
        "<b>Split</b>: take one sale in several payments, for example part cash and part card.",
        "<b>Hold</b>: park a sale and serve the next customer, then pick it up again.",
        "<b>Discount</b>: reduce a line or the whole sale. Large discounts wait for a manager's approval.",
        "<b>Void</b>: cancel the sale in progress.",
        "<b>Credit</b>: let a customer with a credit account pay later.",
    ])
    heading("Sales history and receipts")
    screen("sales", "Every sale with its receipt. Select a sale to reprint, refund or void it.")
    para("Open <b>Sales</b> to find any sale by receipt number, customer or payment method. Select it to see the receipt, print it "
         "again or send it by WhatsApp. Refunds and voids of completed sales are recorded with a reason and need a manager's approval.")
    para("For a refunded or voided sale, click <b>Credit note</b> to print a credit note against the original invoice, with the tax "
         "given back. Give it to the customer and keep a copy for your accountant.")
    screen("credit-note", "A credit note for a refund.")

    chapter("Products and stock", "Catalog, inventory, suppliers and expiry dates")
    screen("catalog", "The catalog lists every product with its picture, price and stock.")
    heading("Add a product")
    steps([
        "Open <b>Catalog</b> and click <b>Add product</b>.",
        "Enter the name, category, selling price and cost. Leave <b>SKU</b> blank and Ajoke POS makes one from the category "
        "(for example BAK-0001); the barcode is optional.",
        "Enter the opening stock and the <b>reorder point</b> (Ajoke POS warns when stock falls to this level).",
        "Optionally upload a picture, then click <b>Save</b>.",
    ])
    screen("catalog-add", "Adding a product.")
    note("Product categories are managed in Settings. Prices use your currency's decimals, for example 4.99.")
    heading("Import products from Excel")
    para("Moving from another system or a spreadsheet? Click <b>Import</b> in the Catalog, download the <b>Template</b> if you like, "
         "and choose your Excel (.xlsx) or CSV file. Your own column names usually work (for example <i>Item name</i>, "
         "<i>Selling price</i>, <i>Qty</i>).")
    screen("import", "Every row is checked first; problems are listed by row number.")
    bullets([
        "Nothing is saved until you click <b>Import</b>. Rows with problems are skipped, so fix them and import the file again.",
        "A product already in the catalog (same SKU, or same name when there is no SKU) gets its prices and category updated.",
        "New categories are added for you. Stock in the file is the opening stock of new products; change existing stock with a stock count.",
    ])
    heading("Inventory")
    screen("inventory", "Inventory: stock levels, suppliers, deliveries, counts and transfers.")
    bullets([
        "<b>Receive deliveries</b> from suppliers. Record the quantity and the <b>expiry date</b> of each batch.",
        "<b>Purchase orders</b> and supplier invoices keep track of what you ordered and what you owe. Enter the VAT shown on "
        "each invoice, and any withholding tax you deduct when paying, so the VAT and tax reports are right.",
        "<b>Stock counts</b>: count the shelves and Ajoke POS records the differences.",
        "<b>Adjustments</b> for damage or waste, always with a reason.",
        "<b>Transfers</b> move stock between branches.",
        "<b>Near expiry</b>: put soon-to-expire batches on clearance at a lower price.",
    ])

    chapter("Customers", "Loyalty points and credit accounts")
    screen("customers", "Customers with their group, loyalty points, balance and credit limit.")
    bullets([
        "Click <b>Add customer</b> and enter their name and phone number.",
        "Choose a group: Walk-in, VIP, Credit account, Wholesale or Staff.",
        "Give trusted customers a <b>credit limit</b> so they can buy on account. Ajoke POS stops credit sales above the limit.",
        "Record payments against a customer's balance from their ledger.",
        "Loyalty points build up automatically on sales to that customer.",
        "Click <b>Import</b> to bring in customers from Excel, with what each one already owed you (and since when).",
    ])
    heading("Statements of account")
    para("Click the statement button on a customer's row to print their <b>statement of account</b>: the balance brought forward, "
         "each credit sale and payment, the balance due, and how long it has been owed.")
    screen("statement", "A customer's statement of account.")

    chapter("Quotations and proforma invoices", "Price it on paper first, sell it later")
    para("When a customer asks for a price first, open <b>Quotations</b> and click <b>Quotation</b> (or <b>Proforma invoice</b> "
         "when they need an invoice to arrange payment).")
    screen("quotation-new", "Making a quotation from the catalogue.")
    steps([
        "Choose a saved customer or type the customer's name and phone.",
        "Search for each item, then set the quantities. Staff who may give discounts can enter a discount per unit.",
        "Set <b>Valid until</b> and add a note if needed (for example delivery terms).",
        "Click <b>Save and print</b>, then print it or save it as a PDF to send.",
    ])
    screen("quotation-print", "The printed quotation.")
    screen("quotations", "All quotations, with their status.")
    para("When the customer comes to buy, click the till button on the quotation. Its items and customer go into the POS cart, "
         "and the quotation is marked <b>Sold</b> when the sale is paid. The till uses today's prices and tells you if any changed.")
    screen("quotation-till", "A quotation loaded into the till.")

    chapter("Cash register", "Open, count and close the till")
    screen("register", "The register: shift overview, payment checks and cash movements.")
    heading("A day at the till")
    steps([
        "At opening, click <b>Open shift</b> and enter the opening float (the cash in the drawer).",
        "During the day, record any cash taken out or put in under <b>Cash movement</b>, with a reason.",
        "At closing, count the drawer and enter the counted cash. Ajoke POS compares it with the expected amount.",
        "A manager approves and closes the shift.",
    ])
    note("Card and transfer payments can be checked against your bank statement under Payment reconciliation.")

    chapter("Expenses", "Keep profit figures real")
    screen("expenses", "Expenses with category, vendor, amount and payment method.")
    para("Record rent, utilities, supplies and other costs under <b>Expenses</b>. Choose whether it was paid from the till drawer, "
         "by card or by transfer. Large expenses wait for a manager's approval. Expenses are subtracted from profit in reports.")
    para("If the vendor's invoice includes VAT, enter it under <b>VAT included</b>. If you deduct withholding tax (for example on "
         "rent or professional fees), enter it under <b>Withholding tax deducted</b>; the vendor is paid the rest.")

    chapter("Dashboard and reports", "See how the business is doing")
    screen("dashboard", "The owner dashboard: today's sales, tax, profit, approvals and low stock.")
    para("The <b>Dashboard</b> shows today's sales, tax collected, number of orders, average sale, profit, pending approvals and low "
         "stock alerts. Use <b>Branch</b> and <b>Period</b> to change what it shows.")
    screen("reports", "Reports for any period, by branch.")
    bullets([
        "Choose a period with the start and end dates.",
        "See sales, profit, tax, discounts, payment methods, best-selling products and categories, staff and approvals.",
        "<b>Export CSV</b> to open the figures in Excel or Google Sheets, or <b>Print/PDF</b>.",
    ])

    chapter("Accounts and tax", "Debtors, creditors, VAT and your accountant")
    para("These panels are at the bottom of the <b>Reports</b> page.")
    heading("Who owes us and who we owe")
    screen("debtors", "Customer balances by age, and supplier invoices by how overdue they are.")
    para("Each customer's balance is split into 0-30, 31-60, 61-90 and over 90 days (payments settle the oldest credit first). "
         "Click <b>Statement</b> to print one. Supplier invoices you have not paid are shown by how late they are.")
    heading("VAT and withholding tax")
    screen("tax", "The VAT return and withholding tax for a period.")
    para("Choose the period (usually last month). Ajoke POS shows the VAT you charged on sales, less VAT given back on refunds, "
         "less the VAT on your purchases and expenses: the <b>VAT payable</b>, or a credit to carry forward. Below it is the "
         "withholding tax you deducted, by payee, to pay to the tax office. Print it or download it as a spreadsheet.")
    note("In Nigeria, VAT and withholding tax for a month are due by the 21st of the following month. Check the rules with your accountant.")
    heading("Export for your accountant")
    screen("accountant", "The month's books as Tally import files or a spreadsheet day book.")
    steps([
        "Choose the period and branch.",
        "For <b>Tally</b>: download <b>1. Ledgers</b> once and import it in Tally under Import, Masters; then download "
        "<b>2. Vouchers</b> each month and import it under Import, Transactions.",
        "For Excel, QuickBooks, Sage or others: download the <b>Day book (CSV)</b>.",
    ])
    note("Ledger names (for example the cash and bank accounts) can be changed in Settings, under Accounting export, to match your accountant's.")

    chapter("Staff and security", "Sign-ins, roles, approvals and the audit trail")
    screen("staff", "Each staff member has their own sign-in.")
    heading("Add staff")
    steps([
        "Open <b>Staff</b> and click <b>Invite staff</b>.",
        "Enter their name, email and phone, choose their branch and <b>role</b> (for example Cashier or Manager).",
        "Set a temporary password and a 6-digit PIN for them, and give them their staff ID.",
    ])
    note("Never share sign-ins. Each person's own sign-in is what makes the audit trail and staff reports reliable.", "Important")
    heading("Roles")
    screen("roles", "Roles decide what each type of staff member may do.")
    para("Ajoke POS comes with ready-made roles such as Owner, Manager, Cashier, Inventory, Accountant and Auditor. Open <b>Roles</b> "
         "to change what each role may do, or create your own.")
    heading("Approvals")
    screen("approvals", "Requests waiting for a manager.")
    para("Large discounts, refunds, voids, cash movements, stock adjustments and closing the register can require a manager's approval. "
         "Managers see waiting requests under <b>Approvals</b> and approve or reject them with a note.")
    heading("Audit trail")
    screen("audit", "The audit trail records who did what, and when.")

    chapter("Branches, tills and sync", "Grow beyond one shop")
    screen("branches", "Branches and the tills (terminals) in each.")
    para("Add branches and tills under <b>Branches</b>. Each till can have its own register. The number of branches, staff and tills "
         "depends on your licence; ask your provider to add more.")
    screen("sync", "Sync: the cloud connection and connected tablets.")
    heading("Cloud sync")
    para("If your provider set up a cloud server for you, Ajoke POS copies your sales, products, stock and customers there every "
         "30 seconds while you are online, and catches up automatically after the internet comes back.")
    heading("The owner's phone")
    para("If your business has a cloud server, the owner can follow every branch from the Ajoke POS Android app. During setup, choose "
         "<b>Owner / manager phone (all branches)</b>, then enter the server address and your staff ID and password. The phone shows "
         "<b>Overview</b> (sales, profit and best sellers, per branch or all together), <b>Sales</b>, <b>Stock</b> and <b>Approvals</b>, "
         "where you approve requests from the shops, including closing a till. It needs internet and does not sell.")
    heading("Android tablets")
    para("Ajoke POS for Android can work on its own or connect to this computer over the shop Wi-Fi. To connect a tablet, open "
         "<b>Sync</b>, choose <b>Pair a tablet</b>, create a code, and enter it on the tablet.")

    chapter("Settings", "Make Ajoke POS yours")
    screen("settings", "Business details, tax, payment methods, receipt text and categories.")
    bullets([
        "<b>Business profile</b>: name, tax number and default branch.",
        "<b>Tax</b>: VAT / sales tax rate and an optional service charge.",
        "<b>Payments</b>: which payment methods the till offers.",
        "<b>Receipt</b>: the message printed at the bottom, and WhatsApp receipts.",
        "<b>Product categories</b>: add, rename or remove categories.",
        "<b>Hardware</b>: receipt printer, cash drawer and barcode scanner.",
        "<b>Accounting export</b>: the ledger names and Tally company your accountant uses.",
    ])

    chapter("Backups, updates and support", "Keep your business safe")
    heading("Backups")
    para("Ajoke POS saves a backup every day at 21:00 in <b>C:\\AjokePOS\\backups</b> and keeps the newest 30. Copy that folder to a "
         "USB drive or Google Drive every week. To back up right now, right-click <b>C:\\AjokePOS\\backup.ps1</b> and choose "
         "<b>Run with PowerShell</b>.")
    note("A backup on the same computer does not protect you if that computer is stolen or breaks. Keep a copy somewhere else.", "Important")
    heading("Updates")
    para("When your provider sends a new version, extract it and run <b>Install.cmd</b> again. Your data and activation are kept.")
    heading("Licence renewal")
    para("If your licence has an end date, Ajoke POS shows a reminder 14 days before. Send the code shown to your provider and paste "
         "the new activation code. Your data is never deleted, even if the licence lapses.")
    heading("If something is wrong")
    bullets([
        "<b>Ajoke POS does not open</b>: restart the computer and wait two minutes.",
        "<b>Other devices cannot connect</b>: check they are on the same Wi-Fi and use the address shown during installation.",
        "<b>Forgotten password</b>: a manager or the owner can set a new temporary password under Staff.",
        f"<b>Still stuck</b>: send the file C:\\AjokePOS\\logs\\server.log to {vendor['name']}.",
    ])
    story.append(Spacer(1, 8 * mm))
    contact = Table([[Paragraph(f"<font color='white'><b>{vendor['name']}</b><br/>WhatsApp {vendor['phone']}</font>", ParagraphStyle('c', parent=body, fontSize=13, leading=19))]],
                    colWidths=[CONTENT_WIDTH], style=TableStyle([("BACKGROUND", (0, 0), (-1, -1), NAVY), ("LEFTPADDING", (0, 0), (-1, -1), 14), ("TOPPADDING", (0, 0), (-1, -1), 12), ("BOTTOMPADDING", (0, 0), (-1, -1), 10)]))
    story.append(contact)



def contents_page():
    story.append(NextPageTemplate("body"))
    story.append(PageBreak())
    story.append(Paragraph("Contents", ParagraphStyle("contents-title", parent=h1)))
    story.append(Spacer(1, 4 * mm))
    toc = TableOfContents()
    toc.levelStyles = [toc_level]
    toc.dotsMinLevel = 0
    story.append(toc)


def build():
    output = out / DOCUMENT["file"]
    Doc(output).multiBuild(story)
    print(output)


if __name__ == "__main__":
    manual_content()
    build()
