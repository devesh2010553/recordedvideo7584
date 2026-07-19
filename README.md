# Pulse — Live Location Sharing

Minimal, consent-first live location sharing. Share a link → recipient opens it → browser asks for location permission → sharing starts immediately. Admin sees a live map, full history, and gets push notifications when sharing stops.

## Features

- **Auto-start**: recipient opens the link, browser permission dialog fires, location sharing starts — no extra button
- **Recipient sees**: animated radar + "Sharing live location" + elapsed time + stop button. No map, no coordinates shown to them.
- **Admin sees**: live map with full path, all coordinates in a scrollable history list, per-session delete
- **Push notifications**: admin gets a push notification (even when browser is closed) when someone stops sharing
- **MongoDB**: all data is stored in MongoDB Atlas — survives redeploys forever
- **Delete history**: admin can delete any session and its full location history from the dashboard
- **Android mode**: a consent-based APK can create a random anonymous session without a name, link, password, or pairing code
- **Link recovery**: temporary GPS and connection timeouts no longer falsely report that a valid link expired

## Android APK source

The complete Android Studio project is in `android-apk/` and points to
`https://recordedvideo7584.onrender.com/app`. The recipient must open the app,
tap **Allow & Start Sharing**, and approve Android's permission prompt. A random
session such as `Anonymous A1B2C3` then appears in the existing admin dashboard.

## Deploy to Render

### 1. MongoDB Atlas (free tier)

1. Go to [cloud.mongodb.com](https://cloud.mongodb.com) → Create free cluster
2. Database Access → Add a user with read/write permissions
3. Network Access → Add IP `0.0.0.0/0` (allow all — needed for Render)
4. Connect → Drivers → Copy the Node.js connection string

### 2. Generate VAPID keys

```bash
npm install
npm run generate-vapid
```

Copy the output — you'll need both keys.

### 3. Deploy

1. Push this repo to GitHub
2. Render → New Web Service → connect your repo
3. Build: `npm install` | Start: `npm start`
4. Add these environment variables in the Render dashboard:

| Variable | Value |
|---|---|
| `MONGODB_URI` | Your Atlas connection string |
| `ADMIN_PASSWORD` | Your chosen admin password |
| `SESSION_SECRET` | Any long random string |
| `VAPID_PUBLIC_KEY` | From `npm run generate-vapid` |
| `VAPID_PRIVATE_KEY` | From `npm run generate-vapid` |

### 4. Enable push alerts

1. Open your deployed app at `https://your-app.onrender.com/admin`
2. Sign in with your admin password
3. Click **Enable alerts** → allow notifications when the browser asks
4. Done — you'll get push notifications when someone stops sharing, even if the tab is closed

## How to use

1. Admin logs in → clicks **Create link** → gives it a label → copies the URL
2. Send the link to whoever needs to share their location
3. They open it → browser asks "Allow location?" → they tap Allow → sharing starts immediately
4. Admin's dashboard updates live. If the tab is closed, a push notification arrives when they stop.
5. Admin can view full coordinate history and delete sessions at any time.

## Local development

```bash
cp .env.example .env
# Fill in .env
npm install
npm start
```

Open http://localhost:3000/admin

## Notes on push notifications

- **Chrome/Edge/Firefox on Android/desktop**: background push works out of the box
- **iOS Safari**: requires the site to be added to the Home Screen (Apple's restriction on Web Push)
- Push fires on **stop** only (not on start), per design
