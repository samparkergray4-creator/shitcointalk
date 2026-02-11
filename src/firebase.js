// Firebase integration placeholder
// This will be implemented once you provide Firebase credentials

import admin from 'firebase-admin';

let db = null;
let bucket = null;

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
      }),
      storageBucket: `${projectId}.firebasestorage.app`
    });

    db = admin.firestore();
    bucket = admin.storage().bucket();
    console.log('✅ Firebase initialized');
    console.log('📦 Storage bucket:', bucket.name);
    return db;

  } catch (error) {
    console.error('❌ Firebase initialization failed:', error.message);
    return null;
  }
}

// Upload image to Firebase Storage
export async function uploadImage(imageBuffer, mint, imageType = 'image/png') {
  if (!bucket) {
    console.warn('⚠️ Firebase Storage not configured - bucket is null');
    return null;
  }

  try {
    const fileName = `tokens/${mint}.png`;
    const file = bucket.file(fileName);

    console.log(`📤 Uploading image to Firebase Storage: ${fileName} (${imageBuffer.length} bytes)`);

    await file.save(imageBuffer, {
      metadata: {
        contentType: imageType,
      },
      public: true,
    });

    // Make the file publicly accessible
    await file.makePublic();

    // Get public URL
    const publicUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
    console.log('✅ Image uploaded successfully:', publicUrl);
    return publicUrl;

  } catch (error) {
    console.error('❌ Error uploading image to Firebase Storage:');
    console.error('   Error code:', error.code);
    console.error('   Error message:', error.message);
    if (error.code === 404) {
      console.error('   💡 The storage bucket might not exist. Create it in Firebase Console:');
      console.error('      https://console.firebase.google.com/project/shitcointalk-acb2d/storage');
    }
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
    const threadData = {
      mint,
      name: coinData.name,
      symbol: coinData.symbol,
      description: coinData.description,
      image: coinData.image,
      creatorUsername: coinData.creatorUsername || 'Anonymous',
      twitter: coinData.twitter || '',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      commentCount: 0
    };

    // Don't store imageDataUrl in Firestore - it exceeds 1MB limit
    // Images should be uploaded to Firebase Storage instead

    await db.collection('threads').doc(mint).set(threadData);

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

// Get all threads (for coin list)
export async function getAllThreads(limit = 50) {
  if (!db) return [];

  try {
    const snapshot = await db.collection('threads')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  } catch (error) {
    console.error('Error getting all threads:', error);
    return [];
  }
}

// ===== DEV LOGS =====

// Add a dev log entry
export async function addDevLog(title, content) {
  if (!db) {
    throw new Error('Firebase not configured');
  }

  const docRef = await db.collection('dev_logs').add({
    title,
    content,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  });

  return docRef.id;
}

// Get dev logs ordered by newest first
export async function getDevLogs(limit = 50) {
  if (!db) return [];

  try {
    const snapshot = await db.collection('dev_logs')
      .orderBy('createdAt', 'desc')
      .limit(limit)
      .get();

    return snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));
  } catch (error) {
    console.error('Error getting dev logs:', error);
    return [];
  }
}

// Delete a dev log entry
export async function deleteDevLog(id) {
  if (!db) {
    throw new Error('Firebase not configured');
  }

  await db.collection('dev_logs').doc(id).delete();
}

export function getDb() { return db; }

export { db };
