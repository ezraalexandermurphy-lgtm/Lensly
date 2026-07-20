# Lensly — Firebase Schema & Backend Documentation

> **Last updated:** 2026-07-11  
> **Author:** Firebase Engineer  
> **Status:** Ratified

---

## 1. Firebase Project Setup

### Services Enabled
- **Firestore** (Native mode) — primary database
- **Authentication** — Email/Password + Google Sign-In
- **Cloud Storage** — for product images and digital download assets
- **Cloud Functions** — Node.js 18 runtime (Payment & order backend)

### Environment Variables (Cloud Functions)
| Variable | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Stripe API secret key |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret |
| `PRODIGI_API_KEY` | Print fulfillment API key (if using Prodigi) |
| `GELATO_API_KEY` | Print fulfillment API key (if using Gelato) |

---

## 2. Firestore Collections & Schemas

### `users` Collection

Document ID: `{userId}` (matches Firebase Auth UID)

```typescript
interface User {
  // System
  uid: string;              // Firebase Auth UID (document ID)
  email: string;
  displayName: string;
  photoURL: string | null;
  createdAt: Timestamp;
  updatedAt: Timestamp;

  // Role
  role: 'buyer' | 'photographer';  // Custom claim also set
  isOnboarded: boolean;     // Has completed profile setup

  // Profile (both roles)
  bio: string;
  location: GeoPoint | null;
  locationText: string;     // Human-readable location string
  phone: string | null;

  // Photographer-specific
  stripeAccountId: string | null;   // Stripe Connect Express account ID
  stripeOnboardingComplete: boolean;
  portfolioImageUrls: string[];     // Array of Firebase Storage URLs
  averageRating: number;            // 0-5
  totalReviews: number;
  tags: string[];                   // e.g. ["wedding", "portrait", "landscape"]
}
```

**Indexes:**  
- `role` — for querying photographers vs buyers
- `tags` (array) — for discovery
- `location` (GeoHash) — for nearby search

---

### `products` Collection

Document ID: auto-generated (`productId`)

```typescript
interface Product {
  // Core
  id: string;
  photographerId: string;       // Reference to users/{userId}
  title: string;
  description: string;
  type: 'digital' | 'physical';
  status: 'active' | 'draft' | 'archived';

  // Images
  imageUrls: string[];          // Firebase Storage URLs (max 10)
  thumbnailUrl: string;

  // Pricing
  price: number;                // In USD cents (stripe amount)
  currency: string;             // "usd"

  // Digital-specific
  filePath: string | null;      // Firebase Storage path to digital asset
  fileType: string | null;      // "image/jpeg", "image/raw", "pdf"

  // Physical-specific (print)
  availableSizes: PrintSize[] | null;
  shippingPrice: number | null; // In USD cents

  // Metadata
  location: GeoPoint | null;
  locationText: string | null;
  tags: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface PrintSize {
  label: string;                // "8×10", "11×14", "16×20"
  widthCm: number;
  heightCm: number;
  priceCents: number;           // Additional cost for this size
}
```

**Indexes:**  
- `photographerId` — for seller's own listing queries
- `status` — only show active products
- `type` — filter digital vs physical
- `tags` (array) — discovery
- `createdAt` (desc) — newest first feed
- Composite: `status + createdAt` — active listings sorted by date
- Composite: `type + price` — filtering by type and price range

---

### `services` Collection

Document ID: auto-generated (`serviceId`)

```typescript
interface Service {
  id: string;
  photographerId: string;       // Reference to users/{userId}
  title: string;                // e.g. "Portrait Session", "Wedding Photography"
  description: string;
  category: string;             // "portrait", "wedding", "event", "commercial", "real-estate"
  status: 'active' | 'draft' | 'archived';

  // Pricing
  price: number;                // Base price in USD cents
  currency: string;             // "usd"
  pricingType: 'fixed' | 'hourly' | 'package';

  // Hourly-specific
  hourlyRate: number | null;    // In USD cents
  minHours: number | null;

  // Package-specific
  packages: ServicePackage[] | null;

  // Availability
  bookingLeadDays: number;      // Minimum days in advance for booking
  durationMinutes: number;      // Estimated session duration

  // Media
  imageUrls: string[];
  thumbnailUrl: string;

  // Metadata
  location: GeoPoint | null;
  locationText: string;
  tags: string[];
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

interface ServicePackage {
  name: string;                 // "Basic", "Premium", "Deluxe"
  description: string;
  priceCents: number;
  deliverables: string[];       // e.g. ["10 edited photos", "1-hour session"]
}
```

