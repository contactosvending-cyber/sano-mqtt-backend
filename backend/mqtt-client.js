'use strict';

// =============================================================================
// mqtt-client.js - MQTT Client for Sano Vending Machine Backend
// Handles connection, publishing, and subscribing to machine topics
// =============================================================================

const mqtt = require('mqtt');

class MqttClient {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.messageHandlers = new Map();
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
  }

  // ---------------------------------------------------------------------------
  // Connect to MQTT broker
  // ---------------------------------------------------------------------------
  connect() {
    const mqttUrl = process.env.MQTT_URL || 'mqtt://localhost:1883';
    const username = process.env.MQTT_USERNAME || 'sano_admin';
    const password = process.env.MQTT_PASSWORD || 'SanoPass2024!';

    const options = {
      clientId: `sano-backend-${Date.now()}`,
      username,
      password,
      clean: true,
      reconnectPeriod: 5000,      // Retry every 5 seconds
      connectTimeout: 30000,       // 30 second connection timeout
      keepalive: 60,
      will: {
        topic: 'sano/backend/status',
        payload: JSON.stringify({ status: 'offline', timestamp: new Date().toISOString() }),
        qos: 1,
        retain: true,
      },
    };

    console.log(`[MQTT] Connecting to ${mqttUrl}...`);
    this.client = mqtt.connect(mqttUrl, options);

    this._setupEventHandlers();
    return this;
  }

  // ---------------------------------------------------------------------------
  // Set up MQTT event handlers
  // ---------------------------------------------------------------------------
  _setupEventHandlers() {
    this.client.on('connect', () => {
      this.isConnected = true;
      this.reconnectAttempts = 0;
      console.log('[MQTT] Connected to broker successfully');

      // Publish online status
      this.client.publish(
        'sano/backend/status',
        JSON.stringify({ status: 'online', timestamp: new Date().toISOString() }),
        { qos: 1, retain: true }
      );

      // Subscribe to all machine response topics
      this.client.subscribe('machines/+/response', { qos: 1 }, (err) => {
        if (err) {
          console.error('[MQTT] Subscribe error:', err.message);
        } else {
          console.log('[MQTT] Subscribed to machines/+/response');
        }
      });

      // Subscribe to machine status/heartbeat topics
      this.client.subscribe('machines/+/status', { qos: 0 }, (err) => {
        if (err) {
          console.error('[MQTT] Subscribe error:', err.message);
        } else {
          console.log('[MQTT] Subscribed to machines/+/status');
        }
      });
    });

    this.client.on('message', (topic, payload) => {
      this._handleMessage(topic, payload);
    });

    this.client.on('error', (err) => {
      console.error('[MQTT] Connection error:', err.message);
    });

    this.client.on('close', () => {
      this.isConnected = false;
      console.warn('[MQTT] Connection closed');
    });

    this.client.on('offline', () => {
      this.isConnected = false;
      console.warn('[MQTT] Client went offline');
    });

    this.client.on('reconnect', () => {
      this.reconnectAttempts++;
      console.log(`[MQTT] Reconnecting... attempt ${this.reconnectAttempts}`);
      if (this.reconnectAttempts >= this.maxReconnectAttempts) {
        console.error('[MQTT] Max reconnect attempts reached. Stopping.');
        this.client.end();
      }
    });

    this.client.on('disconnect', (packet) => {
      console.warn('[MQTT] Disconnected by broker:', packet);
    });
  }

  // ---------------------------------------------------------------------------
  // Handle incoming messages
  // ---------------------------------------------------------------------------
  _handleMessage(topic, payload) {
    let message;
    try {
      message = JSON.parse(payload.toString());
    } catch {
      message = payload.toString();
    }

    console.log(`[MQTT] Message received on topic: ${topic}`, message);

    // Extract MAC from topic: machines/{mac}/response or machines/{mac}/status
    const parts = topic.split('/');
    if (parts.length >= 3) {
      const mac = parts[1];
      const eventType = parts[2];

      // Notify registered handlers for this MAC
      const key = `${mac}/${eventType}`;
      if (this.messageHandlers.has(key)) {
        this.messageHandlers.get(key).forEach((handler) => handler(message));
      }

      // Notify wildcard handlers
      if (this.messageHandlers.has(`+/${eventType}`)) {
        this.messageHandlers.get(`+/${eventType}`).forEach((handler) => handler(mac, message));
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Publish a command to a vending machine
  // topic format: machines/{mac}/command
  // ---------------------------------------------------------------------------
  publishToMachine(mac, payload, options = {}) {
    if (!this.isConnected) {
      throw new Error('MQTT client is not connected');
    }

    // Normalize MAC: lowercase and remove colons
    const normalizedMac = mac.toLowerCase().replace(/:/g, '');
    const topic = `machines/${normalizedMac}/command`;
    const message = JSON.stringify(payload);

    const pubOptions = {
      qos: options.qos || 1,
      retain: options.retain || false,
    };

    return new Promise((resolve, reject) => {
      this.client.publish(topic, message, pubOptions, (err) => {
        if (err) {
          console.error(`[MQTT] Publish error to ${topic}:`, err.message);
          reject(err);
        } else {
          console.log(`[MQTT] Published to ${topic}:`, message);
          resolve({ topic, message: payload });
        }
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Register a message handler for a topic pattern
  // ---------------------------------------------------------------------------
  onMessage(topicPattern, handler) {
    if (!this.messageHandlers.has(topicPattern)) {
      this.messageHandlers.set(topicPattern, []);
    }
    this.messageHandlers.get(topicPattern).push(handler);
  }

  // ---------------------------------------------------------------------------
  // Get connection status
  // ---------------------------------------------------------------------------
  getStatus() {
    return {
      connected: this.isConnected,
      reconnectAttempts: this.reconnectAttempts,
      clientId: this.client ? this.client.options.clientId : null,
    };
  }

  // ---------------------------------------------------------------------------
  // Gracefully disconnect
  // ---------------------------------------------------------------------------
  disconnect() {
    if (this.client) {
      this.client.publish(
        'sano/backend/status',
        JSON.stringify({ status: 'offline', timestamp: new Date().toISOString() }),
        { qos: 1, retain: true },
        () => {
          this.client.end();
          console.log('[MQTT] Disconnected gracefully');
        }
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Build MQTT message payloads (according to Chinese manufacturer protocol)
  // ---------------------------------------------------------------------------

  /** ID_PUSH_PRICE - Update product prices */
  static buildPricePayload(prices) {
    return {
      id: 'ID_PUSH_PRICE',
      prices: prices.map((p) => ({
        barcode: String(p.barcode),
        price: String(p.price),
      })),
    };
  }

  /** ID_NAME_SET - Update product names */
  static buildNamesPayload(names) {
    return {
      id: 'ID_NAME_SET',
      names: names.map((n) => ({
        barcode: String(n.barcode),
        name: String(n.name),
      })),
    };
  }

  /** ID_IMAGE_SET - Update product images (base64 or URL) */
  static buildImagesPayload(images) {
    return {
      id: 'ID_IMAGE_SET',
      images: images.map((img) => ({
        barcode: String(img.barcode),
        image: String(img.image),
      })),
    };
  }

  /** ID_TEMPER_ALARM_SET - Configure temperature alarm */
  static buildTemperaturePayload(threshold, duration) {
    return {
      id: 'ID_TEMPER_ALARM_SET',
      threshold: Number(threshold),
      duration: Number(duration),
    };
  }

  /** ID_SALE_CONTROL - Enable or disable sales */
  static buildSaleControlPayload(action) {
    if (!['enable', 'disable'].includes(action)) {
      throw new Error('action must be "enable" or "disable"');
    }
    return {
      id: 'ID_SALE_CONTROL',
      action,
    };
  }

  /** ID_STOCK_SET - Update product stock levels */
  static buildStockPayload(stocks) {
    return {
      id: 'ID_STOCK_SET',
      stocks: stocks.map((s) => ({
        barcode: String(s.barcode),
        slot: String(s.slot),
        quantity: Number(s.quantity),
      })),
    };
  }

  /** ID_ADV - Update advertising videos */
  static buildVideosPayload(ads) {
    return {
      id: 'ID_ADV',
      ads: {
        slot1: Array.isArray(ads.slot1) ? ads.slot1 : [],
        slot2: Array.isArray(ads.slot2) ? ads.slot2 : [],
      },
    };
  }
}

module.exports = new MqttClient();
module.exports.MqttClient = MqttClient;
