#!/bin/bash
# Lensly Firebase Deployment Script
# Usage: ./deploy.sh
#
# Prerequisites:
# 1. Firebase project created at https://console.firebase.google.com
# 2. Run: firebase login (or set FIREBASE_TOKEN env var)
# 3. Run: firebase use --add <project-id>
# 4. Set Stripe config: firebase functions:config:set stripe.secret_key="sk_live_..." stripe.webhook_secret="whsec_..."
#
# Then run this script.

set -e

echo "=== Lensly Firebase Deployment ==="
echo ""

# Check for firebase CLI
if ! command -v firebase &> /dev/null; then
    echo "ERROR: firebase CLI not found. Install with: npm install -g firebase-tools"
    exit 1
fi

# Check if logged in
if ! firebase projects:list &> /dev/null; then
    echo "ERROR: Not logged into Firebase. Run: firebase login"
    exit 1
fi

echo "1. Deploying Firestore indexes..."
firebase deploy --only firestore:indexes

echo ""
echo "2. Deploying Firestore rules..."
firebase deploy --only firestore:rules

echo ""
echo "3. Deploying Storage rules..."
firebase deploy --only storage

echo ""
echo "4. Deploying Cloud Functions..."
firebase deploy --only functions

echo ""
echo "5. Setting up Stripe config..."
echo "   Run: firebase functions:config:set stripe.secret_key=\"sk_live_...\" stripe.webhook_secret=\"whsec_...\""
echo "   Then re-deploy: firebase deploy --only functions"

echo ""
echo "=== Deployment complete ==="
echo ""
echo "Next steps:"
echo "  1. Enable Email/Password + Google Auth in Firebase Console"
echo "  2. Enable Firestore (Native mode) in Firebase Console"
echo "  3. Set up Stripe webhook endpoint in Stripe Dashboard:"
echo "     https://us-central1-<project-id>.cloudfunctions.net/stripeWebhook"
echo "  4. Copy the webhook signing secret and set it with:"
echo "     firebase functions:config:set stripe.webhook_secret=\"whsec_...\""
echo "  5. Re-deploy functions after config change"