**Indexes:**  
- `photographerId` — seller queries
- `category` — browse by category
- `status + category` — active services by category
- `price` — price range filtering
- `location` (GeoHash) — local discovery

---

### `orders` Collection

Document ID: auto-generated (`orderId`)

```typescript
interface Order {
  id: string;
  type: 'product' | 'service';       // What was purchased

  // Participants
  buyerId: string;                    // Reference to users/{userId}
  photographerId: string;             // Reference to users/{userId}

  // Product-specific
  productId: string | null;           // Reference to products/{productId}
  productSnapshot: ProductSnapshot | null;  // Frozen product data at time of purchase
  selectedSize: string | null;        // If physical print, which size

  // Service-specific (booking)
  serviceId: string | null;           // Reference to services/{serviceId}
  serviceSnapshot: ServiceSnapshot | null;
  bookingDate: Timestamp | null;
  bookingDuration: number | null;     // In minutes
  bookingAddress: string | null;      // Location for the shoot
  bookingNotes: string | null;

  // Payment
  stripePaymentIntentId: string;
  amountTotal: number;                // Total in USD cents (what buyer paid)
  platformFee: number;                // 10% of total in cents
  photographerPayout: number;         // Total minus platform fee in cents
  currency: string;
  status: OrderStatus;

  // Digital fulfillment
  digitalUrl: string | null;          // Signed download URL (expires)
  digitalUrlExpiresAt: Timestamp | null;

  // Physical fulfillment
  fulfillmentProvider: string | null; // "prodigi" | "gelato"
  fulfillmentOrderId: string | null;  // Provider's order ID
  fulfillmentStatus: string | null;   // "pending" | "in_progress" | "shipped" | "delivered"
  shippingAddress: Address | null;
  trackingUrl: string | null;

  // Timeline
  createdAt: Timestamp;
  updatedAt: Timestamp;
  paidAt: Timestamp | null;
  completedAt: Timestamp | null;
  cancelledAt: Timestamp | null;
}

type OrderStatus =
  | 'pending_payment'       // Awaiting Stripe confirmation
  | 'paid'                  // Payment confirmed
  | 'processing'            // Digital/physical fulfillment in progress
  | 'completed'             // Delivered or session done
  | 'cancelled'             // Cancelled by buyer or photographer
  | 'refunded';             // Refunded

interface ProductSnapshot {
  title: string;
  type: 'digital' | 'physical';
  price: number;
  imageUrl: string;
}

interface ServiceSnapshot {
  title: string;
  category: string;
  price: number;
  durationMinutes: number;
}

interface Address {
  line1: string;
  line2: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}
```

**Indexes:**  
- `buyerId` — buyer's order history
- `photographerId` — seller's sales history
- `status` — filter by order state
- Composite: `buyerId + status` — buyer's active/completed orders
- Composite: `photographerId + status` — seller's pending/completed orders
- `createdAt` (desc) — chronological listing
- `stripePaymentIntentId` — for Stripe webhook lookup

---

### `reviews` Collection

Document ID: auto-generated

```typescript
interface Review {
  id: string;
  orderId: string;                // Reference to orders/{orderId}
  reviewerId: string;             // Reference to users/{userId} (buyer)
  photographerId: string;         // Reference to users/{userId}
  rating: number;                 // 1-5
  text: string;
  createdAt: Timestamp;
}
```

**Indexes:**  
- `photographerId` — aggregate star rating
- `orderId` — prevent duplicate reviews per order
- Composite: `photographerId + createdAt` — newest reviews first

---

## 3. Authentication Setup

### Providers
1. **Email/Password** — standard sign-up with email verification
2. **Google Sign-In** — OAuth 2.0, configured in Firebase Console

### Custom Claims (set via Cloud Function on user creation)
```typescript
// On user sign-up or role selection:
claims: {
  role: 'buyer' | 'photographer'
}
```

### Auth Flow
1. User signs up (email/password or Google)
2. `onUserCreate` Cloud Function triggers:
   - Sets initial role to `buyer`
   - Creates user document in Firestore `users/{uid}`
3. User can upgrade to `photographer` via profile onboarding:
   - Calls Cloud Function `upgradeToPhotographer`
   - Sets custom claim `role: 'photographer'`
   - Creates Stripe Connect Express account
