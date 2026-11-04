"""Ajoke POS installation guide (A4 PDF) for clients installing the office server themselves.

    python scripts/marketing/install_art.py     (illustrations)
    python scripts/marketing/install_guide.py   -> release/marketing/Ajoke-POS-Installation-Guide.pdf

Same design as the user manual (manual.py). Keep the steps in step with deploy/office/README.txt.
"""
import manual as m

m.DOCUMENT.update({"name": "Installation Guide", "hero": "install-art/extract.png", "subject": "How to install Ajoke POS", "file": "Ajoke-POS-Installation-Guide.pdf"})
vendor = m.vendor


def content():
    m.contents_page()

    m.chapter("Before you start", "What you need and how long it takes")
    m.para("This guide installs Ajoke POS on the main computer in your shop. It takes about ten minutes. Ajoke POS then works "
           "without internet. If your provider also set up a cloud server for you, Ajoke POS copies everything there when you are online.")
    m.screen("install-art/need.png", "What you need.")
    m.bullets([
        "A <b>Windows 10 or 11</b> computer (64-bit) that stays on while the shop is open.",
        "<b>Administrator access</b> to that computer, so you can click Yes when Windows asks.",
        "The <b>Ajoke POS zip file</b> from your provider (for example AjokePOS-Office-0.1.0.zip).",
        f"Your provider's WhatsApp number for the <b>activation code</b>: {vendor['phone']}.",
        "<b>Only if you have a cloud server</b>: its address (for example https://pos.yourbusiness.com) and a pairing code. "
        "The code works once and expires after 24 hours.",
    ])
    m.note("Ask whoever manages your router to give this computer a fixed IP address. Other computers and tablets then always find it at the same address.")

    m.chapter("Install", "Extract, run Install.cmd and wait")
    m.heading("Step 1 - Extract the zip file")
    m.screen("install-art/extract.png", "Right-click the zip and choose Extract All, then open the AjokePOS folder.")
    m.steps([
        "Right-click the zip file and choose <b>Extract All</b>, then click <b>Extract</b>.",
        "Open the <b>AjokePOS</b> folder that appears.",
        "Double-click <b>Install.cmd</b>.",
    ])
    m.note("Do not run Install.cmd from inside the zip without extracting it first. The installer will tell you to extract it.", "Important")
    m.heading("Step 2 - Allow the installer to run")
    m.screen("install-art/security.png", "Click Yes. If Windows protected your PC appears, click More info, then Run anyway.")
    m.steps([
        "Windows asks <i>Do you want to allow this app to make changes to your device?</i> Click <b>Yes</b>.",
        "On some computers Windows shows <i>Windows protected your PC</i>. Click <b>More info</b>, then <b>Run anyway</b>.",
    ])
    m.heading("Step 3 - Wait while it installs")
    m.screen("install-art/console.png", "The installer window. The steps appear one by one.")
    m.para("A window opens and shows each step: copying files, setting up the database, creating the tables and registering "
           "Ajoke POS to start with Windows. When it asks for a <b>cloud address</b>:")
    m.bullets([
        "<b>With a cloud server</b>: type the address and the pairing code. Ajoke POS downloads your business from the cloud; this can take a few minutes.",
        "<b>Without one</b>: just press <b>Enter</b> to skip. You can connect later.",
    ])
    m.heading("Step 4 - Installation finished")
    m.screen("install-art/finished.png", "The finished installation shows the device code and the address for other devices.")
    m.para("Ajoke POS is now installed in <b>C:\\AjokePOS</b> and starts by itself whenever the computer starts. The window shows:")
    m.bullets([
        "<b>Device code</b>: this computer's code. You need it to activate Ajoke POS.",
        "<b>On this computer</b>: http://localhost:4000, also opened by the <b>Ajoke POS</b> shortcut on the desktop.",
        "<b>Other devices</b>: the address other computers and tablets on the shop Wi-Fi use.",
        "<b>Backups</b>: saved every day at 21:00 in C:\\AjokePOS\\backups.",
    ])
    m.para("Ajoke POS has also opened in your browser. Press Enter to close the installer window.")

    m.chapter("Activate", "One code per computer")
    m.screen("activate", "The activation page shows this computer's code.")
    m.steps([
        f"Click <b>Copy code</b> and send the code to {vendor['name']} on WhatsApp ({vendor['phone']}).",
        "Paste the activation code you receive into the box.",
        "Click <b>Activate</b>.",
    ])
    m.note("An activation code only works on the computer it was made for. Reinstalling on the same computer keeps it; another computer needs its own code.", "Important")

    m.chapter("Create your business", "Only the first time, if you have no cloud server")
    m.para("If you connected to a cloud server in Step 3, your business is already there: skip to <b>Sign in</b> and use the details your provider gave you.")
    m.screen("setup", "Create your business.")
    m.steps([
        "Enter your business name.",
        "Choose your <b>currency</b>. It cannot be changed later, because every price is stored in it.",
        "Enter your <b>VAT / sales tax</b> percentage (0 if you do not charge it), your shop name and city.",
        "Enter the owner's name, email and phone, a password of at least 8 characters and, if you like, a 6-digit PIN.",
        "Click <b>Create business</b>.",
    ])
    m.screen("setup-done", "Your staff ID. Write it down.")
    m.para("Ajoke POS shows your <b>staff ID</b>. Write it down, then click <b>Continue</b>. You are signed in.")
    m.note("This page only works on the computer where Ajoke POS is installed, so nobody else on the network can set up your business.")

    m.chapter("Sign in and finish", "Daily sign-in, your details and other devices")
    m.screen("signin", "Sign in with your staff ID and password, or your PIN.")
    m.bullets([
        "Sign in with your <b>staff ID and password</b>, or your staff ID and <b>PIN</b>.",
        "On a shared computer, leave <b>Remember this device</b> unticked. Ajoke POS also signs out after 10 minutes without use.",
        "Open <b>Settings</b> to add your address, phone numbers and receipt message. They print at the top and bottom of every receipt.",
        "Add your products under <b>Catalog</b> and your staff under <b>Staff</b>. Then open the register and start selling.",
        "On other computers and tablets, open the <b>Other devices</b> address from Step 4 in the browser.",
    ])
    m.para("The <b>User Manual</b> explains everything else, from selling to reports.")

    m.chapter("Looking after Ajoke POS", "Backups, updates, cloud and help")
    m.heading("Backups")
    m.para("A backup is saved every day at 21:00 in <b>C:\\AjokePOS\\backups</b> (the newest 30 are kept). Copy that folder to a USB drive "
           "or Google Drive every week. To back up now, right-click <b>C:\\AjokePOS\\backup.ps1</b> and choose <b>Run with PowerShell</b>.")
    m.heading("Updates")
    m.para("Your provider sends a new zip. Extract it and run <b>Install.cmd</b> again, exactly as above. Your data and activation are kept.")
    m.heading("Connect to the cloud later")
    m.para("Open PowerShell as administrator and run <b>C:\\AjokePOS\\connect-cloud.ps1</b>, then enter the cloud address and pairing code.")
    m.heading("If something is wrong")
    m.bullets([
        "<b>Ajoke POS does not open</b>: restart the computer and wait two minutes, then use the desktop shortcut.",
        "<b>Other devices cannot connect</b>: check they are on the same Wi-Fi and use the address from Step 4.",
        "<b>The installer stopped with a red message</b>: take a photo of the window and send it to your provider.",
        f"<b>Anything else</b>: send C:\\AjokePOS\\logs\\server.log to {vendor['name']}.",
    ])
    m.heading("Uninstall")
    m.para("Open PowerShell as administrator and run <b>C:\\AjokePOS\\uninstall.ps1</b>. Your data and backups stay in C:\\AjokePOS unless you add <b>-DeleteData</b>.")
    m.story.append(m.Spacer(1, 8 * m.mm))
    m.story.append(m.Table([[m.Paragraph(f"<font color='white'><b>{vendor['name']}</b><br/>WhatsApp {vendor['phone']}</font>", m.ParagraphStyle("contact", parent=m.body, fontSize=13, leading=19))]],
                           colWidths=[m.CONTENT_WIDTH], style=m.TableStyle([("BACKGROUND", (0, 0), (-1, -1), m.NAVY), ("LEFTPADDING", (0, 0), (-1, -1), 14), ("TOPPADDING", (0, 0), (-1, -1), 12), ("BOTTOMPADDING", (0, 0), (-1, -1), 10)])))


content()
m.build()
