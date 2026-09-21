# VCPL Prototype — Simple User Guide

This guide explains the app in plain, easy language. It is made for the people who will use it every day in the company.

## 1. What this app does

- It takes the Excel / CSV files your office already uses (dispatch sheets, production logs, and so on).
- It opens them in a web page that everyone can see **and edit together**.
- It **saves every change automatically** — nothing is lost.
- It keeps **old versions** of your file, so you can go back if a mistake happens.
- It can **connect to your real office file** (device file), so the web page and the file stay in sync.
- It can **make calendar reports** (month, year, day) for tracking dates.

## 2. First time — create your account

1. Open the app in Chrome. Start page is the login page.
2. Click **"New user? Sign up"**.
3. Type your **name** and your **email address**.
4. Type a **password** (minimum 8 characters).
5. Click **Sign up**. You are now logged in.

> Note: if your boss creates the account for you, they will give you the sign-in details. Then just go to **Login**.

## 3. Log in

1. Type your **email** and **password**.
2. Click **Login**.
3. You land on your **home page**, which lists all your documents.

## 4. Add a new document (the "wizard")

1. On the home page, click **+ New Document**.
2. **Step 1 — File:** choose your Excel or CSV file from your computer.
3. **Step 2 — Fields:** check that the columns are read correctly.
4. **Step 3 — Details:** give the document a **name**, and choose a **date column** (the column that holds dates such as "Date" or "Dispatch Date").
5. Click **Create**. Your document opens in the editor.

## 5. Reading and editing your data

- The data opens as a **table** (rows and columns), 200 rows per page.
- **View / edit rows:** use the page numbers or **Previous / Next**.
- **Edit a cell:** press the **Modify** button, click a cell, and type. The change is **saved automatically** within a second.
- **Add a row or column:** click the **+** (add) button and choose Row, Column, Box, Copy Row or Copy Column.
- **Undo:** press the **Undo** button, or press **Ctrl + Z**.
- **Find something:** press **Ctrl + F**, type a word, and the app shows how many matches.
- **Save now:** press **Ctrl + S** (or click Save) any time you want an extra safe copy.

> On the top bar: **Modify** turns editing on/off, **Export** makes reports, **Device file** connects the real office file, **History** shows old versions.

## 6. Connect your real office file (device file)

For admin users only — this links the web page to the actual file on the computer/server.

1. Click **Device file**.
2. Type the **full file path**, for example `D:\Office\dispatch.xlsx`.
3. Click **Connect**.
4. The app reads that file. From then on, editing on the web page is written back to it automatically.

> If the file cannot be opened, the app shows a clear message — check the path and that the file is closed in Excel.

## 7. Calendar / date reports (Export)

1. Click **Export**.
2. Choose a mode: **Month**, **Year**, **Day** or a **date range**.
3. Choose what to include: **changes** (what was edited in that period), **rows** (the rows whose date falls in that period), or **both**.
4. Choose the file format: Excel, Word, text (CSV), PDF or JSON.
5. Click **Download**. The report downloads to your computer.

> Extra: the **Month** mode shows a small **calendar preview** on screen before you download, so you can check it first.

## 8. Version history and restore (undo mistakes on the whole file)

1. Click **History**.
2. The list shows **who changed what and when** (the last 200 versions).
3. To go back to an older version: hover over it and click **Restore**.
4. Confirm. A message appears saying the restore is done.

## 9. Work together (collaboration)

- Open the same document on two different computers and **both people see each other** (top bar shows "2 others editing").
- When one person edits, **everyone sees the change immediately**.
- Only people the owner **added as members** can open and edit a shared document.

**Adding members (owner):** on the document, use the members control, search a user by email, and Add. Members can view, edit, export and restore; only the owner can **delete** the document or **connect a device file**.

## 10. Your profile and look

- Click your name / avatar (top right) to see **Profile** — your name and email.
- Use the **dark mode** switch to make the app easier on the eyes at night. Your choice is remembered next time.
- Click **Logout** when you are finished. Always log out on shared computers.

## 11. Health check (for the technical person)

Admin/technical helper — the app has a health page at `http://localhost:3000/api/health` that shows:

- how long the app has been running (uptime),
- how many requests and saves happened,
- how many people are online right now,
- how much memory and how many documents exist.

## 12. Starting and stopping the app (for the technical person)

Install (once):
```
npm install
```

Start:
```
npm start
```

The app is then at **http://localhost:3000**. Press **Ctrl + C** in the terminal window to stop it.

Optional — run with Docker instead:
```
docker compose up
```

## Quick help — common problems

| Problem | Solution |
| --- | --- |
| "Incorrect email or password" | Check spelling and the password (8+ characters). |
| My file is "unsupported" | Use Excel (.xlsx) or CSV. Old .xls may not open. |
| My new row/column disappeared | Press **Undo** again to bring it back, then **reload** the page. |
| Someone can't open my shared doc | They must first have an account, then be **added as a member**. |
| The page shows "Not signed in" | Login again; sessions last 7 days. |

That's it — the everyday way to run this game-changing little tool is just: **Login → open your document → edit → it saves itself → export when needed.**