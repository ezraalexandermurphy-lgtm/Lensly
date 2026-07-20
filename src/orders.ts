import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';
import * as stripeLib from 'stripe';

const stripe = new stripeLib.Stripe(functions.config().stripe.secret_key, {
  apiVersion: '2023-10-16',
});

const db = admin.firestore();

/**
 * Stripe webhook handler for payment events.
 * Endpoint: POST /stripe-webhook
 */
export const stripeWebhook = functions.https.onRequest(async (req, res) => {
  const sig = req.headers['stripe-signature'] as string;
  const webhookSecret = functions.config().stripe.webhook_secret;

  let event: stripeLib.Event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
  } catch (err: any) {
    functions.logger.error(`Webhook signature verification failed: ${err.message}`);
    res.status(400).send(`Webhook Error: ${err.message}`);
    return;
  }

  // Handle the event
  switch (event.type) {
    case 'payment_intent.succeeded': {
      const paymentIntent = event.data.object as stripeLib.PaymentIntent;
      await handlePaymentSuccess(paymentIntent);
      break;
    }

    case 'payment_intent.payment_failed': {
      const paymentIntent = event.data.object as stripeLib.PaymentIntent;
      await handlePaymentFailed(paymentIntent);
      break;
    }

    case 'account.updated': {
      const account = event.data.object as stripeLib.Account;
      await handleAccountUpdated(account);
      break;
    }

    default:
      functions.logger.info(`Unhandled event type: ${event.type}`);
  }

  res.json({ received: true });
});

/**
 * Handles successful payment intents.
 * Updates order status and triggers fulfillment.
 */
async function handlePaymentSuccess(paymentIntent: stripeLib.PaymentIntent) {
  const ordersSnapshot = await db.collection('orders')
    .where('stripePaymentIntentId', '==', paymentIntent.id)
    .limit(1)
    .get();

  if (ordersSnapshot.empty) {
    functions.logger.error(`No order found for PaymentIntent: ${paymentIntent.id}`);
    return;
  }

  const orderDoc = ordersSnapshot.docs[0];
  const orderData = orderDoc.data();

  // Update order status
  await orderDoc.ref.update({
    status: 'paid',
    paidAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  functions.logger.info(`Order ${orderDoc.id} marked as paid`);

  // Trigger fulfillment based on order type
  if (orderData.type === 'product') {
    const productDoc = await db.collection('products').doc(orderData.productId).get();
    const productData = productDoc.data();

    if (productData?.type === 'digital') {
      // Digital products are fulfilled via download links (handled by generateDownloadUrl)
      await orderDoc.ref.update({
        status: 'completed',
        completedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      functions.logger.info(`Digital order ${orderDoc.id} auto-completed`);
    } else if (productData?.type === 'physical') {
      // Physical prints need fulfillment
      await orderDoc.ref.update({
        status: 'processing',
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      // Trigger print fulfillment
      await triggerPrintFulfillment(orderDoc.id, orderData);
    }
  } else if (orderData.type === 'service') {
    // Services are booked - mark as completed 
    // (actual completion happens after the photographer marks it done)
    functions.logger.info(`Service booking order ${orderDoc.id} is paid and awaiting session`);
  }
}

/**
 * Handles failed payment intents.
 */
async function handlePaymentFailed(paymentIntent: stripeLib.PaymentIntent) {
  const ordersSnapshot = await db.collection('orders')
    .where('stripePaymentIntentId', '==', paymentIntent.id)
    .limit(1)
    .get();

  if (ordersSnapshot.empty) {
    functions.logger.error(`No order found for failed PaymentIntent: ${paymentIntent.id}`);
    return;
  }

  const orderDoc = ordersSnapshot.docs[0];
  await orderDoc.ref.update({
    status: 'cancelled',
    cancelledAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  functions.logger.warn(`Order ${orderDoc.id} cancelled due to payment failure`);
}

/**
 * Handles Stripe Connect account updates.
 * Updates the photographer's onboarding status.
 */
async function handleAccountUpdated(account: stripeLib.Account) {
  const firebaseUid = account.metadata?.firebaseUid;
  if (!firebaseUid) {
    functions.logger.warn(`No firebaseUid in account metadata: ${account.id}`);
    return;
  }

  const isComplete = account.charges_enabled && account.payouts_enabled;

  await db.collection('users').doc(firebaseUid).update({
    stripeOnboardingComplete: isComplete,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  functions.logger.info(
    `Stripe account ${account.id} onboarding status: ${isComplete ? 'complete' : 'incomplete'}`
  );
}

/**
 * Triggers print fulfillment (called for physical products after payment).
 * This is a placeholder that enqueues a task for the fulfillment function.
 */
async function triggerPrintFulfillment(orderId: string, _orderData: any) {
  // In production, enqueue a Cloud Task or PubSub message
  // For now, directly call the fulfillment logic
  try {
    const { fulfillPrintOrder } = await import('./fulfillment');
    await fulfillPrintOrder(orderId);
  } catch (err) {
    functions.logger.error(`Failed to trigger print fulfillment for order ${orderId}:`, err);
  }
}