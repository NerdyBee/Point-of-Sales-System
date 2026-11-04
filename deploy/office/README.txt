AJOKE POS OFFICE SERVER - INSTALLATION
=====================================

This installs Ajoke POS on the main computer in your shop. It works without internet.
If your provider also gave you an online (cloud) server, it copies everything there when
the internet is available, so you can see your business from anywhere.

WHAT YOU NEED
- A Windows 10 or 11 computer (64-bit) that stays on during business hours.
- Administrator access to that computer.
- Only if you have a cloud server: the cloud address from your provider (for example
  https://pos.yourbusiness.com) and a pairing code. The code works once and expires
  after 24 hours.

INSTALL
1. Right-click the zip file and choose "Extract All". Open the extracted AjokePOS folder.
2. Double-click Install.cmd. Click "Yes" when Windows asks for permission.
   If Windows shows "Windows protected your PC", click "More info" then "Run anyway".
3. Wait. When it asks for the cloud address:
   - With a cloud server: type the address and pairing code. It then downloads your
     business from the cloud. This can take a few minutes.
   - Without one: just press Enter to skip.
4. When it finishes, Ajoke POS opens in your browser. An "Ajoke POS" shortcut is now
   on the desktop.
   - With a cloud server: sign in with the staff ID and password your provider gave you.
   - Without one: the "Welcome to Ajoke POS" page appears. Enter your business name,
     currency, VAT and your owner details, then click "Create business". Write down the
     staff ID it shows you: you sign in with that staff ID and your password.
     Choose the currency carefully; it cannot be changed later.

Ajoke POS is installed in C:\AjokePOS and starts by itself whenever the computer starts.

OTHER COMPUTERS AND TABLETS IN THE SHOP
At the end, the installer shows an address such as http://192.168.1.20:4000.
Open it in the browser on any other computer or tablet connected to the same Wi-Fi.
Tip: ask whoever manages your router to give this computer a fixed IP address, so this
address never changes.

BACKUPS
A backup is saved every day at 21:00 in C:\AjokePOS\backups (the newest 30 are kept).
Copy that folder to a USB drive or Google Drive every week.
To back up right now: right-click C:\AjokePOS\backup.ps1 > "Run with PowerShell".

UPDATES
Your provider sends a new zip. Extract it and run Install.cmd again, exactly as above.
Your data is kept.

CONNECT TO THE CLOUD LATER
If you skipped the cloud step, or need to connect again, open PowerShell as
administrator and run:   C:\AjokePOS\connect-cloud.ps1

IF SOMETHING IS WRONG
- Ajoke POS does not open: restart the computer and wait 2 minutes.
- Send C:\AjokePOS\logs\server.log to your Ajoke POS provider.

UNINSTALL
Open PowerShell as administrator and run:   C:\AjokePOS\uninstall.ps1
Your data stays in C:\AjokePOS unless you add -DeleteData.
