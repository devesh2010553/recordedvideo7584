const webpush = require('web-push');

const keys = webpush.generateVAPIDKeys();

console.log('\nVAPID keys generated. Add these to your environment variables (.env locally, or Render dashboard -> Environment):\n');
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log('\nKeep VAPID_PRIVATE_KEY secret. The public key is safe to expose to the browser.\n');
