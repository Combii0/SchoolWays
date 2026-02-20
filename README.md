This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Web Push Notifications (Students)

This project now supports automatic push notifications for student accounts, including:

- Remaining stops after each pickup event.
- 15-minute and 5-minute ETA alerts.
- Pickup confirmation when the monitor marks the student's stop as boarded.

### Required environment variables

Add these variables to `.env.local`:

```bash
# Web Push (client)
NEXT_PUBLIC_FIREBASE_VAPID_KEY=your_web_push_certificate_key_pair

# Firebase Admin (server - required for /api/push/sync)
FIREBASE_ADMIN_PROJECT_ID=your_project_id
FIREBASE_ADMIN_CLIENT_EMAIL=your_service_account_client_email
FIREBASE_ADMIN_PRIVATE_KEY=\"-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n\"
```

Notes:

- Push registration is only enabled for non-monitor (student) accounts.
- `FIREBASE_ADMIN_PRIVATE_KEY` must keep escaped `\\n` line breaks in `.env.local`.
- The service worker is served from `/sw/firebase-messaging`.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.js`. The page auto-updates as you edit the file.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
