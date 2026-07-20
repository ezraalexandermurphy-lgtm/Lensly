import * as admin from 'firebase-admin';
import * as functions from 'firebase-functions';

const db = admin.firestore();

/**
 * Fulfills a physical print order via Prodigi or Gelato API.
 * Triggered by PubSub or called directly after payment confirmation.
 * 
 * This is a placeholder integration — replace with actual API calls
 * once the print fulfillment provider is selected.
 */
export const fulfillPrintOrder = functions.pubsub
  .schedule('every 5 minutes')
  .onRun(async (context) => {
    const pendingOrders = await db.collection('orders')
      .where('status', '==', 'processing')
      .where('type', '==', 'product')
      .where('fulfillmentStatus', '==', null)
      .limit(10)
      .get();

    if (pendingOrders.empty) {
      functions.logger.info('No pending print orders to fulfill');
      return;
    }

    const promises = pendingOrders.docs.map(async (doc) => {
      try {
        await processOrder(doc.id, doc.data());
      } catch (err: any) {
        functions.logger.error(`Failed to fulfill order ${doc.id}:`, err);
      }
    });

    await Promise.all(promises);
  });

/**
 * Process a single print order.
 * Replace with Prodigi or Gelato API integration.
 */
export async function processOrder(orderId: string, orderData: any): Promise<void> {
  functions.logger.info(`Processing print order: ${orderId}`, {
    productId: orderData.productId,
    selectedSize: orderData.selectedSize,
    shippingAddress: orderData.shippingAddress,
  });

  // TODO: Integrate with Prodigi API
  // const prodigi = new ProdigiApi({ apiKey: functions.config().prodigi.api_key });
  // const result = await prodigi.createOrder({ ... });

  // TODO: Integrate with Gelato API
  // const gelato = new GelatoApi({ apiKey: functions.config().gelato.api_key });
  // const result = await gelato.createOrder({ ... });

  // Placeholder: Mark as fulfilled immediately
  await db.collection('orders').doc(orderId).update({
    fulfillmentProvider: 'pending-setup',
    fulfillmentOrderId: `placeholder-${orderId}`,
    fulfillmentStatus: 'in_progress',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  functions.logger.info(`Print fulfillment initiated for order: ${orderId}`);

  // In production, the provider's webhook would update the status
  // For now, mark as completed after a delay
  await db.collection('orders').doc(orderId).update({
    fulfillmentStatus: 'shipped',
    trackingUrl: null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/**
 * Callable function to manually trigger fulfillment for testing.
 */
export const triggerFulfillment = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', 'You must be logged in.');
  }

  // Only admins or the photographer who owns the order can trigger
  const { orderId } = data;
  if (!orderId) {
    throw new functions.https.HttpsError('invalid-argument', 'orderId is required.');
  }

  const orderDoc = await db.collection('orders').doc(orderId).get();
  const orderData = orderDoc.data();

  if (!orderData) {
    throw new functions.https.HttpsError('not-found', 'Order not found.');
  }

  if (orderData.photographerId !== context.auth.uid) {
    throw new functions.https.HttpsError('permission-denied', 'You do not own this order.');
  }

  await processOrder(orderId, orderData);
  return { success: true, orderId };
});