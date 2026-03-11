'use strict';

// =============================================================================
// server.js - Express REST API + MQTT Bridge
// Sano Vending Machine Backend
// =============================================================================

const express = require('express');
const cors = require('cors');
const morgan = require('morgan');
const mqttClient = require('./mqtt-client');
const { MqttClient } = require('./mqtt-client');

const app = express();
const PORT = process.env.PORT || 3000;

// =============================================================================
// Middleware
// =============================================================================
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(morgan('combined'));

// =============================================================================
// Utility helpers
// =============================================================================

/**
 * Normalize MAC address: lowercase, remove colons
 * "08:7B:3A:F1:22:90" -> "087b3af12290"
 */
function normalizeMac(mac) {
  return mac.toLowerCase().replace(/:/g, '');
}

/**
 * Validate MAC address format (with or without colons)
 */
function isValidMac(mac) {
  const withColons = /^([0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$/;
  const withoutColons = /^[0-9A-Fa-f]{12}$/;
  return withColons.test(mac) || withoutColons.test(mac);
}

/**
 * Standard API response wrapper
 */
function apiResponse(res, statusCode, data) {
  return res.status(statusCode).json({
    success: statusCode >= 200 && statusCode < 300,
    timestamp: new Date().toISOString(),
    ...data,
  });
}

/**
 * Async route handler wrapper
 */
function asyncRoute(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// =============================================================================
// Middleware: Validate MAC param on all /api/machine/:mac routes
// =============================================================================
app.param('mac', (req, res, next, mac) => {
  if (!isValidMac(mac)) {
    return apiResponse(res, 400, {
      error: 'Invalid MAC address format',
      example: '087b3af12290 or 08:7B:3A:F1:22:90',
    });
  }
  req.normalizedMac = normalizeMac(mac);
  next();
});

// =============================================================================
// Health & Status Routes
// =============================================================================

/** GET /health - Health check (used by Docker) */
app.get('/health', (req, res) => {
  const mqtt = mqttClient.getStatus();
  const healthy = mqtt.connected;
  return res.status(healthy ? 200 : 503).json({
    status: healthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    mqtt,
  });
});

/** GET /api/status - Detailed system status */
app.get('/api/status', (req, res) => {
  return apiResponse(res, 200, {
    service: 'sano-mqtt-backend',
    version: '1.0.0',
    mqtt: mqttClient.getStatus(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
  });
});

// =============================================================================
// Vending Machine API Routes
// =============================================================================

/**
 * PUT /api/machine/:mac/prices
 * Update product prices for a vending machine
 *
 * Body: { "prices": [{ "barcode": "123456", "price": "2.50" }] }
 */
app.put('/api/machine/:mac/prices', asyncRoute(async (req, res) => {
  const { mac, normalizedMac } = req;
  const { prices } = req.body;

  if (!Array.isArray(prices) || prices.length === 0) {
    return apiResponse(res, 400, { error: '"prices" must be a non-empty array' });
  }

  for (const item of prices) {
    if (!item.barcode || item.price === undefined) {
      return apiResponse(res, 400, {
        error: 'Each price item must have "barcode" and "price"',
        received: item,
      });
    }
  }

  const payload = MqttClient.buildPricePayload(prices);
  const result = await mqttClient.publishToMachine(normalizedMac, payload);

  return apiResponse(res, 200, {
    message: `Prices sent to machine ${normalizedMac}`,
    mqtt: result,
    payload,
  });
}));

/**
 * PUT /api/machine/:mac/names
 * Update product names for a vending machine
 *
 * Body: { "names": [{ "barcode": "123456", "name": "Coca Cola 500ml" }] }
 */
app.put('/api/machine/:mac/names', asyncRoute(async (req, res) => {
  const { normalizedMac } = req;
  const { names } = req.body;

  if (!Array.isArray(names) || names.length === 0) {
    return apiResponse(res, 400, { error: '"names" must be a non-empty array' });
  }

  for (const item of names) {
    if (!item.barcode || !item.name) {
      return apiResponse(res, 400, {
        error: 'Each name item must have "barcode" and "name"',
        received: item,
      });
    }
  }

  const payload = MqttClient.buildNamesPayload(names);
  const result = await mqttClient.publishToMachine(normalizedMac, payload);

  return apiResponse(res, 200, {
    message: `Product names sent to machine ${normalizedMac}`,
    mqtt: result,
    payload,
  });
}));

/**
 * PUT /api/machine/:mac/images
 * Update product images for a vending machine
 *
 * Body: { "images": [{ "barcode": "123456", "image": "https://..." }] }
 */
app.put('/api/machine/:mac/images', asyncRoute(async (req, res) => {
  const { normalizedMac } = req;
  const { images } = req.body;

  if (!Array.isArray(images) || images.length === 0) {
    return apiResponse(res, 400, { error: '"images" must be a non-empty array' });
  }

  for (const item of images) {
    if (!item.barcode || !item.image) {
      return apiResponse(res, 400, {
        error: 'Each image item must have "barcode" and "image" (URL or base64)',
        received: item,
      });
    }
  }

  const payload = MqttClient.buildImagesPayload(images);
  const result = await mqttClient.publishToMachine(normalizedMac, payload);

  return apiResponse(res, 200, {
    message: `Product images sent to machine ${normalizedMac}`,
    mqtt: result,
    payload,
  });
}));

/**
 * PUT /api/machine/:mac/temperature
 * Configure temperature alarm thresholds
 *
 * Body: { "threshold": 25, "duration": 180 }
 */
app.put('/api/machine/:mac/temperature', asyncRoute(async (req, res) => {
  const { normalizedMac } = req;
  const { threshold, duration } = req.body;

  if (threshold === undefined || duration === undefined) {
    return apiResponse(res, 400, {
      error: '"threshold" (°C) and "duration" (seconds) are required',
    });
  }

  if (isNaN(Number(threshold)) || isNaN(Number(duration))) {
    return apiResponse(res, 400, { error: '"threshold" and "duration" must be numbers' });
  }

  const payload = MqttClient.buildTemperaturePayload(threshold, duration);
  const result = await mqttClient.publishToMachine(normalizedMac, payload);

  return apiResponse(res, 200, {
    message: `Temperature config sent to machine ${normalizedMac}`,
    mqtt: result,
    payload,
  });
}));

/**
 * PUT /api/machine/:mac/sales
 * Enable or disable sales on a vending machine
 *
 * Body: { "action": "enable" } or { "action": "disable" }
 */
app.put('/api/machine/:mac/sales', asyncRoute(async (req, res) => {
  const { normalizedMac } = req;
  const { action } = req.body;

  if (!action || !['enable', 'disable'].includes(action)) {
    return apiResponse(res, 400, {
      error: '"action" must be "enable" or "disable"',
    });
  }

  const payload = MqttClient.buildSaleControlPayload(action);
  const result = await mqttClient.publishToMachine(normalizedMac, payload);

  return apiResponse(res, 200, {
    message: `Sales ${action}d on machine ${normalizedMac}`,
    mqtt: result,
    payload,
  });
}));

/**
 * PUT /api/machine/:mac/stock
 * Update stock levels for products in a vending machine
 *
 * Body: { "stocks": [{ "barcode": "123456", "slot": "A1", "quantity": 10 }] }
 */
app.put('/api/machine/:mac/stock', asyncRoute(async (req, res) => {
  const { normalizedMac } = req;
  const { stocks } = req.body;

  if (!Array.isArray(stocks) || stocks.length === 0) {
    return apiResponse(res, 400, { error: '"stocks" must be a non-empty array' });
  }

  for (const item of stocks) {
    if (!item.barcode || !item.slot || item.quantity === undefined) {
      return apiResponse(res, 400, {
        error: 'Each stock item must have "barcode", "slot", and "quantity"',
        received: item,
      });
    }
    if (isNaN(Number(item.quantity)) || Number(item.quantity) < 0) {
      return apiResponse(res, 400, {
        error: '"quantity" must be a non-negative number',
        received: item,
      });
    }
  }

  const payload = MqttClient.buildStockPayload(stocks);
  const result = await mqttClient.publishToMachine(normalizedMac, payload);

  return apiResponse(res, 200, {
    message: `Stock updated on machine ${normalizedMac}`,
    mqtt: result,
    payload,
  });
}));

/**
 * PUT /api/machine/:mac/videos
 * Update advertising videos on a vending machine
 *
 * Body: {
 *   "ads": {
 *     "slot1": ["https://video1.mp4", "https://video2.mp4"],
 *     "slot2": ["https://video3.mp4"]
 *   }
 * }
 */
app.put('/api/machine/:mac/videos', asyncRoute(async (req, res) => {
  const { normalizedMac } = req;
  const { ads } = req.body;

  if (!ads || typeof ads !== 'object') {
    return apiResponse(res, 400, {
      error: '"ads" object is required with "slot1" and/or "slot2" arrays',
    });
  }

  if (!Array.isArray(ads.slot1) && !Array.isArray(ads.slot2)) {
    return apiResponse(res, 400, {
      error: '"ads" must contain at least one of "slot1" or "slot2" arrays',
    });
  }

  const payload = MqttClient.buildVideosPayload(ads);
  const result = await mqttClient.publishToMachine(normalizedMac, payload);

  return apiResponse(res, 200, {
    message: `Advertising videos updated on machine ${normalizedMac}`,
    mqtt: result,
    payload,
  });
}));

// =============================================================================
// 404 Handler
// =============================================================================
app.use((req, res) => {
  return apiResponse(res, 404, {
    error: 'Route not found',
    availableRoutes: [
      'GET  /health',
      'GET  /api/status',
      'PUT  /api/machine/:mac/prices',
      'PUT  /api/machine/:mac/names',
      'PUT  /api/machine/:mac/images',
      'PUT  /api/machine/:mac/temperature',
      'PUT  /api/machine/:mac/sales',
      'PUT  /api/machine/:mac/stock',
      'PUT  /api/machine/:mac/videos',
    ],
  });
});

// =============================================================================
// Global Error Handler
// =============================================================================
app.use((err, req, res, _next) => {
  console.error('[ERROR]', err.message, err.stack);

  if (err.message && err.message.includes('not connected')) {
    return apiResponse(res, 503, {
      error: 'MQTT broker unavailable. Please try again later.',
      detail: err.message,
    });
  }

  return apiResponse(res, 500, {
    error: 'Internal server error',
    detail: err.message,
  });
});

// =============================================================================
// Start Server
// =============================================================================
async function start() {
  // Connect to MQTT broker
  mqttClient.connect();

  // Register handler for machine responses
  mqttClient.onMessage('+/response', (mac, message) => {
    console.log(`[SERVER] Response from machine ${mac}:`, message);
  });

  // Register handler for machine status
  mqttClient.onMessage('+/status', (mac, message) => {
    console.log(`[SERVER] Status from machine ${mac}:`, message);
  });

  // Start HTTP server
  app.listen(PORT, () => {
    console.log(`[SERVER] Sano MQTT Backend running on port ${PORT}`);
    console.log(`[SERVER] Health check: http://localhost:${PORT}/health`);
    console.log(`[SERVER] API status:   http://localhost:${PORT}/api/status`);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('[SERVER] SIGTERM received, shutting down...');
    mqttClient.disconnect();
    process.exit(0);
  });

  process.on('SIGINT', () => {
    console.log('[SERVER] SIGINT received, shutting down...');
    mqttClient.disconnect();
    process.exit(0);
  });
}

start().catch((err) => {
  console.error('[SERVER] Fatal startup error:', err);
  process.exit(1);
});
