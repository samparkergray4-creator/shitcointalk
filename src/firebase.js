// Firebase integration placeholder
// This will be implemented once you provide Firebase credentials

import admin from 'firebase-admin';

let db = null;

export function initializeFirebase() {
  // Check if Firebase credentials are configured
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

  if (!projectId || projectId === 'your-project-id') {
    console.warn('⚠️  Firebase not configured. Using in-memory storage for now.');
    return null;
  }

  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId,
        privateKey: privateKey.replace(/\\n/g, '\n'),
        clientEmail
      })
    });

    db = admin.firestore();
    console.log('✅ Firebase initialized');
    return db;

  } catch (error) {
    console.error('❌ Firebase initialization failed:', error.message);
    return null;
  }
}

// Create a thread for a newly launched coin
export async function createThreadForCoin(mint, coinData) {
  if (!db) {
    console.log('Firebase not configured, skipping thread creation');
    return;
  }

  try {
    await db.collection('threads').doc(mint).set({
      mint,
      name: coinData.name,
      symbol: coinData.symbol,
      description: coinData.description,
      image: coinData.image,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      commentCount: 0
    });

    console.log(`Thread created for ${mint}`);
  } catch (error) {
    console.error('Error creating thread:', error);
  }
}

// Get thread data
export async function getThread(mint) {
  if (!db) return null;

  try {
    const doc = await db.collection('threads').doc(mint).get();
    return doc.exists ? doc.data() : null;
  } catch (error) {
    console.error('Error getting thread:', error);
    return null;
  }
}

// Get comments for a thread
export async function getComments(mint) {
  if (!db) return [];

  try {
    const snapshot = await db.collection('threads')
      .doc(mint)
      .collection('comments')
      .orderBy('createdAt', 'asc')
      .get();

    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  } catch (error) {
    console.error('Error getting comments:', error);
    return [];
  }
}

// Add a comment
export async function addComment(mint, username, text) {
  if (!db) {
    throw new Error('Firebase not configured');
  }

  try {
    const commentRef = await db.collection('threads')
      .doc(mint)
      .collection('comments')
      .add({
        username,
        text,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });

    // Increment comment count
    await db.collection('threads').doc(mint).update({
      commentCount: admin.firestore.FieldValue.increment(1)
    });

    return commentRef.id;
  } catch (error) {
    console.error('Error adding comment:', error);
    throw error;
  }
}

export { db };
