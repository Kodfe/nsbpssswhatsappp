# NSB WhatsApp Alert Gateway

This is a small long-running Node service for WhatsApp low-stock alerts.

It uses `whatsapp-web.js`, so deploy it on Railway, Render, VPS, or a local always-on machine. Do not run this inside Vercel serverless functions because WhatsApp Web needs a persistent browser session.

## Setup

```bash
cd whatsapp-alert
npm install
npm run install:chrome
npm start
```

On Hostinger SSH, if the npm script still uses the home cache, run:

```bash
export PUPPETEER_CACHE_DIR=$PWD/.cache/puppeteer
npx puppeteer browsers install chrome --path ./.cache/puppeteer
npm start
```

Open `http://localhost:8080`, login with the same admin password as NSB POS:

```text
nsb@admin123
```

Scan the QR code from WhatsApp > Linked devices.

## Environment Variables

```text
PORT=8080
PUBLIC_URL=https://your-whatsapp-gateway.example.com
ADMIN_PASSWORD=nsb@admin123
API_TOKEN=change-this-token
DEFAULT_TO=919876543210
```

`PUBLIC_URL` is recommended, but the dashboard can also auto-detect the browser URL if it is not set.

If your host already has Chrome/Chromium installed, set one of these instead of downloading Chrome:

```text
PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome
```

or

```text
CHROME_PATH=/usr/bin/chromium
```

`DEFAULT_TO` is optional if you put the receiving number in NSB POS settings.

Important: the WhatsApp number connected as the sender and the receiving number must be different.

## NSB POS Settings

In Admin > Settings > WhatsApp Stock Alerts:

1. Enable WhatsApp low-stock alerts.
2. Paste the gateway API link shown on the gateway dashboard.
3. Paste the API token shown on the gateway dashboard.
4. Enter the receiving WhatsApp number with country code, for example `919876543210`.

When a sale takes stock from normal to low stock, NSB POS sends a notification through this gateway.

## API

```http
POST /api/stock-low
Authorization: Bearer <API_TOKEN>
Content-Type: application/json

{
  "to": "919876543210",
  "product": {
    "name": "Amul Milk",
    "barcode": "890...",
    "unit": "piece",
    "stock": 4,
    "minStock": 5
  }
}
```
