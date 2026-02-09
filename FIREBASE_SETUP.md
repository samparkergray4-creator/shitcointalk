# Firebase Setup Instructions

## Step 1: Create Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click "Add project"
3. Enter a project name (e.g., "bitcointalk-launchpad")
4. Disable Google Analytics (optional)
5. Click "Create project"

## Step 2: Create Firestore Database

1. In your Firebase project, click "Firestore Database" in the left sidebar
2. Click "Create database"
3. Choose "Start in production mode" (we'll set rules later)
4. Select a location (choose closest to your users)
5. Click "Enable"

## Step 3: Set Firestore Security Rules

In the Firestore "Rules" tab, paste this:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Allow anyone to read threads and comments
    match /threads/{threadId} {
      allow read: if true;
      allow write: if false; // Only backend can create threads

      match /comments/{commentId} {
        allow read: if true;
        allow write: if false; // Only backend can create comments
      }
    }
  }
}
```

Click "Publish"

## Step 4: Get Service Account Credentials

1. Click the gear icon ⚙️ next to "Project Overview"
2. Click "Project settings"
3. Go to "Service accounts" tab
4. Click "Generate new private key"
5. Click "Generate key" - this downloads a JSON file

## Step 5: Add Credentials to .env

Open the downloaded JSON file. It looks like:

```json
{
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com",
  ...
}
```

Update your `.env` file with these values:

```env
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
```

**Important**:
- Keep the quotes around `FIREBASE_PRIVATE_KEY`
- Keep the `\n` characters in the private key
- Never commit your `.env` file to git

## Step 6: Test the Connection

Start your server:

```bash
npm run dev
```

You should see:
```
✅ Firebase initialized
```

If you see a warning instead, check your credentials.

## Firestore Collections Structure

The app will automatically create these collections:

**threads/**
- Document ID: token mint address
- Fields: mint, name, symbol, description, image, createdAt, commentCount

**threads/{mint}/comments/**
- Auto-generated document IDs
- Fields: username, text, createdAt

## Optional: Create Indexes

If you plan to sort/filter threads later, create these indexes:

1. Go to Firestore → Indexes tab
2. Click "Create index"
3. Collection: `threads`
4. Fields:
   - `createdAt` (Descending)
   - `commentCount` (Descending)

This enables queries like "most recent" or "most commented" threads.

## Troubleshooting

**Error: "Firebase not configured"**
- Check that your `.env` file exists and has the correct values
- Make sure you're not using the example values from `.env.example`

**Error: "Private key must be a string"**
- Ensure `FIREBASE_PRIVATE_KEY` is wrapped in quotes in `.env`
- Keep the `\n` newline characters

**Error: "Permission denied"**
- Check your Firestore security rules
- The backend should have admin access via the service account