4. FlutterFlow reads custom claims via `auth.currentUser.getIdTokenResult()`

---

## 4. Cloud Functions

### Directory Structure
```
/functions
  /src
    /index.ts              — Entry point, exports all functions
    /auth.ts               — Auth triggers (onUserCreate)
    /stripe.ts             — Stripe Connect & Payment Intent functions
    /orders.ts             — Order lifecycle functions
    /fulfillment.ts        — Print fulfillment (Prodigi/Gelato)
    /storage.ts            — Signed URL generation
    /util.ts               — Shared helpers
  package.json
  tsconfig.json
```

### Function: `createStripeAccount`
- **Trigger:** Callable function (called when photographer completes onboarding)
- **What it does:**
  1. Creates a Stripe Connect Express account for the photographer
  2. Generates an account onboarding link
  3. Stores `stripeAccountId` in Firestore `users/{userId}`
  4. Returns the onboarding URL to the FlutterFlow app
- **Required scopes:** `transfers`, `read_write`

### Function: `createPaymentIntent`
- **Trigger:** Callable function (called when buyer proceeds to checkout)
- **What it does:**
  1. Validates the product/service exists and is active
  2. Validates the photographer has a Stripe account
  3. Creates a PaymentIntent with:
     - `amount`: total price in cents
     - `currency`: usd
     - `application_fee_amount`: 10% platform fee
     - `transfer_data[destination]`: photographer's Stripe account ID
  4. Stores order doc in Firestore with status `pending_payment`
  5. Returns the `client_secret` to the FlutterFlow app

### Function: `stripeWebhook`
- **Trigger:** HTTPS endpoint (POST `/stripe-webhook`)
- **Events handled:**
  - `payment_intent.succeeded`: Update order status to `paid`, trigger fulfillment
  - `payment_intent.payment_failed`: Update order status to error
  - `account.updated`: Update photographer's Stripe onboarding status

### Function: `generateDownloadUrl`
- **Trigger:** Callable function (called when buyer accesses digital purchase)
- **What it does:**
  1. Verifies the buyer owns the order
  2. Verifies the order is a digital product with status `paid` or `completed`
  3. Generates a Firebase Storage signed URL (valid for 24 hours)
  4. Stores the signed URL in the order document
  5. Returns the URL to the FlutterFlow app

### Function: `fulfillPrintOrder`
- **Trigger:** PubSub scheduled or Cloud Task (triggered after payment confirmed)
- **What it does:**
  1. Reads order with physical product details
  2. Calls Prodigi/Gelato API to create a print order
  3. Stores fulfillment order ID in Firestore
  4. Updates fulfillment status

### Function: `upgradeToPhotographer`
- **Trigger:** Callable function
- **What it does:**
  1. Sets `role: 'photographer'` custom claim
  2. Updates user doc role field
  3. Creates Stripe Connect Express account
  4. Returns onboarding URL

---

