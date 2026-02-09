# Bitcointalk Launchpad

A bitcointalk.org-themed memecoin launchpad for Solana with integrated forum discussions.

## Features

- Launch real tokens on pump.fun
- Auto-generated discussion threads for each coin
- Classic bitcointalk.org UI
- Live coin stats (MC, volume, holders)
- User authentication and comments

## Setup

1. Install dependencies:
```bash
npm install
```

2. Copy `.env.example` to `.env` and add your Firebase credentials

3. Run the server:
```bash
npm run dev
```

## Tech Stack

- Express.js backend
- Vanilla JS frontend (bitcointalk theme)
- Solana Web3.js + pump.fun integration
- Firebase Firestore (posts/users)
