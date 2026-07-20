import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import * as stripeLib from 'stripe';

const stripe = new stripeLib.Stripe(functions.config().stripe.secret_key, {
  apiVersion: '2023-10-16',
});

const db = admin.firestore();

/**
 * Upgrades a buyer account to photographer role.
 * Creates Stripe Connect Express account for payouts.
 */
export const upgradeToPhotographer = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'You must be logged in.');
  }

  const userId = context.auth.uid;
  const userDoc = await db.collection('users').doc(userId).get();
  const userData = userDoc.data();

  if (!userData) {
    throw new functions.https.HttpsError('not-found', 'User profile not found.');
  }

  if (userData.role === 'photographer') {
    throw new functions.https.HttpsError('already-exists', 'You are already a photographer.');
  }

  // Create Stripe Connect Express account
  const account = await stripe.accounts.create({
    type: 'express',
    country: 'US',
    email: userData.email,
    capabilities: {
      transfers: { requested: true },
    },
    business_type: 'individual',
    metadata: {
      firebaseUid: userId,
    },
  });

  // Update user document
  await db.collection('users').doc(userId).update({
    role: 'photographer',
    stripeAccountId: account.id,
    stripeOnboardingComplete: false,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  // Set custom claim
  await admin.auth().setCustomUserClaims(userId, { role: 'photographer' });

  // Generate Stripe onboarding link
  const accountLink = await stripe.accountLinks.create({
    account: account.id,
    refresh_url: data.refreshUrl || 'https://lensly.app/onboarding/refresh',
    return_url: data.returnUrl || 'https://lensly.app/onboarding/complete',
    type: 'account_onboarding',
  });

  functions.logger.info(`Photographer upgraded: ${userId}, Stripe account: ${account.id}`);
  return { onboardingUrl: accountLink.url, accountId: account.id };
});

/**
 * Creates a Stripe Connect Express account for an existing photographer.
 * Used for re-onboarding if the account was not completed.
 */
export const createStripeAccount = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'You must be logged in.');
  }

  const userId = context.auth.uid;
  const userDoc = await db.collection('users').doc(userId).get();
  const userData = userDoc.data();

  if (!userData) {
    throw new functions.https.HttpsError('not-found', 'User profile not found.');
  }

  if (userData.role !== 'photographer') {
    throw new functions.https.HttpsError('failed-precondition', 'You must be a photographer to create a Stripe account.');
  }

  // If account already exists, generate new onboarding link
  if (userData.stripeAccountId) {
    const accountLink = await stripe.accountLinks.create({
      account: userData.stripeAccountId,
      refresh_url: data.refreshUrl || 'https://lensly.app/onboarding/refresh',
      return_url: data.returnUrl || 'https://lensly.app/onboarding/complete',
      type: 'account_onboarding',
    });

    return { onboardingUrl: accountLink.url, accountId: userData.stripeAccountId };
  }

  // Create new account
  const account = await stripe.accounts.create({
    type: 'express',
    country: 'US',
    email: userData.email,
    capabilities: {
      transfers: { requested: true },
    },
    business_type: 'individual',
    metadata: {
      firebaseUid: userId,
    },
  });

  await db.collection('users').doc(userId).update({
    stripeAccountId: account.id,
    stripeOnboardingComplete: false,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const accountLink = await stripe.accountLinks.create({
    account: account.id,
    refresh_url: data.refreshUrl || 'https://lensly.app/onboarding/refresh',
    return_url: data.returnUrl || 'https://lensly.app/onboarding/complete',
    type: 'account_onboarding',
  });

  functions.logger.info(`Stripe account created: ${account.id} for user: ${userId}`);
  return { onboardingUrl: accountLink.url, accountId: account.id };
});

/**
 * Creates a PaymentIntent for a product or service purchase.
 * Includes 10% platform fee and automatic transfer to photographer.
 */
