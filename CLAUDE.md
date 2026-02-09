# Bitcointalk Launchpad - Project Guide

## Overview

A bitcointalk.org-themed memecoin launchpad for Solana. Users can launch real tokens on pump.fun, which automatically creates a forum discussion thread. The forum replicates the classic bitcointalk aesthetic.

## Tech Stack

- **Backend**: Node.js + Express
- **Frontend**: Vanilla HTML/CSS/JS (no frameworks)
- **Blockchain**: Solana Web3.js + pump.fun API
- **Database**: Firebase Firestore (threads, comments, users)
- **Wallet**: Phantom integration

## Project Structure

```
bitcointalk/
├── src/
│   ├── server.js          # Express backend with launch & comment APIs
│   ├── firebase.js        # Firebase integration (threads, comments)
│   └── public/
│       ├── index.html     # Landing page with launch form
│       ├── thread.html    # Thread view with live coin stats
│       ├── css/
│       │   └── bitcointalk.css  # Classic forum styling
│       └── js/
│           ├── wallet.js   # Phantom wallet connection
│           ├── launch.js   # Token launch flow
│           └── thread.js   # Thread & comment handling
├── .env                   # Environment variables
└── package.json
```

## Token Launch Flow

1. **Prepare** (`/api/launch/prepare`):
   - User submits token metadata (name, symbol, description, image)
   - Backend uploads image to pump.fun IPFS
   - Generates mint & creator keypairs
   - Returns tokenMint address

2. **Create** (`/api/launch/create`):
   - Builds SOL transfer transaction (user → creator wallet)
   - Amount: ~0.02 SOL (creation) + 0.05 SOL (platform fee)
   - Returns unsigned transaction for user to sign

3. **Confirm** (`/api/launch/confirm`):
   - Verifies payment received
   - Calls PumpPortal API to create token on-chain
   - Creates Firebase thread for discussion
   - Returns thread URL

## Firebase Structure

### Collections

**threads** (root collection):
```js
{
  mint: string,           // Token mint address (document ID)
  name: string,
  symbol: string,
  description: string,
  image: string,          // IPFS URI
  createdAt: Timestamp,
  commentCount: number
}
```

**threads/{mint}/comments** (subcollection):
```js
{
  username: string,
  text: string,
  createdAt: Timestamp
}
```

## API Endpoints

### Launch
- `POST /api/launch/prepare` - Upload metadata, generate keypairs
- `POST /api/launch/create` - Build funding transaction
- `POST /api/launch/confirm` - Deploy token, create thread

### Coin Data
- `GET /api/coin/:mint` - Get live coin data from pump.fun

### Comments
- `GET /api/thread/:mint/comments` - Get all comments for a thread
- `POST /api/thread/:mint/comment` - Post a new comment

## Environment Variables

```env
RPC_URL=https://api.mainnet-beta.solana.com
PORT=3000
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY=your-private-key
FIREBASE_CLIENT_EMAIL=your-client-email
```

## Running the Project

```bash
# Install dependencies
npm install

# Start dev server (with auto-reload)
npm run dev

# Start production server
npm start
```

Server runs on `http://localhost:3000`

## Features Implemented

- ✅ Token launch with pump.fun integration
- ✅ IPFS metadata upload
- ✅ Phantom wallet connection
- ✅ Classic bitcointalk.org UI theme
- ✅ Thread pages with live coin stats (MC, volume, holders)
- ✅ Firebase comments system
- ✅ Auto-refresh stats every 10 seconds
- ✅ Responsive forum layout

## Features NOT Implemented (from pump-agent)

- ❌ Market making / trading agents
- ❌ Dashboard with charts/analytics
- ❌ WebSocket real-time updates
- ❌ AI components
- ❌ Agent management
- ❌ Price history tracking

## Design Philosophy

**Simplicity**: No React, no bundlers, no complexity. Just HTML/CSS/JS that works.

**Authenticity**: The UI closely replicates bitcointalk.org's classic forum design (circa 2013).

**Real tokens**: All tokens are deployed to Solana mainnet via pump.fun. This is production code.

## Security Notes

- Private keys are temporarily cached in-memory during launch flow (max 10 min TTL)
- Creator wallet keypairs are NOT stored long-term
- Users pay for token creation directly (no custodial wallet)
- No withdrawals or trading functionality (unlike pump-agent)

## Next Steps / TODOs

- [ ] Add Firebase credentials to .env
- [ ] Test full launch flow on devnet first
- [ ] Add coin list on homepage (query Firebase threads)
- [ ] Add pagination for comments
- [ ] Add user profiles / persistent usernames
- [ ] Add coin search functionality
- [ ] Add "sort by market cap" / "trending"
- [ ] Add moderation tools
