import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';

/**
 * Triggered when a new user signs up via Firebase Auth.
 * Creates the user document in Firestore and sets initial role.
 */
export const onUserCreate = functions.auth.user().onCreate(async (user) => {
  const db = admin.firestore();

  const userData = {
    uid: user.uid,
    email: user.email || '',
    displayName: user.displayName || user.email?.split('@')[0] || 'User',
    photoURL: user.photoURL || null,
    role: 'buyer', // Default role; upgrade to photographer via upgradeToPhotographer
    isOnboarded: false,
    bio: '',
    location: null,
    locationText: '',
    phone: null,
    stripeAccountId: null,
    stripeOnboardingComplete: false,
    portfolioImageUrls: [],
    averageRating: 0,
    totalReviews: 0,
    tags: [],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  await db.collection('users').doc(user.uid).set(userData);

  // Set custom claim for role
  await admin.auth().setCustomUserClaims(user.uid, { role: 'buyer' });

  functions.logger.info(`User created: ${user.uid} (role: buyer)`);
  return;
});