export const createPaymentIntent = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'You must be logged in.');
  }

  const buyerId = context.auth.uid;
  const { itemId, itemType, selectedSize } = data;

  if (!itemId || !itemType) {
    throw new functions.https.HttpsError('invalid-argument', 'itemId and itemType are required.');
  }

  if (!['product', 'service'].includes(itemType)) {
    throw new functions.https.HttpsError('invalid-argument', 'itemType must be "product" or "service".');
  }

  // Fetch the item from Firestore
  const collectionName = itemType === 'product' ? 'products' : 'services';
  const itemDoc = await db.collection(collectionName).doc(itemId).get();
  const itemData = itemDoc.data();

  if (!itemData) {
    throw new functions.https.HttpsError('not-found', `${itemType} not found.`);
  }

  if (itemData.status !== 'active') {
    throw new functions.https.HttpsError('failed-precondition', `${itemType} is not available.`);
  }

  if (itemData.photographerId === buyerId) {
    throw new functions.https.HttpsError('failed-precondition', 'You cannot purchase your own listing.');
  }

  // Get photographer's Stripe account
  const photographerDoc = await db.collection('users').doc(itemData.photographerId).get();
  const photographerData = photographerDoc.data();

  if (!photographerData || !photographerData.stripeAccountId) {
    throw new functions.https.HttpsError('failed-precondition', 'Photographer has not set up payments.');
  }

  if (!photographerData.stripeOnboardingComplete) {
    throw new functions.https.HttpsError('failed-precondition', 'Photographer has not completed payment onboarding.');
  }

  // Calculate price
  let amount = itemData.price;
  if (itemType === 'product' && selectedSize && itemData.availableSizes) {
    const size = itemData.availableSizes.find((s: any) => s.label === selectedSize);
    if (size) {
      amount = size.priceCents;
    }
  }

  // Calculate platform fee (10%)
  const platformFee = Math.round(amount * 0.10);
  const photographerPayout = amount - platformFee;

  // Create the PaymentIntent
  const paymentIntent = await stripe.paymentIntents.create({
    amount,
    currency: 'usd',
    application_fee_amount: platformFee,
    transfer_data: {
      destination: photographerData.stripeAccountId,
    },
    metadata: {
      itemType,
      itemId,
      buyerId,
      photographerId: itemData.photographerId,
    },
  });

  // Create order document in Firestore
  const orderData: any = {
    type: itemType,
    buyerId,
    photographerId: itemData.photographerId,
    stripePaymentIntentId: paymentIntent.id,
    amountTotal: amount,
    platformFee,
    photographerPayout,
    currency: 'usd',
    status: 'pending_payment',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  };

  if (itemType === 'product') {
    orderData.productId = itemId;
    orderData.productSnapshot = {
      title: itemData.title,
      type: itemData.type,
      price: itemData.price,
      imageUrl: itemData.thumbnailUrl || (itemData.imageUrls ? itemData.imageUrls[0] : null),
    };
    if (selectedSize) {
      orderData.selectedSize = selectedSize;
    }
  } else {
    orderData.serviceId = itemId;
    orderData.serviceSnapshot = {
      title: itemData.title,
      category: itemData.category,
      price: itemData.price,
      durationMinutes: itemData.durationMinutes,
    };
    if (data.bookingDate) {
      orderData.bookingDate = admin.firestore.Timestamp.fromDate(new Date(data.bookingDate));
    }
    if (data.bookingAddress) {
      orderData.bookingAddress = data.bookingAddress;
    }
    if (data.bookingNotes) {
      orderData.bookingNotes = data.bookingNotes;
    }
  }

  const orderRef = await db.collection('orders').add(orderData);

  // Update order with its own ID
  await orderRef.update({ id: orderRef.id });

  functions.logger.info(`PaymentIntent created: ${paymentIntent.id} for order: ${orderRef.id}`);

  return {
    clientSecret: paymentIntent.client_secret,
    orderId: orderRef.id,
    amount,
    platformFee,
  };
});

/**
 * Generates a time-limited signed URL for digital download purchases.
 */
export const generateDownloadUrl = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'You must be logged in.');
  }

  const userId = context.auth.uid;
  const { orderId } = data;

  if (!orderId) {
    throw new functions.https.HttpsError('invalid-argument', 'orderId is required.');
  }

  const orderDoc = await db.collection('orders').doc(orderId).get();
  const orderData = orderDoc.data();

  if (!orderData) {
    throw new functions.https.HttpsError('not-found', 'Order not found.');
  }

  if (orderData.buyerId !== userId) {
    throw new functions.https.HttpsError('permission-denied', 'You do not own this order.');
  }

  if (orderData.type !== 'product') {
    throw new functions.https.HttpsError('failed-precondition', 'This order is not a product purchase.');
  }

  if (orderData.status !== 'paid' && orderData.status !== 'completed') {
    throw new functions.https.HttpsError('failed-precondition', 'Order is not yet paid.');
  }

  // Get the product to find the file path
  const productDoc = await db.collection('products').doc(orderData.productId).get();
  const productData = productDoc.data();

  if (!productData || !productData.filePath) {
    throw new functions.https.HttpsError('not-found', 'Digital file not found.');
  }

  // Generate signed URL valid for 24 hours
  const bucket = admin.storage().bucket();
  const file = bucket.file(productData.filePath);
  const [signedUrl] = await file.getSignedUrl({
    action: 'read',
    expires: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
  });

  // Store the signed URL in the order
  await orderDoc.ref.update({
    digitalUrl: signedUrl,
    digitalUrlExpiresAt: admin.firestore.Timestamp.fromDate(
      new Date(Date.now() + 24 * 60 * 60 * 1000)
    ),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  functions.logger.info(`Download URL generated for order: ${orderId}`);

  return { downloadUrl: signedUrl, expiresIn: '24h' };
});