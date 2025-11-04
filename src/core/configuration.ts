export default () => ({
  port: parseInt(process.env.PORT!, 10) || 3000,
  environment: process.env.NODE_ENV || 'development',
  databaseUrl: process.env.DATABASE_URL,
  apiKey: process.env.API_KEY,
  apiUrl: process.env.API_URL || 'http://localhost:3000',
  corsAllowedUrls: '*',
  shopify: {
    appProxy:{
        clientId: process.env.SHOPIFY_CLIENT_ID,
        clientSecret: process.env.SHOPIFY_CLIENT_SECRET,
        scopes: process.env.SHOPIFY_SCOPES ? process.env.SHOPIFY_SCOPES.split(',') : ['read_products', 'read_orders', 'read_inventory', 'read_locations'],
    },
    apiVersion: process.env.SHOPIFY_API_VERSION || '2025-10',
  },
});