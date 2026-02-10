import admin from 'firebase-admin';
import dotenv from 'dotenv';

dotenv.config();

admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL
  }),
  storageBucket: process.env.FIREBASE_PROJECT_ID + '.firebasestorage.app'
});

const bucket = admin.storage().bucket();

console.log('Testing bucket:', bucket.name);

try {
  const [exists] = await bucket.exists();
  console.log('✅ Bucket exists:', exists);

  if (exists) {
    // Try to list files
    const [files] = await bucket.getFiles({ maxResults: 5 });
    console.log(`📁 Files in bucket: ${files.length}`);
    files.forEach(file => console.log(`   - ${file.name}`));
  } else {
    console.log('❌ Bucket does not exist. You need to create it in Firebase Console.');
    console.log('   Go to: https://console.firebase.google.com/project/' + process.env.FIREBASE_PROJECT_ID + '/storage');
  }
} catch (err) {
  console.error('❌ Error:', err.message);
  if (err.code === 404) {
    console.log('💡 Bucket not found. Create it at:');
    console.log('   https://console.firebase.google.com/project/' + process.env.FIREBASE_PROJECT_ID + '/storage');
  }
}

process.exit(0);
