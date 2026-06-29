# Pulse Live Location Share

A simple admin-controlled live-location sharing project with:

- MongoDB storage for all sharing links and full location history
- Admin map with live WebSocket updates
- Full saved history table with time, latitude, longitude, accuracy, and Google Maps link
- Admin can clear location history or delete the full link/history
- Web Push/VAPID notifications for admin when sharing starts and when first location is received
- Simple sharing page: the person sharing only sees text that live location is being shared, no map and no coordinates

## Important browser rule

A website cannot silently take location without browser permission. This app asks for location automatically when the share page opens, but the browser/user must allow the permission. If the browser blocks automatic permission prompts, the page shows an `Allow location sharing` button.

## Local setup

```bash
npm install
cp .env.example .env
npm run generate-vapid
```

Paste the generated keys into `.env`:

```env
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_KEY=...
```

Also add MongoDB:

```env
MONGODB_URI=mongodb+srv://USER:PASSWORD@CLUSTER.mongodb.net/pulse_location_share?retryWrites=true&w=majority
MONGODB_DB=pulse_location_share
ADMIN_PASSWORD=your-admin-password
SESSION_SECRET=any-long-random-string
VAPID_SUBJECT=mailto:your-email@example.com
```

Start:

```bash
npm start
```

Open:

```text
http://localhost:3000/admin
```

## Render deployment

Build command:

```bash
npm install
```

Start command:

```bash
npm start
```

Required Render environment variables:

```env
MONGODB_URI=your MongoDB Atlas connection string
MONGODB_DB=pulse_location_share
ADMIN_PASSWORD=your admin password
SESSION_SECRET=long random secret
VAPID_PUBLIC_KEY=generated public key
VAPID_PRIVATE_KEY=generated private key
VAPID_SUBJECT=mailto:your-email@example.com
```

## Push notification notes

- Web Push needs HTTPS in production. Render HTTPS works.
- On Android Chrome/Edge, normal web push works after admin enables alerts.
- On iPhone/iOS Safari, push notifications work only for sites added to the Home Screen, because of Apple's browser rules.
- Admin must open `/admin`, login, and click `Enable alerts` once.

## Share flow

1. Admin logs in at `/admin`.
2. Admin creates a sharing link.
3. Admin sends the `/share/<id>` link to the person.
4. Share page opens and requests location permission.
5. The person only sees `Sharing live location` and a stop button.
6. Admin sees live map + saved history.
7. History stays in MongoDB until admin clears history or deletes the link.
