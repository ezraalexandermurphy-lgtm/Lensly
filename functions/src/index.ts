import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';

admin.initializeApp();

// Export all function modules
export { createStripeAccount, createPaymentIntent, upgradeToPhotographer, generateDownloadUrl } from './stripe';
export { stripeWebhook } from './orders';
export { onUserCreate } from './auth';
export { fulfillPrintOrder } from './fulfillment';