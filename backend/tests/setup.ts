// Loaded before every test file: tests run offline, never with the real keys in backend/.env.
process.env.NODE_ENV = 'test';
for (const key of ['PAYPAL_CLIENT_ID', 'PAYPAL_SECRET', 'PAYPAL_WEBHOOK_ID', 'GEMINI_API_KEY', 'GEMINI_MODEL', 'DEMO_BUYER_EMAIL', 'AG_STUDIO_LICENSE']) process.env[key] = '';
