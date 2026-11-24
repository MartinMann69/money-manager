# Money Manager

A personal monthly budget app you can install on your phone and PC. No server, no account needed —
your data lives on your devices, and can optionally be synced through your own private GitHub Gist (encrypted).

## What it does

- **Month view** — income, fixed costs, budgets, credits and other spending for one month, plus how much is
  left at the end of the month. Swipe left/right (or use ‹ ›) to switch months.
- **Fixed costs & income** — rent, subscriptions, salary… monthly, every 2/3/6 months, or yearly.
  Tap one in the Month view to change it for *only this month* or *from this month on*, skip a month,
  or end it. Tick the circle to mark it as paid / received.
  Fixed costs can be put into **groups** (Rent & housing, School & education, Subscriptions, Insurance, Other, or
  your own), shown with subtotals in the Month and Plan tabs and in the "Where your money goes" chart.
- **Budgets** — plan e.g. €350 for food, add what you actually spend, and see what's left
  (or how much you're over) plus a per-day amount for the rest of the month.
  Turn on **Carry over** for a budget and unused money moves to next month (overspending is taken off next month).
- **Savings goals** (Goals tab) — "Holiday €1,200 by June": the app works out the monthly amount, counts it in
  every month's plan, and tells you if you're falling behind. Put less/more aside in a single month by tapping it
  in the Month view.
- **Thinking of buying** (Goals tab) — add things you'd like to buy, paid at once or in installments.
  The app checks whether it fits your plan and shows the earliest month it fits (green/red month buttons).
  Plan it for a month and it's included in that month's numbers; tap **Bought it** when you buy it.
  "Always keep at least" sets a cushion the app won't plan below.
- **Helper** tab — a budget coach that works only with your own numbers, on your device (rules of thumb, not
  financial advice): a money check-up score, a needs / wants / savings plan (50/30/20, adjusted when essentials are
  high) with one-tap budget suggestions, an emergency-fund goal and saving ahead for yearly bills, a subscriptions
  check (cost per year, price increases, overlapping services, cancel button), a buying plan for your wishlist that
  keeps a safety buffer, and tips from your spending history.
- **Colour line** in the month summary — how this month's income is split into fixed costs, credits, budgets,
  savings, other spending and what's left. Hover or tap a part or a category to see what's in it.
- **Arrange the Month view your way** — every card (Summary, Budgets, Income, Fixed costs, Payment calendar, …) can
  be dragged by its ⠿ handle to another place: the full-width area at the top or one of the columns. Cards you
  don't need all the time go into the **sidebar** (⇤ on the card, or drag it there); you can still open and edit them
  there, and drag them back or tap **＋ Add**. On a phone, use **↕ Arrange** for ↑ ↓ buttons. Remembered per
  device; "Reset layout" at the bottom of the sidebar puts everything back.
- **Other spending** — anything you paid that isn't in a budget.
- **Payment calendar** — set the day your money comes in and the day each cost, credit or savings amount is taken
  ("Comes in on day" / "Taken on day" in the form; the bank import fills it in automatically). The calendar runs
  from payday to payday: what's still coming is listed first, what already happened below it, each with what you'd
  have after that day, plus how much you should have right now and a warning if it gets tight before payday. Enter what was on your account on the 1st once so the amounts are real.
- **Needed until payday** — from one salary to the next: which bills are taken in between, how much that is, plus
  everyday spending from your budgets = how much you should keep on your account after payday. In the current period
  it also shows what's still to pay before the next salary and whether the money on your account covers it.
- **Leftover money carries over** — what you didn't spend shows up in the next month as "Still left from last month"
  and is added to what's left (overspending is taken off). It starts from the month you began using the app.
  Can be switched off in Settings → Leftover money & savings.
- **Free to spend** — the big tile at the top of the Month view: what you can spend on anything until your next
  salary and still pay everything: balance now − bills still to come − budget money still planned − planned purchases
  − your cushion ("Always keep at least" on the Goals tab). Shows a per-day amount; tap it for the breakdown.
- **Current balance** — shown at the top of every screen and on the Month view: an estimate of what's on your
  account today, from everything you entered. Tap it to correct it to what your bank shows; the app adjusts.
  Or choose **Start from this month**: the balance is then counted only from what you enter this month — add what
  you had left from last month as income — and every following month continues from there. Income and bills count
  once their day has passed or you tick them; ones without a day count once ticked.
- **Pay later / installments** — when adding an expense choose *Now*, *Next month* or *Installments*.
  "Next month" counts it in next month's total; installments become a credit.
- **Credits** — things you pay off over several months. Shows payment 3 of 6, what's still owed and
  when you're debt-free.
- **Overview** — a chart of the last 6 months (spent per category vs. income) and the next 12 months: what's left
  each month, warnings for months where you spend more than you earn, and your running balance (enter your current
  savings under Settings → Savings).
- **Import from your bank (CSV)** — Settings → *Import bank CSV…* (or the link under "Other spending").
  Works with most banks: the app detects the separator, date format, decimal comma/point and the columns, and you can
  correct them once — it remembers them per bank. Then you review every transaction before anything is added:
  - payments that match rent, subscriptions, salary, credits or savings goals **tick that item as paid** instead of
    adding a new entry (and use the real amount for that month if it differs),
  - other spending gets a suggested budget (from what you chose before for the same shop, or from well-known
    shop names like supermarkets, transport, restaurants),
  - transactions already imported, or that you already typed in by hand, start unticked,
  - choose "Don't import" for transfers between your own accounts.
- **Fold cards up** — tap a card's title to fold it; folded it shows a one-line summary (e.g. "1 of 8 paid · next:
  Internet"). "Collapse all / Expand all" on the Month view. Remembered on each device.
- **Transfer file** — Settings → *Save transfer file* / *Load transfer file*. Moves your data to another device
  (or serves as a backup). Loading combines the file with what's already there — newest version of every entry
  wins — so it works in both directions and an older file never overwrites newer changes.

## Run it locally

In the project folder start a small local web server and open http://localhost:5173:

```
python -m http.server 5173 --bind 127.0.0.1
```

Tip: in Chrome or Edge click the install icon in the address bar — Money Manager then gets its own window and
a Start-menu entry. Your data is stored in the browser per address, so always open it the same way
(local address or the online version) — or connect both to sync.

## Move data to your phone (transfer file)

1. On the PC: Settings → **Save transfer file** (goes to your Downloads).
2. Move the file to the phone (USB cable, cloud drive, email to yourself…).
3. On the phone, in Money Manager: Settings → **Load transfer file…** and pick it.
4. To bring phone changes back: same steps the other way round.

Note: the phone needs to be able to open the app. As long as it only runs on your PC, that means putting it online
(see below) — the transfer file itself works either way.

## Put it online so your phone can install it (free, GitHub Pages)

A phone can only install the app from an **https** address. The easiest free option is GitHub Pages:

1. Create a free account at https://github.com if you don't have one.
2. Create a new repository, e.g. `money-manager` (Public — the code has no personal data in it;
   your money data never goes into the repository).
3. Upload all files from this folder (`index.html`, `app.js`, `sync.js`, `styles.css`, `sw.js`,
   `manifest.webmanifest` and the `icons` folder) — "Add file → Upload files" on the GitHub website works.
4. In the repository: **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   branch `main`, folder `/ (root)` → Save.
5. After a minute it's live at `https://<your-username>.github.io/money-manager/`.

### Install on your phone

- **iPhone:** open the link in **Safari** → Share button → **Add to Home Screen**.
- **Android:** open the link in **Chrome** → ⋮ menu → **Install app**.
- **PC:** open the link in Chrome or Edge → install icon in the address bar.

## Sync phone and PC

1. Go to https://github.com/settings/personal-access-tokens/new
2. Name: `Money Manager`, choose an expiration (e.g. 1 year).
3. **Permissions → Account permissions → Gists → Read and write.** Nothing else.
   *(A classic token with only the `gist` scope works too.)*
4. Generate and copy the token.
5. In the app: **Settings → Sync phone & PC** → paste the token, pick an encryption passphrase → Connect.
6. Do the same on your other device with the **same token and passphrase**.

The app then syncs automatically when you change something and whenever you open it.
With a passphrase your data is encrypted (AES-256) on the device before upload, so the gist only contains
unreadable text. Both devices can be used offline; changes are merged the next time they sync.

When the token expires, create a new one and connect again (Settings → Disconnect → Connect).

## Files

| File | What it is |
| --- | --- |
| `index.html` | Page shell, tab bar |
| `app.js` | Data model, budget calculations, all screens and forms |
| `sync.js` | GitHub Gist sync, merging, encryption |
| `import.js` | Bank CSV import |
| `helper.js` | Helper tab (budget coach) |
| `styles.css` | Look & feel (follows light/dark mode of your device) |
| `sw.js` | Makes the app work offline |
| `manifest.webmanifest`, `icons/` | Makes it installable |

After changing files online, bump `CACHE` in `sw.js` (e.g. `mm-cache-v2`) so installed apps pick up the update.
