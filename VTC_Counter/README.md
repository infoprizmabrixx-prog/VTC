# VTC Counter Sales

A small billing app for the Vasavi Trading Company counter. Coffee (beans, or powder with a coffee:chicory ratio) and tea, sold by weight. No stock. Runs on the counter PC; the shop tablet joins over the shop Wi-Fi. One press prints one bill on the ATPOS 80 mm printer. Every day is saved to a folder you choose.

## 1. What you need

| Item | Notes |
|---|---|
| Windows PC at the counter | Stays on during shop hours. **Python 3.10+** installed — when installing, tick **"Add Python to PATH"**. |
| Google Chrome (or Microsoft Edge) | Used for one-press printing. |
| ATPOS AT-402 printer | Plugged into the PC with its Windows driver. In Windows Settings → Printers, make it the **default printer**, paper **80 mm**. Print a Windows test page once. |
| Shop tablet (optional) | Chrome, on the same Wi-Fi as the PC. |

## 2. First start (once)

1. Copy the `VTC_Counter` folder to the PC, e.g. `C:\VTC_Counter`.
2. Double-click **`start_counter.bat`**. The first time it needs internet for about 2 minutes.
3. A **"Choose the folder"** window opens: pick where every day is saved (a second drive, or a Google Drive / OneDrive folder, is safest). You can change it later in Setup → Shop & saving.
4. Windows may ask about the firewall for Python: choose **Allow on private networks** (needed for the tablet).
5. The counter opens in its own window. Sign in as **Owner / admin**: username `owner`, password `VTC-Owner-Demo26`. You must set your own password straight away. **Write it down somewhere safe.**

The first start also puts a **VTC Counter** icon (coffee bean) on your desktop. If you're updating an older copy, double-click **`make_desktop_icon.bat`** once to get it. Don't move the `VTC_Counter` folder afterwards, or the icon stops working (run `make_desktop_icon.bat` again if you do).

From then on, just double-click the **VTC Counter** icon each morning. Pressing it again while the counter is running only opens the window again. Daily starts don't need internet; only the first start after an update does. Keep the small "VTC Counter server" window open (minimised) — closing it stops billing on every device.

## 3. Owner set-up (once)

Setup →

1. **Items** — two separate lists: **Sell items** (walk-in customers, shown on Sell) and **Client items** (raw beans, roasted beans, bulk packs, shown only in Clients → Bill a client). Changing one list never changes the other. For each item: **item name** (short, on the Sell button), **name on the bill**, **price per kg**, **GST %**, and tick **Mix with chicory** for coffee powders (the cashier then picks the ratio). Beans and powder of the same coffee are two items, each with its own price.
2. **Prices & ratios** — the one chicory rate/kg, the ratio buttons (e.g. 100/0, 90/10, 80/20, 70/30), and the highest discount % a bill can get. The table shows every powder price.
   Mix price = coffee % × the item's price + chicory % × chicory rate. Example: item ₹900, chicory ₹300 → 80/20 = ₹780/kg.
3. **Shop & saving** — opening cash in the drawer each morning (Day close needs it), the bill number prefix, the accountant's GST approval, and the save folder.
4. **Bill layout** — shop name, address, phone, GSTIN, closing line, logo, and which parts show. The preview updates as you type. **Print test bill** prints one.
5. **People** — add each cashier with a 4–6 digit PIN. (Only the owner can add admins.)

## 4. Daily use