## 5. Firestore Security Rules

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // ============ Helper Functions ============

    function isAuthenticated() {
      return request.auth != null;
    }

    function isBuyer() {
      return isAuthenticated() && request.auth.token.role == 'buyer';
    }

    function isPhotographer() {
      return isAuthenticated() && request.auth.token.role == 'photographer';
    }

    function isOwner(userId) {
      return isAuthenticated() && request.auth.uid == userId;
    }

    function isAdmin() {
      return isAuthenticated() && request.auth.token.admin == true;
    }

    // ============ Users ============
    match /users/{userId} {
      // Users can read their own profile
      // Photographers' public profiles are readable by anyone
      allow read: if isAuthenticated() && (
        isOwner(userId) ||
        resource.data.role == 'photographer'
      );

      // Users can write their own profile
      // Can never change role (handled by Cloud Function)
      // Can never change stripeAccountId directly
      allow create: if isOwner(userId);
      allow update: if isOwner(userId) &&
        !(request.resource.data.diff(resource.data).affectedKeys()
          .hasAny(['role', 'stripeAccountId', 'uid']));
      allow delete: if false;  // Handled by Auth user deletion trigger
    }

    // ============ Products ============
    match /products/{productId} {
      // Active products are readable by all authenticated users
      allow read: if isAuthenticated() && (
        resource.data.status == 'active' ||
        isOwner(resource.data.photographerId)
      );

      // Only photographers can create/list products
      allow create: if isPhotographer() &&
        request.resource.data.photographerId == request.auth.uid;

      // Only the owning photographer can update
      allow update: if isPhotographer() &&
        resource.data.photographerId == request.auth.uid;

      // Only the owning photographer can delete
      allow delete: if isPhotographer() &&
        resource.data.photographerId == request.auth.uid;
    }

    // ============ Services ============
    match /services/{serviceId} {
      // Active services are readable by all authenticated users
      allow read: if isAuthenticated() && (
        resource.data.status == 'active' ||
        isOwner(resource.data.photographerId)
      );

      // Only photographers can create services
      allow create: if isPhotographer() &&
        request.resource.data.photographerId == request.auth.uid;

      // Only the owning photographer can update
      allow update: if isPhotographer() &&
        resource.data.photographerId == request.auth.uid;

      allow delete: if isPhotographer() &&
        resource.data.photographerId == request.auth.uid;
    }

    // ============ Orders ============
    match /orders/{orderId} {
      // Only participants (buyer & photographer) can read
      allow read: if isAuthenticated() && (
        resource.data.buyerId == request.auth.uid ||
        resource.data.photographerId == request.auth.uid
      );

      // Only Cloud Functions can create orders (via admin SDK)
      allow create: if false;  // Created by Cloud Function

      // Only Cloud Functions can update orders
      allow update: if false;  // Updated by Cloud Function

      allow delete: if false;
    }

    // ============ Reviews ============
    match /reviews/{reviewId} {
      // Reviews are publicly readable
      allow read: if isAuthenticated();

      // Buyer can create a review for an order they placed
      allow create: if isBuyer() &&
        request.resource.data.reviewerId == request.auth.uid &&
        request.resource.data.orderId != null;

      // Reviewer can update their own review
      allow update: if isOwner(resource.data.reviewerId);

      allow delete: if isOwner(resource.data.reviewerId);
    }
  }
}
```

---

## 6. Firebase Storage Rules

```
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    // Product images — photographer can upload, anyone authenticated can read
    match /products/{productId}/{fileName} {
      allow read: if request.auth != null;
      allow write: if request.auth != null &&
        request.auth.token.role == 'photographer' &&
        // Must be the product owner (checked against Firestore)
        firestore.exists(/databases/(default)/documents/products/$(productId)) &&
        firestore.get(/databases/(default)/documents/products/$(productId)).data.photographerId == request.auth.uid;
    }

    // Portfolio images — photographer can upload, anyone authenticated can read
    match /portfolios/{userId}/{fileName} {
      allow read: if request.auth != null;
      allow write: if request.auth.uid == userId &&
        request.auth.token.role == 'photographer';
    }

    // Digital downloads — only Cloud Functions generates signed URLs
    match /downloads/{productId}/{fileName} {
      allow read: if false;  // Use signed URLs from Cloud Function
      allow write: if false; // Uploaded via Admin SDK
    }

    // Profile photos — user can upload own, anyone authenticated can read
    match /avatars/{userId}/{fileName} {
      allow read: if request.auth != null;
      allow write: if request.auth.uid == userId;
    }
  }
}
```

---

## 7. FlutterFlow Integration Notes

### Collection Mappings

| FlutterFlow Collection | Firestore Collection | Key Bindings |
|---|---|---|
| `UserProfile` | `users` | Auto-bind by `uid` == current user |
| `ProductsList` | `products` | Query: `where status == active` |
| `MyProducts` | `products` | Query: `where photographerId == currentUid` |
| `ServicesList` | `services` | Query: `where status == active` |
| `MyServices` | `services` | Query: `where photographerId == currentUid` |
| `OrderHistory` | `orders` | Query: `where buyerId == currentUid` |
| `SalesHistory` | `orders` | Query: `where photographerId == currentUid` |

### Auth Setup in FlutterFlow
1. Enable Firebase Auth in FlutterFlow project settings
2. Enable Email/Password and Google providers
3. Use "ID Token" for custom claims access
4. Role-based navigation: check `auth.user?.customClaims['role']`

### Calling Cloud Functions
Use the "Callable Cloud Function" action in FlutterFlow:
- `createStripeAccount` — on photographer onboarding submit
- `createPaymentIntent` — on checkout button tap
- `generateDownloadUrl` — on "Download" button tap
- `upgradeToPhotographer` — on "Become a Photographer" button