# Lensly Cloud Functions — Stripe Connect + Payments

## Overview

This directory contains the Firebase Cloud Functions for the Lensly Photography Marketplace. All payment processing uses Stripe Connect with Express accounts for automatic platform fee splitting.

## Deployment

```bash
# Deploy all functions
firebase deploy --only functions

# Deploy a specific function
firebase deploy --only functions:createPaymentIntent
```

## Environment Variables (set via `firebase functions:config:set`)

```bash
firebase functions:config:set stripe.secret_key="sk_live_..." stripe.webhook_secret="whsec_..."
```

## Function Endpoints

---

### 1. `upgradeToPhotographer`

**Type:** Callable  
**Purpose:** Converts a buyer account to photographer role, creates Stripe Connect Express account.

**Request:**
```typescript
{
  refreshUrl?: string;  // Onboarding refresh URL (default: app URL)
  returnUrl?: string;   // Onboarding return URL (default: app URL)
}
```

**Response:**
```typescript
{
  onboardingUrl: string;   // Stripe account onboarding link
  accountId: string;       // Stripe Connect account ID (acct_...)
}
```

**Errors:** `unauthenticated`, `not-found`, `already-exists`

---

### 2. `createStripeAccount`

**Type:** Callable  
**Purpose:** Creates or re-generates onboarding link for existing photographers.

**Request:**
```typescript
{
  refreshUrl?: string;
  returnUrl?: string;
}
```

**Response:**
```typescript
{
  onboardingUrl: string;
  accountId: string;
}
```

**Errors:** `unauthenticated`, `not-found`, `failed-precondition`

---

### 3. `createPaymentIntent`

**Type:** Callable  
**Purpose:** Creates a Stripe PaymentIntent with 10% platform fee and auto-transfer to photographer.

**Request:**
```typescript
{
  itemId: string;           // Product or Service document ID
  itemType: 'product' | 'service';
  selectedSize?: string;    // For physical prints: "8×10", "11×14", etc.
  bookingDate?: string;     // ISO date string (for services)
  bookingAddress?: string;  // Address for photo session (for services)
  bookingNotes?: string;
}
```

**Response:**
```typescript
{
  clientSecret: string;   // Stripe PaymentIntent client_secret
  orderId: string;        // Firestore order document ID
  amount: number;         // Total in cents
  platformFee: number;    // 10% fee in cents
}
```

**Flow:** 
1. Buyer → FlutterFlow → `createPaymentIntent` → Stripe PaymentIntent created
2. FlutterFlow uses `client_secret` to confirm payment via Stripe Payment Sheet
3. Stripe webhook `payment_intent.succeeded` updates order status

**Errors:** `unauthenticated`, `invalid-argument`, `not-found`, `failed-precondition`

---

### 4. `generateDownloadUrl`

**Type:** Callable  
**Purpose:** Generates a time-limited signed URL for digital download purchases.

**Request:**
```typescript
{
  orderId: string;   // Firestore order document ID
}
```

**Response:**
```typescript
{
  downloadUrl: string;   // Signed URL (valid 24 hours)
  expiresIn: string;     // "24h"
}
```

**Flow:**
1. Buyer opens their purchased digital product
2. FlutterFlow calls `generateDownloadUrl` with the order ID
3. Function verifies ownership, generates signed URL from Firebase Storage
4. URL is stored in the order document and returned to the app

**Errors:** `unauthenticated`, `invalid-argument`, `not-found`, `permission-denied`, `failed-precondition`

---

### 5. `stripeWebhook` (HTTPS endpoint)

**Type:** HTTPS (POST `/stripe-webhook`)  
**Purpose:** Listens for Stripe events to update order status and trigger fulfillment.

**Events handled:**

| Event | Action |
|---|---|
| `payment_intent.succeeded` | Updates order → `paid`, triggers digital auto-complete or print fulfillment |
| `payment_intent.payment_failed` | Updates order → `cancelled` |
| `account.updated` | Updates photographer's `stripeOnboardingComplete` status |

**Setup in Stripe Dashboard:**
- Add endpoint: `https://us-central1-<project-id>.cloudfunctions.net/stripeWebhook`
- Select events: `payment_intent.succeeded`, `payment_intent.payment_failed`, `account.updated`
- Copy signing secret → `firebase functions:config:set stripe.webhook_secret="whsec_..."`

---

### 6. `fulfillPrintOrder` (PubSub scheduled)

**Type:** Scheduled (every 5 minutes)  
**Purpose:** Processes pending physical print orders through Prodigi or Gelato API.

**Status:** Placeholder — requires print provider API key and integration.

---

## Firestore Order Status Flow

```
pending_payment → paid → processing → completed
                  → cancelled
                  → refunded
```

- **Digital products:** `paid` → auto-completed (download link available)
- **Physical prints:** `paid` → `processing` → `completed` (after fulfillment)
- **Services:** `paid` → stay at `paid` until photographer marks session complete

## Security Rules

Firestore and Storage rules are documented in:
- `/home/team/shared/firebase-schema.md` (Firestore rules)
- `functions/storage.rules` (Storage rules)

## Local Development

```bash
# Install dependencies
cd functions && npm install

# Run emulators
npm run serve

# Test a function
npm run shell
```