| Who | What |
|---|---|
| Cashier (PC or tablet) | Tap name → PIN. **Sell**: type in **Search items** (Enter adds the first match) or tap an item → for chicory mixes pick the ratio (button or type any %) → weight → add. Optional customer name/phone (a returning phone fills the name and offers "Same again"). **Take payment** → Cash / UPI / Card / Cash + UPI → **Complete & print**. |
| Cashier | **Item not in list** (on Sell): type the name on the bill, the amount ₹, weight (optional), then **your own PIN** to confirm. For that bill only. The owner sees who added it on the bill, in Reports and in the daily summary. |
| Cashier | **Today's bills**: view, reprint (marked DUPLICATE), office copy, **Ask to cancel** with a reason. |
| Owner / admin | Decide cancel requests (Today's bills). A cancelled bill stays in the records, marked CANCELLED. |
| Cashier or owner, at night | **Day close**: count the drawer, enter it. A difference needs a note; the owner sees it. Closing stops billing for today and **saves the day to your folder**. |
| Owner / admin | **Reports**: by day, items and kg sold, coffee and chicory used, discounts by cashier, cancelled bills, customers, **Excel**. |

## 4a. Clients (sales on credit)

The **Clients** menu (between Sell and Today's bills) is for cafés, hotels and shops that buy from you and pay later.

* **Clients** tab → **+ New client**: business name, phone (for WhatsApp), contact, address, GSTIN, and **old dues before this app** with the date they go back to.
* **Bill a client**: same as Sell, but with the client items. Search the client by name or phone and tap them (**Change client** to switch), add items; the price per kg can be changed for this client on any line (it is recorded, no reason needed). Then choose **Full credit**, **Part paid** or **Fully paid**. Client bills are numbered `CL-YYMM-NNNN`, separate from counter bills.
* The 80 mm bill shows the client's name, address and GSTIN, and **Paid now / This bill due / Total balance**.
* **Who owes**: every client's balance and how old it is (0–30, 31–60, 61–90, over 90 days). **Collect** records money received (cash, UPI, bank, cheque). It clears the oldest dues first; more than the balance stays as an advance. **Statement** shows every bill and payment (PDF to download). **WhatsApp** opens a reminder message. Owner/admin: **Excel of dues**.
* **Warning for old dues**: in Setup → Prices & ratios, set *Warn when a client's dues are older than (days)*. Empty = no warnings. When set, billing such a client on credit asks for a reason.
* Cash from clients (paid at billing or collected later) counts in **Day close**. Credit given today is shown there but is not in the drawer.
* A client bill can be cancelled the same day only (same approval as counter bills). A wrongly entered payment can be cancelled by owner/admin with a reason; it stays in the records.
* **Reports** split counter and client sales, and list credit given, dues collected and client price changes.

## 5. Printing

* **Straight to the printer (default on the counter PC).** The counter app sends each bill to the ATPOS as receipt-printer commands (ESC/POS): exactly 80 mm wide, one bill, cut at the end. No Chrome print window, no shrinking or turning, no date or "1/1" lines. Bills from the **tablet** print the same way.
* Setup → **Printer**: choose the printer (or keep the Windows default), letters per line (48 for 80 mm; choose 42 if the dashed lines wrap), and **Print test bill**.
* Amounts print as **Rs.** — thermal printer fonts have no ₹ sign.
* If a print fails (printer off, no paper), the sale is still saved and a message says why. Fix the printer and **Reprint** from Today's bills.
* **Through the browser** (fallback only): in Chrome's print window set the printer's 80 mm roll paper, Margins *None*, Scale 100, and untick *Headers and footers*.

## 6. The daily save

After Day close (and "Save today now" in Setup), this goes into your folder:

```
<your folder>\2026-10\2026-10-28\
    VTC_backup_2026-10-28.sqlite3   ← complete copy of everything (to restore)
    VTC_bills_2026-10-28.xlsx       ← every bill of the day, opens in Excel
    VTC_day_summary_2026-10-28.pdf  ← one page: totals, cash count, items, discounts, cancelled
```

If a day was not closed (PC switched off), it is saved automatically the next time the app starts.

**To restore** (new PC, or something broke): install as in section 2, close the app, put the backup file into `VTC_Counter\data\` named `vtc_counter.sqlite3`, start again.

## 7. Forgot the owner password?

On the counter PC, double-click **`reset_owner_password.bat`**. The owner sign-in goes back to `owner` / `VTC-Owner-Demo26` and you choose a new one. It is written in the audit log.

## 8. Limits to know

* The data lives on this PC (plus the daily copies in your folder). If the PC is off, nobody can bill.
* Use the tablet only on your own shop Wi-Fi. Never open port 8000 to the internet.
* Five wrong PIN/password tries lock that person for 10 minutes (owner/admin can reset in Setup → People).
