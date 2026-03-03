# 🃏 DIY Pokemon Card Maker

An AI-powered Pokemon trading card creator. Pick a color, animal, and superpower — the AI generates a unique creature image and full trading card stats!

## Features

- 🎨 **AI Image Generation** — DALL-E 3 creates unique creature artwork
- 🃏 **Trading Card Stats** — GPT generates name, HP, attacks, and flavor text
- 📧 **Email Delivery** — Cards are rendered as high-res JPEGs and emailed
- 📱 **Mobile-friendly** — Works great on phones for on-the-go card creation

## Setup

```bash
npm install
cp .env.example .env
# Edit .env with your Azure OpenAI credentials
npm start
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `AZURE_OPENAI_API_KEY` | Azure OpenAI API key | Yes |
| `AZURE_OPENAI_ENDPOINT` | Azure OpenAI endpoint URL | Yes |
| `EMAIL_SERVICE` | Email service (default: gmail) | No |
| `EMAIL_USER` | Sender email address | No |
| `EMAIL_PASS` | Email app password | No |
| `PORT` | Server port (default: 3000) | No |

## Tech Stack

- **Backend**: Express.js + Azure OpenAI (DALL-E 3 + GPT-5-mini)
- **Card Rendering**: @napi-rs/canvas (server-side JPEG generation)
- **Email**: Nodemailer
- **Frontend**: Vanilla HTML/CSS/JS (Fredoka font)
