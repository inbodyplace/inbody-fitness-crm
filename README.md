# InBody Fitness CRM

A lightweight Node.js + Express server that receives [InBody Developers API](https://developers.inbody.com) webhooks, stores measurement events in MySQL, and exposes a simple dashboard UI for managing members.

## What it does

1. **Receives** InBody measurement webhooks and stores them in MySQL
2. **Fetches** full InBody data from the API immediately after each webhook (background)
3. **Serves** a dashboard at `http://localhost:3001/` showing recent events and stats
4. **Provides** REST APIs to browse member history, fetch live InBody data, and manage notes
5. **Auto-creates** the database schema on first startup — no migration step needed

```
────────────────────────────────────────────
  InBody Fitness CRM
  Dashboard : http://localhost:3001/
  Webhook   : POST http://localhost:3001/webhook
  API ready : Yes
────────────────────────────────────────────
```

## Quick Start

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values (see [Environment Variables](#environment-variables)).

### 3. Start MySQL

Make sure a MySQL 8+ instance is running and the database exists:

```sql
CREATE DATABASE inbody_crm CHARACTER SET utf8mb4;
```

The tables (`webhook_events`, `member_notes`) are created automatically on startup.

### 4. Start the server

```bash
npm start
```

Open **http://localhost:3001** in your browser.

## Environment Variables

| Variable               | Default                                | Description                                    |
| ---------------------- | -------------------------------------- | ---------------------------------------------- |
| `PORT`                 | `3001`                                 | Server port                                    |
| `INBODY_API_BASE_URL`  | `https://kr.developers.lookinbody.com` | InBody API base URL                            |
| `INBODY_ACCOUNT`       | —                                      | LookinBody Web account ID                      |
| `INBODY_API_KEY`       | —                                      | API key from InBody Developers → API Setup     |
| `DB_HOST`              | `localhost`                            | MySQL host                                     |
| `DB_PORT`              | `3306`                                 | MySQL port                                     |
| `DB_USER`              | `root`                                 | MySQL user                                     |
| `DB_PASSWORD`          | —                                      | MySQL password                                 |
| `DB_NAME`              | `inbody_crm`                           | MySQL database name                            |
| `WEBHOOK_HEADER_NAME`  | —                                      | Optional: custom header name for webhook auth  |
| `WEBHOOK_HEADER_VALUE` | —                                      | Optional: expected value for the custom header |

> If `INBODY_ACCOUNT` and `INBODY_API_KEY` are not set, the server still receives webhooks but skips the InBody API fetch step.

## API Endpoints

| Method   | Path                             | Description                                        |
| -------- | -------------------------------- | -------------------------------------------------- |
| `POST`   | `/webhook`                       | Receive InBody measurement webhook                 |
| `GET`    | `/api/stats`                     | Dashboard stats (today/week counts, total members) |
| `GET`    | `/api/events?limit=50`           | Recent webhook events (max 200)                    |
| `GET`    | `/api/members/:userId/history`   | Last 50 measurement events for a member            |
| `GET`    | `/api/members/:userId/inbody`    | Fetch last 10 measurements live from InBody API    |
| `GET`    | `/api/members/:userId/notes`     | List notes for a member                            |
| `POST`   | `/api/members/:userId/notes`     | Add a note `{ "note": "..." }`                     |
| `DELETE` | `/api/members/:userId/notes/:id` | Delete a note                                      |
| `POST`   | `/api/test-webhook`              | Inject a test event (dev use)                      |

## Webhook Payload

InBody sends a `POST` to `/webhook` with a JSON body:

```json
{
  "UserID": "member001",
  "TelHP": "01012345678",
  "Equip": "InBody770",
  "EquipSerial": "CC71700163",
  "TestDatetimes": "20240910143022",
  "Account": "your_account",
  "Type": "InBody",
  "IsTempData": "false"
}
```

- `IsTempData: "true"` events are stored with `fetch_status = skipped_temp` (no API call made)
- If a custom header is configured, requests missing or mismatching the header return `401`

## Database Schema

Two tables are created automatically:

**`webhook_events`** — one row per received webhook

| Column         | Type         | Description                                   |
| -------------- | ------------ | --------------------------------------------- |
| `id`           | INT          | Auto-increment PK                             |
| `user_id`      | VARCHAR(50)  | Member ID                                     |
| `test_at`      | VARCHAR(14)  | Measurement timestamp (`YYYYMMDDHHmmss`)      |
| `equip`        | VARCHAR(100) | Device model                                  |
| `is_temp`      | TINYINT      | 1 if temporary measurement                    |
| `inbody_data`  | JSON         | Full InBody API response (nullable)           |
| `fetch_status` | VARCHAR(30)  | `pending` / `success` / `error` / `skipped_*` |
| `received_at`  | DATETIME     | When the webhook arrived                      |

**`member_notes`** — free-form notes per member

| Column       | Type        | Description        |
| ------------ | ----------- | ------------------ |
| `id`         | INT         | Auto-increment PK  |
| `user_id`    | VARCHAR(50) | Member ID          |
| `note`       | TEXT        | Note content       |
| `created_at` | DATETIME    | Creation timestamp |

## Tech Stack

- **Node.js** + **Express** 4
- **MySQL** 8 via **mysql2**
- **Axios** for InBody API calls
- **dotenv** for configuration
- No ORM, no build step — plain SQL with parameterized queries
