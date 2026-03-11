# DIY Pokemon Card Maker

An AI-powered Pokemon trading card creator. Pick a color, animal, and superpower, or upload a photo with consent, and the app generates a unique creature image plus full card stats.

## Features

- AI image generation with Azure OpenAI (`gpt-image-1`)
- Card stat generation with structured JSON normalization
- Email delivery for finished cards and account restore links
- Account-bound credits instead of IP-bound credits
- Stripe checkout with idempotent credit fulfillment
- Photo mode with explicit consent capture
- Mobile-friendly single-page frontend

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your Azure OpenAI, Stripe, and email credentials
npm start
```

Run tests:

```bash
npm test
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `AZURE_OPENAI_API_KEY` | Azure OpenAI API key | Yes |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI endpoint URL | Yes |
| `EMAIL_SERVICE` | Email service (default: gmail) | No |
| `EMAIL_USER` | Sender email address | No |
| `EMAIL_PASS` | Email app password | No |
| `EMAIL_FROM` | Optional sender override | No |
| `STRIPE_SECRET_KEY` | Stripe secret key | For paid credits |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret | For paid credits |
| `BASE_URL` | Public app URL for redirects and restore links | Recommended |
| `TRUST_PROXY` | Express proxy trust setting | Recommended behind a proxy |
| `PORT` | Server port (default: 3000) | No |

## Tech Stack

- **Backend**: Express.js + SQLite + Azure OpenAI + Stripe
- **Card Rendering**: `@napi-rs/canvas`
- **Email**: Nodemailer
- **Frontend**: Vanilla HTML/CSS/JS

## Operational Notes

- Paid credits are attached to the account email and can be restored with an emailed sign-in link.
- Failed AI generations are refunded automatically before the response returns an error.
- Stripe webhook fulfillment is idempotent to prevent duplicate credit grants.
- Stripe webhook endpoint is `/api/webhook`; subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, and `checkout.session.async_payment_failed`.
- Photo uploads are processed transiently and are not intentionally stored after request completion.
