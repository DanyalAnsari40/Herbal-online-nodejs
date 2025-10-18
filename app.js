const express = require('express');
const app = express();
require('dotenv').config()
// Ensure fetch exists on Node <18
if (typeof fetch === 'undefined') {
  global.fetch = (...args) => import('node-fetch').then(({ default: f }) => f(...args));
}
const mongoose = require('mongoose');
const bodyParser = require('body-parser');
const bcrypt = require('bcrypt');
const session = require('express-session');
const path = require('path');
const MongoStore = require('connect-mongo');
const multer = require('multer');
const cors = require('cors');
// for Finance mangemnet
const Finance = require('./models/Finance');
// Use memory storage on Vercel (serverless FS is read-only); disk storage locally
const upload = multer(process.env.VERCEL ? { storage: multer.memoryStorage() } : { dest: 'public/uploads/' });
// Leopards API base (configurable: production default)
const LCS_BASE = (process.env.LEOPARDS_API_BASE || 'https://merchantapi.leopardscourier.com').replace(/\/$/, '');
// Per-endpoint URLs (Option B) with fallback to base
const LCS_URL_CITIES = process.env.LEOPARDS_URL_CITIES || `${LCS_BASE}/api/getAllCities/format/json/`;
const LCS_URL_BOOK = process.env.LEOPARDS_URL_BOOK || `${LCS_BASE}/api/bookPacket/format/json/`;
const LCS_URL_DETAILS = process.env.LEOPARDS_URL_DETAILS || `${LCS_BASE}/api/getShipmentDetailsByOrderID/format/json/`;
const LCS_URL_LAST_STATUS = process.env.LEOPARDS_URL_LAST_STATUS || `${LCS_BASE}/api/getBookedPacketLastStatus/format/json/`;
const LCS_URL_TRACK = process.env.LEOPARDS_URL_TRACK || `${LCS_BASE}/api/trackBookedPacket/format/json/`;

const LandingOrder = require('./models/Order'); // your simple schema: name, phone, createdAt
const { Parser } = require('json2csv');

// CORS configuration for landing pages
app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // Allow all origins for API endpoints
    callback(null, true);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With']
}));

app.use(express.static('public'));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// PWA-specific routes and middleware
// Serve manifest.json with correct MIME type
app.get('/manifest.json', (req, res) => {
  res.setHeader('Content-Type', 'application/manifest+json');
  res.sendFile(path.join(__dirname, 'public', 'manifest.json'));
});

// Serve service worker with correct MIME type and no-cache headers
app.get('/sw.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.sendFile(path.join(__dirname, 'public', 'sw.js'));
});

// Serve offline page
app.get('/offline.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'offline.html'));
});

// PWA icon generator page (for development)
app.get('/generate-icons', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'icons', 'generate-icons.html'));
});

// Import Cloudinary configuration
const { upload: cloudinaryUpload, deleteProfilePicture, getOptimizedUrl, getProfilePicUrl } = require('./config/cloudinary');

// Middleware to add Cloudinary helper functions to all views
app.use((req, res, next) => {
  res.locals.getProfilePicUrl = (publicId, size = 'medium') => {
    if (!publicId) return '/uploads/default-profile.svg';
    return `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/w_150,h_150,c_fill,g_face,q_auto,f_auto/${publicId}`;
  };
  
  res.locals.getProfilePicUrlLarge = (publicId) => {
    if (!publicId) return '/uploads/default-profile.svg';
    return `https://res.cloudinary.com/${process.env.CLOUDINARY_CLOUD_NAME}/image/upload/w_300,h_300,c_fill,g_face,q_auto,f_auto/${publicId}`;
  };
  
  next();
});
app.set('view engine', 'ejs');
// Absolute paths for views/static for Vercel
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
// Trust proxy for secure cookies behind Vercel/Proxies
app.set('trust proxy', 1);
// Normalize Mongo URI env var (support both MONGOURI and MONGO_URI)
const MONGO_URI = process.env.MONGOURI || process.env.MONGO_URI;

// Track DB readiness
let isDbReady = false;

// Session store with safe fallback
let sessionStore;
try {
  const isValidMongoUri = (u) => typeof u === 'string' && (u.startsWith('mongodb://') || u.startsWith('mongodb+srv://'));
  if (isValidMongoUri(MONGO_URI)) {
    sessionStore = MongoStore.create({
      mongoUrl: MONGO_URI,
      ttl: 14 * 24 * 60 * 60
    });
  } else if (MONGO_URI) {
    console.warn('[BOOT] Invalid MONGOURI provided; falling back to MemoryStore.');
  }
} catch (e) {
  console.warn('MongoStore init failed, falling back to MemoryStore:', e?.message || e);
}
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret',
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// --- Startup diagnostic logs ---
const viewsPath = path.join(__dirname, 'views');
const publicPath = path.join(__dirname, 'public');
console.log('[BOOT] Node', process.version, 'env=', process.env.NODE_ENV || 'dev', 'vercel=', !!process.env.VERCEL);
console.log('[BOOT] paths views=', viewsPath, 'public=', publicPath);
console.log('[BOOT] session store =', sessionStore ? 'MongoStore' : 'MemoryStore');

// --- Request/Response logging ---
app.use((req, res, next) => {
  const start = Date.now();
  console.log(`[REQ] ${req.method} ${req.originalUrl}`);
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`[RES] ${req.method} ${req.originalUrl} -> ${res.statusCode} ${ms}ms`);
  });
  next();
});

// --- res.render logging wrapper ---
app.use((req, res, next) => {
  const originalRender = res.render.bind(res);
  res.render = (view, ...args) => {
    console.log(`[RENDER] view=${view}`);
    const last = args[args.length - 1];
    if (typeof last === 'function') {
      const cb = last;
      args[args.length - 1] = (err, html) => {
        if (err) {
          console.error(`[RENDER_ERR] view=${view}`, err);
        } else {
          console.log(`[RENDER_OK] view=${view} length=${html ? html.length : 0}`);
        }
        return cb(err, html);
      };
      return originalRender(view, ...args);
    }
    try {
      const out = originalRender(view, ...args);
      console.log(`[RENDER_OK] view=${view}`);
      return out;
    } catch (e) {
      console.error(`[RENDER_ERR] view=${view}`, e);
      throw e;
    }
  };
  next();
});

// MongoDB connection (only when a valid URI is provided)
const isValidMongoUri = (u) => typeof u === 'string' && (u.startsWith('mongodb://') || u.startsWith('mongodb+srv://'));
if (isValidMongoUri(MONGO_URI)) {
  console.log('[BOOT] Connecting to MongoDB...');
  mongoose.connect(MONGO_URI, {
    connectTimeoutMS: 30000, // 30 seconds
    socketTimeoutMS: 30000,  // 30 seconds
    serverSelectionTimeoutMS: 60000, // 60 seconds for server selection
  }).then(async () => {
    console.log('MongoDB connected');
    isDbReady = true;
    try {
      await setupAdmin();
    } catch (e) {
      console.warn('setupAdmin failed:', e?.message || e);
    }
  }).catch(err => {
    isDbReady = false;
    console.error('MongoDB connection error:', err);
  });
  mongoose.connection.on('disconnected', () => {
    isDbReady = false;
    console.warn('[DB] Disconnected');
  });
} else {
  // Disable buffering so operations fail fast instead of hanging indefinitely
  mongoose.set('bufferCommands', false);
  console.warn('MONGOURI missing or invalid. Skipping MongoDB connection. Routes that require DB will error.');
}

// Middleware: ensure DB is ready before routes that need DB
const ensureDbReady = (req, res, next) => {
  if (!isValidMongoUri(MONGO_URI)) {
    console.warn('[DB] Missing/invalid MONGO_URI for', req.method, req.originalUrl);
    if (req.path === '/login' && req.method === 'POST') {
      return res.status(503).render('login', { message: 'Database is not configured on the server. Please contact the administrator.' });
    }
    return res.status(503).send('Service Unavailable: database not configured');
  }
  if (!isDbReady || mongoose.connection.readyState !== 1) {
    console.warn('[DB] Not ready for', req.method, req.originalUrl);
    // For login, render login with a friendly message; otherwise 503 JSON
    if (req.path === '/login' && req.method === 'POST') {
      return res.status(503).render('login', { message: 'Server database is starting up. Please try again in a moment.' });
    }
    return res.status(503).send('Service Unavailable: database not ready');
  }
  next();
};

// (Leopards API routes will be inserted below after hasPermission)

// Order Schema
const orderSchema = new mongoose.Schema({
  customerName: { type: String, required: true },
  email: { type: String, required: false },
  phone: { type: String, required: true },
  address: { type: String },
  postalCode: { type: String },
  city: { type: String },
  quantity: { type: Number, default: 1 },
  createdAt: { type: Date, default: Date.now },
  service: { type: String },
  trackingId: { type: String },
  pickupMethod: {
    type: String, enum: ['delivery', 'office'], required: false  // made optional
  },
  product: { type: mongoose.Schema.Types.ObjectId, ref: 'Product', required: false }, // made optional

  review: { type: String },  // <-- NEW field
  handledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  
  // TCS-specific fields
  tcsConsignmentNo: { type: String }, // TCS tracking number
  tcsBookingData: { type: Object }, // Store complete TCS booking response
  codAmount: { type: Number, default: 0 }, // Cash on Delivery amount
  weightInKg: { type: Number }, // Package weight
  pieces: { type: Number, default: 1 }, // Number of pieces
  isFragile: { type: Boolean, default: false }, // Fragile package
  contentDescription: { type: String }, // Product name/description
  
  // M&P-specific fields
  mnpReferenceId: { type: String }, // M&P tracking/reference number
  mnpBookingData: { type: Object }, // Store complete M&P booking response
  destinationCity: { type: String }, // Destination city for M&P
  customerReferenceNo: { type: String }, // Customer reference number
  insuranceValue: { type: Number, default: 0 }, // Insurance value
  locationID: { type: String }, // M&P location ID
  returnLocation: { type: String }, // Return location
  subAccountId: { type: String }, // Sub account ID
  
  // PostEx-specific fields
  postexTrackingNumber: { type: String }, // PostEx tracking number
  postexBookingData: { type: Object }, // Store complete PostEx booking response
  postexOrderRefNumber: { type: String }, // PostEx order reference number
  invoicePayment: { type: Number, default: 0 }, // Invoice payment amount
  invoiceDivision: { type: Number, default: 1 }, // Invoice division
  orderType: { type: String, default: 'Normal' }, // Order type (Normal, Reverse, Replacement)
  transactionNotes: { type: String }, // Transaction notes
  pickupAddressCode: { type: String }, // Pickup address code
  storeAddressCode: { type: String } // Store address code
});
const Order = mongoose.model('Order', orderSchema);
// module.exports = mongoose.model("LandingOrder", orderSchema);

// Employee Schema
const employeeSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  role: { type: String, enum: ['staff', 'manager', 'admin'], required: true },
  displayName: { type: String },
  profilePic: { type: String },
  //! Changes made by Danyal
  permissions: [{ type: String, enum: ['orders', 'create-order', 'employee-management', 'track-product', 'product-management', 'finance', 'call-operator'] }],
  createdAt: { type: Date, default: Date.now },
});
const Employee = mongoose.model('Employee', employeeSchema);

// Attendance Schema
const attendanceSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee', required: true },
  email: { type: String },
  displayName: { type: String },
  checkIn: { type: String },
  checkOut: { type: String },
  totalTime: { type: String },
  status: { type: String, enum: ['present', 'absent'], default: 'absent' },
  date: { type: Date, default: () => new Date().setHours(0,0,0,0) },
});
attendanceSchema.index({ user: 1, date: 1 }, { unique: true });
const Attendance = mongoose.model('Attendance', attendanceSchema);

// Admin setup with environment variables (run once or check if exists)
const setupAdmin = async () => {
  const adminEmail = process.env.ADMIN_EMAIL || 'admin@company.com';
  const adminPassword = process.env.ADMIN_PASSWORD;
  
  console.log('🔍 Admin setup check:');
  console.log('- Admin Email:', adminEmail);
  console.log('- Password provided:', adminPassword ? 'Yes' : 'No');
  console.log('- Password length:', adminPassword ? adminPassword.length : 0);
  
  if (!adminPassword) {
    console.warn('⚠️  ADMIN_PASSWORD not set in environment variables. Skipping admin setup.');
    return;
  }
  
  if (adminPassword.length < 8) {
    console.warn('⚠️  ADMIN_PASSWORD must be at least 8 characters long. Skipping admin setup.');
    return;
  }
  
  const adminExists = await Employee.findOne({ email: adminEmail });
  if (!adminExists) {
    const hashedPassword = await bcrypt.hash(adminPassword, 12); // Increased salt rounds for better security
    await Employee.create({
      email: adminEmail,
      password: hashedPassword,
      role: 'admin',
      permissions: ['orders', 'create-order', 'employee-management', 'track-product', 'product-management', 'finance', 'call-operator']
    });
    console.log(`✅ Admin user created with email: ${adminEmail}`);
  } else {
    console.log(`ℹ️  Admin user already exists with email: ${adminEmail}`);
  }
};
// setupAdmin will be invoked after successful DB connection above

// Middleware to check authentication
const isAuthenticated = (req, res, next) => {
  if (req.session.user) {
    return next();
  }
  res.redirect('/login');
};

// Middleware to check permissions
const hasPermission = (permission) => (req, res, next) => {
  if (req.session.user.role === 'admin' || req.session.user.permissions.includes(permission)) {
    return next();
  }
  res.status(403).render('error', { message: 'Access denied: Insufficient permissions' });
};

// ===== Leopards API Proxies (placed after isAuthenticated/hasPermission) =====
// Helper to parse upstream as JSON safely
async function parseJsonSafe(resp) {
  const text = await resp.text();
  try { return { ok: true, data: JSON.parse(text), raw: text }; }
  catch { return { ok: false, data: { status: 0, error: 1, message: 'Upstream returned non-JSON', raw: text.slice(0, 300) }, raw: text }; }
}

// Cities
app.post('/api/leopards/cities', isAuthenticated, async (req, res) => {
  try {
    const api_key = process.env.LEOPARDS_API_KEY;
    const api_password = process.env.LEOPARDS_API_PASSWORD;
    if (!api_key || !api_password) return res.status(400).json({ status: 0, error: 1, message: 'Missing Leopards API credentials' });
    const url = LCS_URL_CITIES;
    const upstream = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key, api_password }) });
    const parsed = await parseJsonSafe(upstream);
    res.type('application/json');
    return res.status(upstream.ok ? 200 : upstream.status).json(parsed.ok ? parsed.data : parsed.data);
  } catch (e) {
    console.error('Leopards cities error:', e?.message || e);
    return res.status(500).json({ status: 0, error: 1, message: 'Failed to load cities' });
  }
});

// ===== TCS Tracking Proxy =====
// Uses: process.env.TCS_URL_TRACK and process.env.TCS_BEARER
app.post('/api/track/tcs', isAuthenticated, async (req, res) => {
  try {
    const url = (process.env.TCS_URL_TRACK || '').trim();
    const bearer = (process.env.TCS_BEARER || '').trim();
    const consignee = (req.body?.consignee || '').toString().trim();
    if (!url) return res.status(500).json({ status: 0, error: 1, message: 'TCS_URL_TRACK not configured on server' });
    if (!bearer) return res.status(500).json({ status: 0, error: 1, message: 'TCS_BEARER missing on server' });
    if (!consignee) return res.status(400).json({ status: 0, error: 1, message: 'consignee (CN) is required' });

    // TCS docs indicate GET with consignee array; use query param(s)
    const qs = new URLSearchParams();
    // If TCS supports multiple, they allow repeated keys; for now send single
    qs.append('consignee', consignee);
    const forward = `${url}?${qs.toString()}`;
    const upstream = await fetch(forward, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        Authorization: `Bearer ${bearer}`
      }
    });
    const parsed = await parseJsonSafe(upstream);
    try { console.log('[TCS track] upstream', { ok: upstream.ok, status: upstream.status, url: forward, hasBearer: !!bearer, bodyKeys: Object.keys(parsed.ok ? (parsed.data||{}) : (parsed.data||{})) }); } catch(_) {}
    res.type('application/json');
    return res.status(upstream.ok ? 200 : upstream.status).json(parsed.ok ? parsed.data : parsed.data);
  } catch (e) {
    console.error('TCS track error:', e?.message || e);
    return res.status(500).json({ status: 0, error: 1, message: 'TCS tracking failed' });
  }
});
// ===== End TCS Tracking Proxy =====

// ===== PostEx Tracking Proxy =====
// Docs: GET https://api.postex.pk/services/integration/api/order/v1/track-order/{trackingNumber}
// or https://api-services.postex.pk/api/order/v1/track-order/{trackingNumber}
// Header: token: <POSTEX_API_TOKEN>
const POSTEX_URL_TRACK = (process.env.POSTEX_URL_TRACK || 'https://api-services.postex.pk/api/order/v1/track-order').replace(/\/?$/, '');
app.post('/api/track/postex', isAuthenticated, async (req, res) => {
  try {
    const token = (process.env.POSTEX_API_TOKEN || process.env.POSTEX_TOKEN || '').trim();
    const trackingNumber = (req.body?.trackingNumber || '').toString().trim();
    if (!token) return res.status(500).json({ status: 0, error: 1, message: 'POSTEX_API_TOKEN missing on server' });
    if (!trackingNumber) return res.status(400).json({ status: 0, error: 1, message: 'trackingNumber is required' });

    const primaryUrl = `${POSTEX_URL_TRACK}/${encodeURIComponent(trackingNumber)}`;
    const altBase = 'https://api.postex.pk/services/integration/api/order/v1/track-order';
    const altUrl = `${altBase}/${encodeURIComponent(trackingNumber)}`;

    async function tryFetch(url, headers) {
      const r = await fetch(url, { method: 'GET', headers });
      const p = await parseJsonSafe(r);
      return { r, p };
    }

    // Try token header (as per docs)
    let { r, p } = await tryFetch(primaryUrl, { 'Accept': 'application/json', token });
    if (!r.ok) {
      // Try Bearer auth
      ({ r, p } = await tryFetch(primaryUrl, { 'Accept': 'application/json', Authorization: `Bearer ${token}` }));
    }
    if (!r.ok) {
      // Try alternate base with token header
      ({ r, p } = await tryFetch(altUrl, { 'Accept': 'application/json', token }));
    }
    if (!r.ok) {
      // Try alternate base with Bearer
      ({ r, p } = await tryFetch(altUrl, { 'Accept': 'application/json', Authorization: `Bearer ${token}` }));
    }

    res.type('application/json');
    if (!r.ok) {
      try { console.error('[PostEx track] upstream error', { status: r.status, url: r.url, body: p?.data || p }); } catch(_) {}
      return res.status(r.status).json(p.ok ? p.data : (p.data || { message: 'PostEx upstream error' }));
    }
    return res.status(200).json(p.ok ? p.data : p.data);
  } catch (e) {
    console.error('PostEx track error:', e?.message || e);
    return res.status(500).json({ status: 0, error: 1, message: 'PostEx tracking failed' });
  }
});
// ===== End PostEx Tracking Proxy =====

// Book Packet with stock validation
app.post('/api/leopards/bookPacket', isAuthenticated, async (req, res) => {
  try {
    const api_key = process.env.LEOPARDS_API_KEY;
    const api_password = process.env.LEOPARDS_API_PASSWORD;
    if (!api_key || !api_password) return res.status(400).json({ status: 0, error: 1, message: 'Missing Leopards API credentials' });
    
    // Extract product info and validate stock
    const { productId, booked_packet_no_piece } = req.body;
    if (productId && booked_packet_no_piece) {
      const product = await Product.findById(productId);
      if (!product) {
        return res.status(400).json({ status: 0, error: 1, message: 'Product not found' });
      }
      if (product.stock < booked_packet_no_piece) {
        return res.status(400).json({ status: 0, error: 1, message: `Insufficient stock. Available: ${product.stock}, Requested: ${booked_packet_no_piece}` });
      }
      
      // Reduce stock and create finance record
      product.stock -= parseInt(booked_packet_no_piece);
      await product.save();
      
      await Finance.create({
        type: 'order',
        description: `Leopards Order for ${product.name} x${booked_packet_no_piece}`,
        cost: product.costPrice * booked_packet_no_piece,
        revenue: product.price * booked_packet_no_piece,
        date: new Date()
      });
      
      // Create order record with Leopards-specific fields
      await Order.create({
        product: productId,
        customerName: req.body.consignment_name_eng,
        phone: req.body.consignment_phone,
        address: req.body.consignment_address,
        city: req.body.destination_city,
        quantity: booked_packet_no_piece,
        service: 'Leopards',
        handledBy: req.session.user.id,
        pickupMethod: 'delivery',
        // Common fields
        codAmount: req.body.booked_packet_collect_amount || 0,
        weightInKg: (req.body.booked_packet_weight || 0) / 1000, // Convert grams to kg
        pieces: booked_packet_no_piece,
        contentDescription: product.name,
        email: req.body.consignment_email,
        // Leopards-specific fields
        shipmentType: req.body.shipment_type,
        specialInstructions: req.body.special_instructions,
        shipmentId: req.body.shipment_id,
        originCity: req.body.origin_city,
        destinationCity: req.body.destination_city,
        isVpc: req.body.is_vpc === '1'
      });
    }
    
    const url = LCS_URL_BOOK;
    // Remove our custom fields that Leopards API doesn't need, but keep booked_packet_no_piece
    const leopardsPayload = { ...req.body };
    delete leopardsPayload.productId; // Only remove productId, keep booked_packet_no_piece for Leopards API
    
    const payload = { ...leopardsPayload, api_key, api_password };
    const upstream = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
    const parsed = await parseJsonSafe(upstream);
    
    // If Leopards booking was successful and we have product info, update the order with tracking details
    if (upstream.ok && productId && booked_packet_no_piece) {
      try {
        const order = await Order.findOne({
          product: productId,
          handledBy: req.session.user.id,
          service: 'Leopards'
        }).sort({ createdAt: -1 });
        
        if (order && parsed.data) {
          // Leopards API response structure may vary, adapt as needed
          const trackingId = parsed.data.trackingNumber || parsed.data.consignmentNo || parsed.data.orderReferenceId;
          if (trackingId) {
            order.trackingId = trackingId;
            order.leopardsTrackingId = trackingId;
            order.leopardsBookingData = parsed.data; // Store complete response
            await order.save();
          }
        }
      } catch (updateErr) {
        console.error('Error updating Leopards order with tracking:', updateErr);
        // Don't fail the response, just log the error
      }
    }
    
    res.type('application/json');
    return res.status(upstream.ok ? 200 : upstream.status).json(parsed.ok ? parsed.data : parsed.data);
  } catch (e) {
    console.error('Leopards bookPacket error:', e?.message || e);
    return res.status(500).json({ status: 0, error: 1, message: 'Booking failed' });
  }
});

// Shipment Details by Order ID
app.post('/api/leopards/shipmentDetailsByOrderId', isAuthenticated, async (req, res) => {
  try {
    const api_key = process.env.LEOPARDS_API_KEY;
    const api_password = process.env.LEOPARDS_API_PASSWORD;
    const shipment_order_id = req.body.shipment_order_id;
    if (!api_key || !api_password) return res.status(400).json({ status: 0, error: 1, message: 'Missing Leopards API credentials' });
    if (!shipment_order_id) return res.status(400).json({ status: 0, error: 1, message: 'shipment_order_id is required' });
    const url = LCS_URL_DETAILS;
    const upstream = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ api_key, api_password, shipment_order_id }) });
    const parsed = await parseJsonSafe(upstream);
    res.type('application/json');
    return res.status(upstream.ok ? 200 : upstream.status).json(parsed.ok ? parsed.data : parsed.data);
  } catch (e) {
    console.error('Leopards shipmentDetails error:', e?.message || e);
    return res.status(500).json({ status: 0, error: 1, message: 'Failed to fetch shipment details' });
  }
});

// Last Status
app.post('/api/leopards/getBookedPacketLastStatus', isAuthenticated, async (req, res) => {
  try {
    const api_key = process.env.LEOPARDS_API_KEY;
    const api_password = process.env.LEOPARDS_API_PASSWORD;
    const { from_date, to_date } = req.body || {};
    if (!api_key || !api_password) return res.status(400).json({ status: 0, error: 1, message: 'Missing Leopards API credentials' });
    const qs = new URLSearchParams({ api_key, api_password });
    if (from_date) qs.append('from_date', from_date);
    if (to_date) qs.append('to_date', to_date);
    const url = `${LCS_URL_LAST_STATUS}${LCS_URL_LAST_STATUS.includes('?') ? '&' : '?'}${qs.toString()}`;
    const upstream = await fetch(url, { method: 'GET', headers: { 'Content-Type': 'application/json' } });
    const parsed = await parseJsonSafe(upstream);
    res.type('application/json');
    return res.status(upstream.ok ? 200 : upstream.status).json(parsed.ok ? parsed.data : parsed.data);
  } catch (e) {
    console.error('Leopards last status error:', e?.message || e);
    return res.status(500).json({ status: 0, error: 1, message: 'Failed to fetch last status' });
  }
});

// Generic forward (optional)
app.post('/api/leopards/forward', isAuthenticated, async (req, res) => {
  try {
    const api_key = process.env.LEOPARDS_API_KEY;
    const api_password = process.env.LEOPARDS_API_PASSWORD;
    if (!api_key || !api_password) return res.status(400).json({ status: 0, error: 1, message: 'Missing Leopards API credentials' });
    const { url, method = 'POST', payload = {}, query = {} } = req.body || {};
    if (!url || typeof url !== 'string') return res.status(400).json({ status: 0, error: 1, message: 'url is required' });
    let parsedUrl;
    try { parsedUrl = new URL(url); } catch { return res.status(400).json({ status: 0, error: 1, message: 'Invalid URL' }); }
    const hostOk = /(^|\.)leopardscourier\.com$/i.test(parsedUrl.hostname);
    if (!hostOk || !parsedUrl.pathname.startsWith('/api/')) return res.status(400).json({ status: 0, error: 1, message: 'URL not allowed' });
    const qs = new URLSearchParams(query || {});
    if (method.toUpperCase() === 'GET') { qs.set('api_key', api_key); qs.set('api_password', api_password); }
    const forwardUrl = qs.toString() ? `${url}${url.includes('?') ? '&' : '?'}${qs}` : url;
    const options = { method: method.toUpperCase(), headers: { 'Content-Type': 'application/json' } };
    if (options.method !== 'GET') options.body = JSON.stringify({ ...(payload || {}), api_key, api_password });
    const upstream = await fetch(forwardUrl, options);
    const parsed = await parseJsonSafe(upstream);
    res.type('application/json');
    return res.status(upstream.ok ? 200 : upstream.status).json(parsed.ok ? parsed.data : parsed.data);
  } catch (e) {
    console.error('Leopards forward error:', e?.message || e);
    return res.status(500).json({ status: 0, error: 1, message: 'Forward failed' });
  }
});
// ===== End Leopards API Proxies =====

// ===== M&P Tracking Proxy =====
const MNP_TRACK_URL = (process.env.MNP_TRACK_URL || 'http://mnpcourier.com/mycodapi/api/Tracking/Consignment_Tracking').replace(/\/$/, '');
app.post('/api/track/mnp', isAuthenticated, async (req, res) => {
  try {
    const username = process.env.MNP_USERNAME || req.body.username;
    const password = process.env.MNP_PASSWORD || req.body.password;
    const consignment = (req.body.consignment || '').toString().trim();
    if (!username) return res.status(400).json({ status: 0, error: 1, message: 'Missing MNP_USERNAME' });
    if (!consignment) return res.status(400).json({ status: 0, error: 1, message: 'consignment is required' });
    const qs = new URLSearchParams({ username, consignment });
    if (password) qs.set('password', password);
    const url = `${MNP_TRACK_URL}?${qs.toString()}`;
    const upstream = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } });
    const parsed = await parseJsonSafe(upstream);
    res.type('application/json');
    return res.status(upstream.ok ? 200 : upstream.status).json(parsed.ok ? parsed.data : parsed.data);
  } catch (e) {
    console.error('MNP track error:', e?.message || e);
    return res.status(500).json({ status: 0, error: 1, message: 'MNP tracking failed' });
  }
});
// ===== End M&P Tracking Proxy =====

// ===== M&P Cities Proxy =====
const MNP_URL_CITIES = process.env.MNP_URL_CITIES || 'http://mnpcourier.com/mycodapi/api/Branches/Get_Cities';
app.post('/api/mnp/cities', isAuthenticated, async (req, res) => {
  try {
    const username = process.env.MNP_USERNAME;
    const password = process.env.MNP_PASSWORD || '';
    const accountNo = process.env.MNP_ACCOUNT_NO || '';
    const locationID = process.env.MNP_LOCATION_ID || '';
    if (!username) return res.status(400).json({ status: 0, error: 1, message: 'Missing MNP_USERNAME' });
    const qs = new URLSearchParams({ username });
    if (password) qs.set('password', password);
    if (accountNo) qs.set('accountNo', accountNo);
    if (locationID) qs.set('locationID', locationID);
    const url = `${MNP_URL_CITIES}?${qs.toString()}`;
    const upstream = await fetch(url, { method: 'GET', headers: { 'Accept': 'application/json' } });
    const parsed = await parseJsonSafe(upstream);
    res.type('application/json');
    return res.status(upstream.ok ? 200 : upstream.status).json(parsed.ok ? parsed.data : parsed.data);
  } catch (e) {
    console.error('MNP cities error:', e?.message || e);
    return res.status(500).json({ status: 0, error: 1, message: 'MNP cities failed' });
  }
});
// ===== End M&P Cities Proxy =====

// ===== M&P Booking Proxy =====
const MNP_URL_BOOK = process.env.MNP_URL_BOOK || 'http://mnpcourier.com/mycodapi/api/Booking/InsertBookingData';
app.post('/api/mnp/booking', isAuthenticated, async (req, res) => {
  try {
    const username = process.env.MNP_USERNAME;
    const password = process.env.MNP_PASSWORD || '';
    const accountNo = process.env.MNP_ACCOUNT_NO || '';
    const locationID = process.env.MNP_LOCATION_ID || '';
    if (!username) return res.status(400).json({ status: 0, error: 1, message: 'Missing MNP_USERNAME' });

    // Merge form payload with required auth fields as per M&P API
    const payload = { ...(req.body || {}), username, password, accountNo, locationID };

    const upstream = await fetch(MNP_URL_BOOK, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const parsed = await parseJsonSafe(upstream);
    res.type('application/json');
    return res.status(upstream.ok ? 200 : upstream.status).json(parsed.ok ? parsed.data : parsed.data);
  } catch (e) {
    console.error('MNP booking error:', e?.message || e);
    return res.status(500).json({ status: 0, error: 1, message: 'MNP booking failed' });
  }
});
// ===== End M&P Booking Proxy =====

// Input validation middleware
const validateInput = {
  // Email validation
  email: (value) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(value);
  },
  
  // Phone validation (Pakistani format)
  phone: (value) => {
    const phoneRegex = /^(\+92|0)?[0-9]{10,11}$/;
    return phoneRegex.test(value.replace(/[\s-]/g, ''));
  },
  
  // Password strength validation
  password: (value) => {
    return value && value.length >= 8;
  },
  
  // Sanitize string input
  sanitizeString: (value) => {
    if (typeof value !== 'string') return '';
    return value.trim().replace(/[<>]/g, '');
  },
  
  // Validate MongoDB ObjectId
  objectId: (value) => {
    return /^[0-9a-fA-F]{24}$/.test(value);
  },
  
  // Validate numeric input
  number: (value) => {
    return !isNaN(value) && isFinite(value) && value >= 0;
  }
};

// Validation middleware for employee creation/update
const validateEmployee = (req, res, next) => {
  const { email, password, role } = req.body;
  
  if (!email || !validateInput.email(email)) {
    return res.status(400).json({ message: 'Valid email is required' });
  }
  
  if (password && !validateInput.password(password)) {
    return res.status(400).json({ message: 'Password must be at least 8 characters long' });
  }
  
  if (!role || !['admin', 'manager', 'staff'].includes(role)) {
    return res.status(400).json({ message: 'Valid role is required' });
  }
  
  // Sanitize inputs
  req.body.email = validateInput.sanitizeString(email).toLowerCase();
  if (req.body.displayName) {
    req.body.displayName = validateInput.sanitizeString(req.body.displayName);
  }
  
  next();
};

// Validation middleware for order creation
const validateOrder = (req, res, next) => {
  const { customerName, phone, productId, quantity } = req.body;
  
  if (!customerName || customerName.trim().length < 2) {
    return res.status(400).json({ message: 'Customer name is required (minimum 2 characters)' });
  }
  
  if (!phone || !validateInput.phone(phone)) {
    return res.status(400).json({ message: 'Valid phone number is required' });
  }
  
  if (productId && !validateInput.objectId(productId)) {
    return res.status(400).json({ message: 'Invalid product ID' });
  }
  
  if (quantity && (!validateInput.number(quantity) || quantity < 1)) {
    return res.status(400).json({ message: 'Quantity must be a positive number' });
  }
  
  // Sanitize inputs
  req.body.customerName = validateInput.sanitizeString(customerName);
  req.body.phone = validateInput.sanitizeString(phone);
  if (req.body.email) {
    req.body.email = validateInput.sanitizeString(req.body.email).toLowerCase();
  }
  if (req.body.address) {
    req.body.address = validateInput.sanitizeString(req.body.address);
  }
  
  next();
};

// Validation middleware for product creation/update
const validateProduct = (req, res, next) => {
  const { name, price, costPrice, stock } = req.body;
  
  if (!name || name.trim().length < 2) {
    return res.status(400).json({ message: 'Product name is required (minimum 2 characters)' });
  }
  
  if (!validateInput.number(price) || price <= 0) {
    return res.status(400).json({ message: 'Valid price is required' });
  }
  
  if (!validateInput.number(costPrice) || costPrice <= 0) {
    return res.status(400).json({ message: 'Valid cost price is required' });
  }
  
  if (!validateInput.number(stock) || stock < 0) {
    return res.status(400).json({ message: 'Valid stock quantity is required' });
  }
  
  // Sanitize inputs
  req.body.name = validateInput.sanitizeString(name);
  req.body.price = parseFloat(price);
  req.body.costPrice = parseFloat(costPrice);
  req.body.stock = parseInt(stock);
  
  next();
};

// Routes
//!!!!!!!! added by danyal
// admin/tracking
app.get('/admin/tracking', isAuthenticated, hasPermission('track-product'), (req, res) => {
  res.render('tracking', {
    user: req.session.user,
    currentRoute: 'tracking'
  });
});
// !!!!!!!!!!!!!!!!
// Routes

// Login Page
app.get('/login', (req, res) => {
  res.render('login', { message: null });
});

// Login Handler with validation
app.post('/login', ensureDbReady, (req, res, next) => {
  const { email, password } = req.body;
  
  if (!email || !validateInput.email(email)) {
    return res.render('login', { message: 'Valid email is required' });
  }
  
  if (!password || password.length < 6) {
    return res.render('login', { message: 'Password is required' });
  }
  
  // Sanitize email
  req.body.email = validateInput.sanitizeString(email).toLowerCase();
  next();
}, async (req, res) => {
  try {
    const { email, password } = req.body;
    const employee = await Employee.findOne({ email });
    if (!employee) {
      return res.render('login', { message: 'Invalid email or password' });
    }
    const isMatch = await bcrypt.compare(password, employee.password);
    if (!isMatch) {
      return res.render('login', { message: 'Invalid email or password' });
    }
    req.session.user = {
      id: employee._id,
      email: employee.email,
      role: employee.role,
      permissions: employee.permissions,
      displayName: employee.displayName,
      profilePic: employee.profilePic
    };
    res.redirect('/admin');
  } catch (err) {
    console.error(err);
    res.render('login', { message: 'Login failed' });
  }
});

// Logout
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// Redirect root to login
app.get('/', (req, res) => {
  res.redirect('/login');
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ ok: true });
});

// Profile routes
app.get('/admin/profile', isAuthenticated, async (req, res) => {
  try {
    const employee = await Employee.findById(req.session.user.id);
    console.log('Profile GET - Employee data:', {
      id: employee._id,
      email: employee.email,
      displayName: employee.displayName,
      profilePic: employee.profilePic,
      cloudName: process.env.CLOUDINARY_CLOUD_NAME
    });
    res.render('profile', {
      user: req.session.user,
      employee,
      currentRoute: 'profile',
      message: null,
      cloudinaryCloudName: process.env.CLOUDINARY_CLOUD_NAME
    });
  } catch (err) {
    console.error(err);
    res.redirect('/admin');
  }
});

app.post('/admin/profile', isAuthenticated, (req, res, next) => {
  cloudinaryUpload.single('profilePic')(req, res, (err) => {
    if (err) {
      console.error('Cloudinary upload error:', err);
      return res.redirect('/admin/profile?error=upload');
    }
    next();
  });
}, async (req, res) => {
  try {
    console.log('Profile update request:', {
      body: req.body,
      file: req.file ? { filename: req.file.filename, public_id: req.file.public_id } : null
    });
    
    const { displayName, email } = req.body;
    const updateData = {};
    
    if (displayName && displayName.trim()) {
      updateData.displayName = validateInput.sanitizeString(displayName);
    }
    
    if (email && validateInput.email(email)) {
      updateData.email = validateInput.sanitizeString(email).toLowerCase();
    }
    
    if (req.file) {
      console.log('File object:', req.file);
      // Delete old profile picture if exists
      const currentEmployee = await Employee.findById(req.session.user.id);
      if (currentEmployee && currentEmployee.profilePic) {
        await deleteProfilePicture(currentEmployee.profilePic);
      }
      // Use filename if public_id is not available
      updateData.profilePic = req.file.public_id || req.file.filename;
    }
    
    console.log('Updating employee with data:', updateData);
    
    const updatedEmployee = await Employee.findByIdAndUpdate(
      req.session.user.id, 
      updateData, 
      { new: true }
    );
    
    console.log('Employee updated successfully:', updatedEmployee);
    
    // Update session with changed data
    if (updateData.email) {
      req.session.user.email = updateData.email;
    }
    if (updateData.displayName) {
      req.session.user.displayName = updateData.displayName;
    }
    if (updateData.profilePic) {
      req.session.user.profilePic = updateData.profilePic;
    }
    
    res.redirect('/admin/profile?success=1');
  } catch (err) {
    console.error('Profile update error:', err);
    res.redirect('/admin/profile?error=1');
  }
});

// Leopards Tracking Proxy
app.post('/api/track/leopards', isAuthenticated, async (req, res) => {
  try {
    const api_key = process.env.LEOPARDS_API_KEY || req.body.api_key;
    const api_password = process.env.LEOPARDS_API_PASSWORD || req.body.api_password;
    const track_numbers = (req.body.track_numbers || '').toString();

    if (!api_key || !api_password) {
      return res.status(400).json({ status: 0, error: 1, message: 'Missing Leopards API credentials' });
    }
    if (!track_numbers) {
      return res.status(400).json({ status: 0, error: 1, message: 'track_numbers is required' });
    }

    const url = LCS_URL_TRACK;
    const payload = { api_key, api_password, track_numbers };

    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return res.status(resp.status).json({ status: 0, error: 1, message: 'Leopards API error', details: data });
    }
    return res.status(200).json(data);
  } catch (e) {
    console.error('Leopards track error:', e?.message || e);
    return res.status(500).json({ status: 0, error: 1, message: 'Tracking failed' });
  }
});


// 🚀 API Endpoint for Multiple Landing Pages
// This endpoint can accept orders from any number of landing pages
app.post('/api/order', async (req, res) => {
  try {
    const { 
      name, 
      phone, 
      productName, 
      email, 
      address, 
      city, 
      source, 
      campaign,
      landingPageId,
      utm_source,
      utm_medium,
      utm_campaign,
      ...additionalFields 
    } = req.body;

    // Basic validation
    if (!name || name.trim().length < 2) {
      return res.status(400).json({ 
        success: false, 
        message: 'Name is required (minimum 2 characters)' 
      });
    }

    if (!phone || !validateInput.phone(phone)) {
      return res.status(400).json({ 
        success: false, 
        message: 'Valid phone number is required' 
      });
    }

    // Sanitize required inputs
    const sanitizedData = {
      name: validateInput.sanitizeString(name),
      phone: validateInput.sanitizeString(phone),
      productName: productName ? validateInput.sanitizeString(productName) : 'Default Product',
    };

    // Add optional fields if provided
    if (email) sanitizedData.email = validateInput.sanitizeString(email);
    if (address) sanitizedData.address = validateInput.sanitizeString(address);
    if (city) sanitizedData.city = validateInput.sanitizeString(city);
    if (source) sanitizedData.source = validateInput.sanitizeString(source);
    if (campaign) sanitizedData.campaign = validateInput.sanitizeString(campaign);
    if (landingPageId) sanitizedData.landingPageId = validateInput.sanitizeString(landingPageId);
    if (utm_source) sanitizedData.utm_source = validateInput.sanitizeString(utm_source);
    if (utm_medium) sanitizedData.utm_medium = validateInput.sanitizeString(utm_medium);
    if (utm_campaign) sanitizedData.utm_campaign = validateInput.sanitizeString(utm_campaign);

    // Store additional fields as metadata
    if (Object.keys(additionalFields).length > 0) {
      sanitizedData.metadata = additionalFields;
    }

    // Create order in database
    const order = await LandingOrder.create(sanitizedData);

    // Return success response
    res.status(201).json({
      success: true,
      message: 'Order created successfully',
      orderId: order._id,
      data: {
        name: order.name,
        phone: order.phone,
        productName: order.productName,
        createdAt: order.createdAt
      }
    });

  } catch (err) {
    console.error('API Order Creation Error:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to create order',
      error: process.env.NODE_ENV === 'development' ? err.message : 'Internal server error'
    });
  }
});

// 🚀 Admin Dashboard
// 🚀 Admin Dashboard
app.get('/admin', isAuthenticated, async (req, res) => {
  try {
    let orderCount = 0;
    let pendingOrderCount = 0;
    let createOrderCount = 0;
    let totalDispatchedOrders = 0;
    let employeeCount = 0;
    let products = [];
    let finances = [];
    let totalRevenue = 0;
    let totalCost = 0;
    let profit = 0;

    if (req.session.user.role === 'admin') {
      // For admin
      orderCount = await LandingOrder.countDocuments();
      pendingOrderCount = await LandingOrder.countDocuments({
        $or: [
          { callStatus: { $exists: false } },
          { callStatus: "" },
          { callStatus: null },
          { callStatus: "Pending" }
        ]
      });
      createOrderCount = await Order.countDocuments();
      totalDispatchedOrders = await Order.countDocuments({
        $or: [
          { trackingId: { $exists: true, $ne: "", $nin: ["Order Returned"] } },
          { pickupMethod: "office", trackingId: { $ne: "Order Returned" } }
        ]
      });
      employeeCount = await Employee.countDocuments();
      products = await Product.find();
      finances = await Finance.find();
      totalRevenue = finances.reduce((sum, f) => sum + (f.revenue || 0), 0);
      totalCost = finances.reduce((sum, f) => sum + (f.cost || 0), 0);
      profit = totalRevenue - totalCost;
    } else {
      // For employees
      createOrderCount = await Order.countDocuments({
        handledBy: req.session.user.id
      });
      totalDispatchedOrders = await Order.countDocuments({
        handledBy: req.session.user.id,
        $or: [
          { trackingId: { $exists: true, $ne: "", $nin: ["Order Returned"] } },
          { pickupMethod: "office", trackingId: { $ne: "Order Returned" } }
        ]
      });
    }

    res.render('admin', {
      orderCount,
      pendingOrderCount,
      createOrderCount,
      totalDispatchedOrders,
      employeeCount,
      products,
      totalRevenue,
      totalCost,
      profit,
      message: null,
      currentRoute: 'admin',
      user: req.session.user
    });
  } catch (err) {
    console.error(err);
    res.render('admin', {
      orderCount: 0,
      pendingOrderCount: 0,
      createOrderCount: 0,
      totalDispatchedOrders: 0,
      employeeCount: 0,
      products: [],
      totalRevenue: 0,
      totalCost: 0,
      profit: 0,
      message: 'Something went wrong',
      currentRoute: 'admin',
      user: req.session.user
    });
  }
});

app.get('/admin/orders', isAuthenticated, hasPermission('orders'), async (req, res) => {
  try {
    const pageSize = 10;
    const currentPage = parseInt(req.query.page) || 1;
    const skip = (currentPage - 1) * pageSize;

    const query = {};
    const search = req.query.search || "";
    const selectedDate = req.query.date || "";
    const duplicate = req.query.duplicate === '1';
    const dayPending = req.query.dayPending === '1';

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { productName: { $regex: search, $options: 'i' } }
      ];
    }

    if (selectedDate) {
      const start = new Date(selectedDate);
      start.setHours(0, 0, 0, 0);
      const end = new Date(selectedDate);
      end.setHours(23, 59, 59, 999);
      query.createdAt = { $gte: start, $lte: end };
    }

    if (req.query.status && req.query.status !== "") {
      if (req.query.status === "Pending") {
        query.$or = query.$or || [];
        query.$or.push(
          { callStatus: { $exists: false } },
          { callStatus: "" },
          { callStatus: null },
          { callStatus: "Pending" }
        );
      } else if (["Answered", "Declined", "Cancelled", "Not-Attend", "Power Off", "Confirmed", "Day Pending"].includes(req.query.status)) {
        query.callStatus = req.query.status;
      } else {
        // fallback: ignore unknown status
      }
    }

    // SAFER HANDLE FILTER
    if (req.query.handle === "Unhandled") {
      query.$or = [
        { isInProgress: false },
        { isInProgress: { $exists: false } },
        { isInProgress: null }
      ];
    } else if (req.query.handle === "Handled") {
      query.isInProgress = true;
      // Show only orders handled by the current user (all roles)
      query.handledBy = req.session.user.id;
    }

    // Mix Order logic
    let mix = req.query.mix === '1';
    let mixPairs = [];
    if (mix) {
      // First, find all unique (name, phone) pairs in the current filtered result
      const baseOrders = await LandingOrder.find(query, { name: 1, phone: 1 });
      const seen = new Set();
      mixPairs = baseOrders
        .map(o => `${o.name}||${o.phone}`)
        .filter((pair, idx, arr) => {
          if (seen.has(pair)) return false;
          seen.add(pair);
          return true;
        })
        .map(pair => {
          const [name, phone] = pair.split('||');
          return { name, phone };
        });
      // Now, show all orders that match any of those pairs
      if (mixPairs.length > 0) {
        query.$or = mixPairs.map(({ name, phone }) => ({ name, phone }));
      } else {
        // If no pairs, show nothing
        query._id = null;
      }
    }

    // Duplicate order: same phone appearing more than once within current filters
    if (duplicate) {
      const dups = await LandingOrder.aggregate([
        { $match: query },
        { $group: { _id: "$phone", c: { $sum: 1 } } },
        { $match: { c: { $gt: 1 } } },
        { $project: { _id: 0, phone: "$_id" } }
      ]);
      const phones = dups.map(d => d.phone).filter(Boolean);
      if (phones.length > 0) {
        query.phone = { $in: phones };
      } else {
        // force no results
        query._id = null;
      }
    }

    // Day pending: Pending (or unset) created before today
    if (dayPending) {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      // ensure createdAt filter exists
      query.createdAt = query.createdAt || {};
      query.createdAt.$lt = todayStart;
      // emulate Pending semantics (include missing/empty)
      if (query.$or && Array.isArray(query.$or)) {
        // append additional pending variants but avoid duplicating whole $or if it already contains callStatus
        query.$or.push(
          { callStatus: { $exists: false } },
          { callStatus: '' },
          { callStatus: null },
          { callStatus: 'Pending' }
        );
      } else if (!query.callStatus) {
        query.$or = [
          { callStatus: { $exists: false } },
          { callStatus: '' },
          { callStatus: null },
          { callStatus: 'Pending' }
        ];
      }
    }

    const totalOrders = await LandingOrder.countDocuments(query);
    const totalPages = Math.ceil(totalOrders / pageSize);

    const orders = await LandingOrder.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageSize)
      .populate('handledBy', 'displayName email');

    res.render('orders', {
      orders,
      message: null,
      currentRoute: 'orders',
      user: req.session.user,
      selectedStatus: req.query.status || "",
      selectedHandle: req.query.handle || "",
      selectedDate,
      search,
      currentPage,
      totalPages,
      mix, // pass mix to EJS
      duplicate,
      dayPending
    });
  } catch (err) {
    console.error(err);
    res.render('orders', {
      orders: [],
      message: 'Something went wrong',
      currentRoute: 'orders',
      user: req.session.user,
      selectedStatus: req.query.status || "",
      selectedHandle: req.query.handle || "",
      selectedDate,
      search,
      currentPage: 1,
      totalPages: 1
    });
  }
});


// ✅ Toggle lock / unlock
app.post('/admin/orders/toggle-lock/:id', isAuthenticated, hasPermission('orders'), async (req, res) => {
  try {
    const order = await LandingOrder.findById(req.params.id);
    if (!order) return res.status(404).send('Order not found');

    if (!order.isInProgress) {
      order.isInProgress = true;
      order.handledBy = req.session.user.id;
    } else if (order.handledBy?.toString() === req.session.user.id) {
      order.isInProgress = false;
      order.handledBy = null;
    }
    await order.save();
    const next = req.body.nextHandle;
    let redirectUrl = '/admin/orders';
    if (next === 'Handled') {
      redirectUrl += '?handle=Handled';
    } else if (next === 'Unhandled') {
      redirectUrl += '?handle=Unhandled';
    }
    res.redirect(redirectUrl);
  } catch (err) {
    console.error(err);
    res.redirect('/admin/orders');
  }
});
// ✅ Add review — allowed if not in progress or if handled by this user
app.post('/admin/orders/add-review', isAuthenticated, hasPermission('orders'), async (req, res) => {
  try {
    const { orderId, review } = req.body;
    const order = await LandingOrder.findById(orderId);

    if (!order) return res.status(404).send('Order not found');

    // Enforce ownership logic
    if (!order.isInProgress || (order.handledBy?.toString() === req.session.user.id)) {
      order.review = review;
      await order.save();
    }

    res.redirect('/admin/orders');
  } catch (err) {
    console.error(err);
    res.redirect('/admin/orders');
  }
});
app.post('/admin/orders/update-call-status', isAuthenticated, hasPermission('orders'), async (req, res) => {
  const { orderId, callStatus } = req.body;
  if (!['Answered', 'Declined', 'Pending', 'Cancelled', 'Not-Attend', 'Power Off', 'Confirmed', 'Day Pending'].includes(callStatus)) return res.redirect('/admin/orders');

  try {
    const order = await LandingOrder.findById(orderId);
    if (order && order.handledBy?.toString() === req.session.user.id) {
      order.callStatus = callStatus;
      await order.save();
    }
    res.redirect('/admin/orders');
  } catch (err) {
    console.error('Error updating call status:', err);
    res.redirect('/admin/orders');
  }
});
// Admin Create Order
app.get('/admin/create-order', isAuthenticated, hasPermission('create-order'), async (req, res) => {
  try {
    const pageSize = 10;
    const currentPage = parseInt(req.query.page) || 1;
    const skip = (currentPage - 1) * pageSize;

    const search = req.query.search ? req.query.search.trim() : "";
    const selectedService = req.query.service || "";
    const start = req.query.start;
    const end = req.query.end;

    const query = {};

    // ✅ Only show orders created by the employee
    if (req.session.user.role !== 'admin') {
      query.handledBy = req.session.user.id;
    }

    if (search) {
      query.$or = [
        { customerName: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } }
      ];
    }

    if (selectedService) {
      query.service = selectedService;
    }

    if (start || end) {
      query.createdAt = {};
      if (start) {
        query.createdAt.$gte = new Date(start);
      }
      if (end) {
        const endDate = new Date(end);
        endDate.setHours(23, 59, 59, 999);
        query.createdAt.$lte = endDate;
      }
    }

    const totalOrders = await Order.countDocuments(query);
    const totalPages = Math.ceil(totalOrders / pageSize);

    const orders = await Order.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageSize)
      .populate('product');

    const products = await Product.find();

    res.render('create-order', {
      orders,
      products,
      message: null,
      currentRoute: 'create-order',
      user: req.session.user,
      currentPage,
      totalPages,
      search,
      selectedService,
      start,
      end
    });
  } catch (err) {
    console.error(err);
    res.render('create-order', {
      orders: [],
      products: [],
      message: 'Something went wrong',
      currentRoute: 'create-order',
      user: req.session.user,
      currentPage: 1,
      totalPages: 1,
      search: "",
      selectedService: "",
      start: "",
      end: ""
    });
  }
});
// POST - Handle Order Creation with validation
app.post('/admin/create-order', isAuthenticated, hasPermission('create-order'), validateOrder, async (req, res) => {
  try {
    const {
      customerName, email, phone,
      address, postalCode, city,
      quantity, service, productId,
      pickupMethod,
    } = req.body;

    // Validate inputs
    if (!customerName || !phone || !productId || !quantity || !pickupMethod) {
      const orders = await Order.find().sort({ createdAt: -1 }).populate('product');
      const products = await Product.find();
      return res.render('create-order', {
        orders,
        products,
        message: 'Required fields: customer name, phone, product, quantity, pickup method',
        currentRoute: 'create-order',
        user: req.session.user
      });
    }

    // Check product stock
    const product = await Product.findById(productId);
    if (!product || product.stock < quantity) {
      const orders = await Order.find().sort({ createdAt: -1 }).populate('product');
      const products = await Product.find();
      return res.render('create-order', {
        orders,
        products,
        message: `Not enough stock for ${product?.name || 'Unknown'}`,
        currentRoute: 'create-order',
        user: req.session.user
      });
    }

    // ✅ Always create a fresh order
    await Order.create({
      product: productId,
      customerName,
      email,
      phone,
      pickupMethod,
      address: pickupMethod === 'delivery' ? address : 'Pick from Office',
      postalCode: pickupMethod === 'delivery' ? postalCode : '',
      city: pickupMethod === 'delivery' ? city : '',
      quantity,
      service: pickupMethod === 'delivery' ? service : 'Pick from Office',
      handledBy: req.session.user.id
    });

    // ✅ Reduce stock
    product.stock -= parseInt(quantity);
    await product.save();

    // ✅ Create finance record
    await Finance.create({
      type: 'order',
      description: `Order for ${product.name} x${quantity}`,
      cost: product.costPrice * quantity,
      revenue: product.price * quantity,
      date: new Date()
    });

    return res.redirect('/admin/create-order');

  } catch (err) {
    console.error('❌ Error in create order:', err);
    const orders = await Order.find().sort({ createdAt: -1 }).populate('product');
    const products = await Product.find();
    return res.render('create-order', {
      orders,
      products,
      message: 'Failed to create order.',
      currentRoute: 'create-order',
      user: req.session.user
    });
  }
});
// update tracking
app.post('/admin/create-order/update-tracking', async (req, res) => {
  try {
    const { orderId, trackingId } = req.body;

    if (!orderId || !trackingId) {
      return res.status(400).json({ success: false, message: 'Order ID and Tracking ID are required.' });
    }

    const updatedOrder = await Order.findByIdAndUpdate(orderId, { trackingId }, { new: true });

    if (!updatedOrder) {
      return res.status(404).json({ success: false, message: 'Order not found.' });
    }

    res.json({ success: true, message: 'Tracking ID updated successfully.' });
  } catch (error) {
    console.error('Tracking ID update error:', error);
    res.status(500).json({ success: false, message: 'Server error updating tracking ID.' });
  }
});
//  to delete the entry in result seciotn 
app.post('/admin/create-order/delete/:id', isAuthenticated, hasPermission('create-order'), async (req, res) => {
  try {
    await Order.findByIdAndDelete(req.params.id);
    res.redirect('/admin/create-order');
  } catch (err) {
    console.error('Error deleting order:', err);
    res.status(500).render('error', { message: 'Failed to delete order' });
  }
});
// ✅ Handle marking an order as returned
app.post('/admin/create-order/return/:id', isAuthenticated, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id).populate('product');
    if (!order) return res.redirect('/admin/create-order');

    // Set order as returned
    order.trackingId = "Order Returned";
    await order.save();

    // Restore stock
    if (order.product) {
      order.product.stock += order.quantity;
      await order.product.save();
    }

    // Add to finance
    await Finance.create({
      type: 'expense',
      description: `Returned order for ${order.product?.name || 'N/A'} x${order.quantity}`,
      cost: order.product?.costPrice * order.quantity,
      revenue: 0,
      date: new Date()
    });

    res.redirect('/admin/create-order');
  } catch (err) {
    console.error('❌ Error processing return:', err);
    res.redirect('/admin/create-order');
  }
});

// Admin Employee Management
app.get('/admin/employee-management', isAuthenticated, hasPermission('employee-management'), async (req, res) => {
  try {
    const employees = await Employee.find().sort({ createdAt: -1 });

    // Also count dispatched orders: via tracking or office pickup, but skip returned
    const employeesWithDispatchCount = await Promise.all(
      employees.map(async (emp) => {
        const dispatchedCount = await Order.countDocuments({
          handledBy: emp._id,
          $or: [
            { 
              trackingId: { $exists: true, $ne: "", $nin: ["Order Returned"] }
            },
            { 
              pickupMethod: "office",
              trackingId: { $ne: "Order Returned" }
            }
          ]
        });
        return { ...emp.toObject(), dispatchedCount };
      })
    );

    res.render('employee-management', {
      employees: employeesWithDispatchCount,
      message: null,
      currentRoute: 'employee-management',
      user: req.session.user
    });
  } catch (err) {
    console.error(err);
    res.render('employee-management', {
      employees: [],
      message: 'Something went wrong',
      currentRoute: 'employee-management',
      user: req.session.user
    });
  }
});


// Add Employee with validation
app.post('/admin/employee-management', isAuthenticated, hasPermission('employee-management'), validateEmployee, async (req, res) => {
  try {
    const { email, password, role, permissions } = req.body;

    if (!email || !password || !role) {
      const employees = await Employee.find().sort({ createdAt: -1 });
      return res.render('employee-management', {
        employees,
        message: 'Email, password, and role are required',
        currentRoute: 'employee-management',
        user: req.session.user
      });
    }
    const hashedPassword = await bcrypt.hash(password, 10);
    //! Changes made by Danyal
    const employeePermissions = role === 'admin' ? ['orders', 'create-order', 'employee-management', 'track-product', 'product-management', 'finance', 'call-operator'] :
      role === 'manager' ? (Array.isArray(permissions) ? permissions : [permissions]).filter(p => ['orders', 'create-order', 'employee-management', 'track-product', 'product-management', 'finance', 'call-operator'].includes(p)) :
        (Array.isArray(permissions) ? permissions : [permissions]).filter(p => ['orders', 'create-order', 'track-product', 'product-management', 'finance', 'call-operator'].includes(p));
    const newEmployee = new Employee({
      email,
      password: hashedPassword,
      role,
      permissions: employeePermissions
    });
    await newEmployee.save();
    res.redirect('/admin/employee-management');
  } catch (err) {
    console.error(err);
    const employees = await Employee.find().sort({ createdAt: -1 });
    res.render('employee-management', {
      employees,
      message: 'Error creating employee',
      currentRoute: 'employee-management',
      user: req.session.user
    });
  }
});
// Edit Employee Form
app.get('/admin/employees/edit/:id', isAuthenticated, hasPermission('employee-management'), async (req, res) => {
  try {
    const employee = await Employee.findById(req.params.id);
    if (!employee) return res.status(404).render('error', { message: 'Employee not found' });
    res.render('editEmployee', { 
      employee, 
      message: null, 
      user: req.session.user,
      currentRoute: 'employee-management' // ADD THIS
    });
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Server error' });
  }
});
// Update Employee with validation
app.post('/admin/employees/edit/:id', isAuthenticated, hasPermission('employee-management'), validateEmployee, async (req, res) => {
  try {
    const { email, password, role } = req.body;
    let permissions = req.body.permissions;

    // ensure permissions is always an array
    if (!permissions) {
      permissions = [];
    } else if (!Array.isArray(permissions)) {
      permissions = [permissions];
    }

    // calculate permissions based on role
    let allowedPermissions = [];
    if (role === 'admin') {
      allowedPermissions = ['orders', 'create-order', 'employee-management', 'track-product', 'product-management', 'finance', 'call-operator'];
    } else if (role === 'manager') {
      allowedPermissions = ['orders', 'create-order', 'employee-management', 'track-product', 'product-management', 'finance', 'call-operator'];
    } else {
      allowedPermissions = ['orders', 'create-order', 'track-product', 'product-management', 'finance', 'call-operator'];
    }

    const employeePermissions = allowedPermissions.filter(p => permissions.includes(p));

    const updateData = { email, role, permissions: employeePermissions };

    if (password && password.trim() !== '') {
      updateData.password = await bcrypt.hash(password, 10);
    }

    await Employee.findByIdAndUpdate(req.params.id, updateData);

    res.redirect('/admin/employee-management');
  } catch (err) {
    console.error(err);
    const employee = await Employee.findById(req.params.id);
    res.render('editEmployee', { 
      employee, 
      message: 'Error updating employee', 
      user: req.session.user,
      currentRoute: 'employee-management'
    });
  }
});
// Delete Employee
app.post('/admin/employees/delete/:id', isAuthenticated, hasPermission('employee-management'), async (req, res) => {
  try {
    await Employee.findByIdAndDelete(req.params.id);
    res.redirect('/admin/employee-management');
  } catch (err) {
    console.error(err);
    const employees = await Employee.find().sort({ createdAt: -1 });
    res.render('employee-management', {
      employees,
      message: 'Error deleting employee',
      currentRoute: 'employee-management',
      user: req.session.user
    });
  }
});
// adding product Details
const Product = require('./models/Product'); // Add at the top
// Route to render the Product Management page
app.get('/admin/product-management', isAuthenticated, hasPermission('product-management'), async (req, res) => {
  try {
    const products = await Product.find().sort({ createdAt: -1 });

    // Identify products with low stock
    const lowStockProducts = products.filter(product => product.stock < 10);

    res.render('product-management', {
      user: req.session.user,
      currentRoute: 'product-management',
      products,
      lowStockProducts,   // pass to EJS
      message: null
    });
  } catch (err) {
    console.error(err);
    res.render('product-management', {
      user: req.session.user,
      currentRoute: 'product-management',
      products: [],
      lowStockProducts: [],
      message: 'Something went wrong while loading products'
    });
  }
});
// Route to add new product with validation
app.post('/admin/product-management', isAuthenticated, hasPermission('product-management'), validateProduct, async (req, res) => {
  try {
    const { name, price, costPrice, stock } = req.body;

    if (!name || !price || !stock || !costPrice) {
      const products = await Product.find().sort({ createdAt: -1 });
      return res.render('product-management', {
        user: req.session.user,
        currentRoute: 'product-management',
        products,
        message: 'All fields are required'
      });
    }

    await Product.create({ name, price, stock, costPrice });
    res.redirect('/admin/product-management');
  } catch (err) {
    console.error(err);
    const products = await Product.find().sort({ createdAt: -1 });
    res.render('product-management', {
      user: req.session.user,
      currentRoute: 'product-management',
      products,
      message: 'Error adding product'
    });
  }
});
// Edit product form
app.get('/admin/products/edit/:id', isAuthenticated, hasPermission('product-management'), async (req, res) => {
  const product = await Product.findById(req.params.id);
  if (!product) return res.status(404).render('error', { message: 'Product not found' });

  res.render('edit-product', { product, message: null, user: req.session.user });
});
// Handle edit submission with validation
app.post('/admin/products/edit/:id', isAuthenticated, hasPermission('product-management'), validateProduct, async (req, res) => {
  const { name, price, stock, costPrice } = req.body;
  try {
    await Product.findByIdAndUpdate(req.params.id, { name, price, stock, costPrice });
    res.redirect('/admin/product-management');
  } catch (err) {
    console.error(err);
    const product = await Product.findById(req.params.id);
    res.render('edit-product', { product, message: 'Failed to update product', user: req.session.user });
  }
});
// Delete product
app.post('/admin/products/delete/:id', isAuthenticated, hasPermission('product-management'), async (req, res) => {
  try {
    await Product.findByIdAndDelete(req.params.id);
    res.redirect('/admin/product-management');
  } catch (err) {
    console.error(err);
    res.status(500).render('error', { message: 'Failed to delete product' });
  }
});
// !!! here we are working on finance section of admin panenl to trak the  Revenue and expensis etc
// 🧾 Admin Finance Page
// 🚀 GET Finance Dashboard with optional date filter
app.get('/admin/finance', isAuthenticated, async (req, res) => {
  try {
    const { start, end } = req.query;

    let filter = {};
    if (start || end) {
      filter.date = {};
      if (start) filter.date.$gte = new Date(start);
      if (end) {
        // include the whole end day
        let endDate = new Date(end);
        endDate.setHours(23, 59, 59, 999);
        filter.date.$lte = endDate;
      }
    }

    const finances = await Finance.find(filter).sort({ date: -1 });

    const totalRevenue = finances.reduce((sum, f) => sum + (f.revenue || 0), 0);
    const totalCost = finances.reduce((sum, f) => sum + (f.cost || 0), 0);
    const profit = totalRevenue - totalCost;

    res.render('finance', {
      finances,
      totalRevenue,
      totalCost,
      profit,
      currentRoute: 'finance',
      user: req.session.user,
      start,
      end
    });
  } catch (err) {
    console.error(err);
    res.render('finance', {
      finances: [],
      totalRevenue: 0,
      totalCost: 0,
      profit: 0,
      currentRoute: 'finance',
      user: req.session.user,
      start: null,
      end: null
    });
  }
});

// --- TCS Proxy Endpoints (secure tokens server-side) ---
// City list proxy: our client POSTs; upstream is GET with query params
app.post('/api/tcs/cities', isAuthenticated, async (req, res) => {
  try {
    const bearer = process.env.TCS_BEARER;
    const payload = req.body && Object.keys(req.body).length ? req.body : { countrycode: ['PK'] };
    const codes = Array.isArray(payload.countrycode)
      ? payload.countrycode
      : (payload.countrycode ? [payload.countrycode] : ['PK']);
    const qs = new URLSearchParams();
    codes.forEach(c => qs.append('countrycode', String(c)));
    const url = `https://ociconnect.tcscourier.com/ecom/api/setup/citylistbycountry?${qs.toString()}`;
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {})
      }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({ message: data?.message || 'Failed to load TCS cities' });
    }
    res.json(data);
  } catch (err) {
    console.error('TCS cities proxy error:', err);
    res.status(500).json({ message: 'Server error fetching TCS cities' });
  }
});

// Product search API for dropdown functionality
app.get('/api/products/search', isAuthenticated, async (req, res) => {
  try {
    const { q } = req.query;
    if (!q || q.trim().length < 1) {
      return res.json([]);
    }
    
    const products = await Product.find({
      name: { $regex: q.trim(), $options: 'i' },
      stock: { $gt: 0 } // Only return products with stock
    }).select('name stock _id').limit(10);
    
    res.json(products);
  } catch (err) {
    console.error('Product search error:', err);
    res.status(500).json({ message: 'Server error searching products' });
  }
});

// Booking proxy: POST -> POST
app.post('/api/tcs/booking', isAuthenticated, async (req, res) => {
  try {
    const bearer = process.env.TCS_BEARER;
    const accessToken = process.env.TCS_ACCESS_TOKEN;
    if (!accessToken) {
      return res.status(500).json({ message: 'Missing TCS_ACCESS_TOKEN on server' });
    }
    
    // Extract product info and validate stock
    const { productId, pieces } = req.body;
    if (productId && pieces) {
      const product = await Product.findById(productId);
      if (!product) {
        return res.status(400).json({ message: 'Product not found' });
      }
      if (product.stock < pieces) {
        return res.status(400).json({ message: `Insufficient stock. Available: ${product.stock}, Requested: ${pieces}` });
      }
      
      // Reduce stock and create finance record
      product.stock -= parseInt(pieces);
      await product.save();
      
      await Finance.create({
        type: 'order',
        description: `TCS Order for ${product.name} x${pieces}`,
        cost: product.costPrice * pieces,
        revenue: product.price * pieces,
        date: new Date()
      });
      
      // Create order record with TCS-specific fields
      await Order.create({
        product: productId,
        customerName: req.body.consigneeinfo?.firstname + ' ' + (req.body.consigneeinfo?.middlename || '') + ' ' + (req.body.consigneeinfo?.lastname || ''),
        phone: req.body.consigneeinfo?.mobile,
        address: req.body.consigneeinfo?.address1,
        city: req.body.consigneeinfo?.cityname,
        quantity: pieces,
        service: 'TCS',
        handledBy: req.session.user.id,
        pickupMethod: 'delivery',
        // TCS-specific fields
        codAmount: req.body.shipmentinfo?.codamount || 0,
        weightInKg: req.body.shipmentinfo?.weightinkg || 0,
        pieces: pieces,
        isFragile: req.body.shipmentinfo?.fragile || false,
        contentDescription: product.name
      });
    }
    
    const body = { ...(req.body || {}) };
    body.accesstoken = accessToken;
    const response = await fetch('https://ociconnect.tcscourier.com/ecom/api/booking/create', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(bearer ? { Authorization: `Bearer ${bearer}` } : {})
      },
      body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json(data);
    }
    
    // If TCS booking was successful and we have product info, update the order with tracking details
    if (data && productId && pieces) {
      try {
        const order = await Order.findOne({
          product: productId,
          handledBy: req.session.user.id,
          service: 'TCS'
        }).sort({ createdAt: -1 });
        
        if (order) {
          order.tcsConsignmentNo = data.consignmentNumber || data.trackingNumber || data.consignmentno;
          order.tcsBookingData = data;
          order.trackingId = data.consignmentNumber || data.trackingNumber || data.consignmentno;
          await order.save();
        }
      } catch (updateErr) {
        console.error('Error updating order with TCS tracking:', updateErr);
        // Don't fail the response, just log the error
      }
    }
    
    res.json(data);
  } catch (err) {
    console.error('TCS booking proxy error:', err);
    res.status(500).json({ message: 'Server error creating TCS booking' });
  }
});

// M&P Booking proxy with stock validation
app.post('/api/mnp/booking', isAuthenticated, async (req, res) => {
  try {
    // Extract product info and validate stock
    const { productId, piecesCount } = req.body;
    if (productId && piecesCount) {
      const product = await Product.findById(productId);
      if (!product) {
        return res.status(400).json({ message: 'Product not found' });
      }
      if (product.stock < piecesCount) {
        return res.status(400).json({ message: `Insufficient stock. Available: ${product.stock}, Requested: ${piecesCount}` });
      }
      
      // Reduce stock and create finance record
      product.stock -= parseInt(piecesCount);
      await product.save();
      
      await Finance.create({
        type: 'order',
        description: `M&P Order for ${product.name} x${piecesCount}`,
        cost: product.costPrice * piecesCount,
        revenue: product.price * piecesCount,
        date: new Date()
      });
      
      // Create order record with M&P-specific fields
      await Order.create({
        product: productId,
        customerName: req.body.consigneeName,
        phone: req.body.consigneeMobNo,
        address: req.body.consigneeAddress,
        city: req.body.destinationCityName,
        quantity: piecesCount,
        service: 'M&P',
        handledBy: req.session.user.id,
        pickupMethod: 'delivery',
        // Common fields
        codAmount: req.body.codAmount || 0,
        weightInKg: req.body.weight || 0,
        pieces: piecesCount,
        isFragile: req.body.fragile === 'Y',
        contentDescription: product.name,
        email: req.body.consigneeEmail,
        // M&P-specific fields
        destinationCity: req.body.destinationCityName,
        customerReferenceNo: req.body.custRefNo,
        insuranceValue: req.body.insuranceValue || 0,
        locationID: req.body.locationID,
        returnLocation: req.body.ReturnLocation,
        subAccountId: req.body.subAccountId
      });
    }
    
    // Forward the request to M&P API
    const mnpData = { ...req.body };
    // Remove our custom fields that M&P API doesn't need
    delete mnpData.productId;
    delete mnpData.piecesCount;
    
    const response = await fetch('https://mnpcourier.com/mycodapi/api/Booking/InsertBookingData', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(mnpData)
    });
    
    const data = await response.json().catch(() => ({}));
    
    // If M&P booking was successful and we have product info, update the order with tracking details
    if (data && productId && piecesCount) {
      try {
        const order = await Order.findOne({
          product: productId,
          handledBy: req.session.user.id,
          service: 'M&P'
        }).sort({ createdAt: -1 });
        
        if (order) {
          // M&P API response structure may vary, adapt as needed
          const trackingId = data.orderReferenceId || data.consignment || data.trackingNo || data.referenceId;
          if (trackingId) {
            order.trackingId = trackingId;
            order.mnpReferenceId = trackingId;
            order.mnpBookingData = data; // Store complete response
            await order.save();
          }
        }
      } catch (updateErr) {
        console.error('Error updating M&P order with tracking:', updateErr);
        // Don't fail the response, just log the error
      }
    }
    
    if (!response.ok) {
      return res.status(response.status).json(data);
    }
    
    res.json(data);
  } catch (err) {
    console.error('M&P booking proxy error:', err);
    res.status(500).json({ message: 'Server error creating M&P booking' });
  }
});

// PostEx Booking proxy with stock validation
app.post('/api/postex/booking', isAuthenticated, async (req, res) => {
  try {
    // Extract product info and validate stock
    const { productId, itemsCount } = req.body;
    if (productId && itemsCount) {
      const product = await Product.findById(productId);
      if (!product) {
        return res.status(400).json({ message: 'Product not found' });
      }
      if (product.stock < itemsCount) {
        return res.status(400).json({ message: `Insufficient stock. Available: ${product.stock}, Requested: ${itemsCount}` });
      }
      
      // Reduce stock and create finance record
      product.stock -= parseInt(itemsCount);
      await product.save();
      
      await Finance.create({
        type: 'order',
        description: `PostEx Order for ${product.name} x${itemsCount}`,
        cost: product.costPrice * itemsCount,
        revenue: product.price * itemsCount,
        date: new Date()
      });
      
      // Create order record with PostEx-specific fields
      await Order.create({
        product: productId,
        customerName: req.body.customerName,
        phone: req.body.customerPhone,
        address: req.body.deliveryAddress,
        city: req.body.cityName,
        quantity: itemsCount,
        service: 'PostEx',
        handledBy: req.session.user.id,
        pickupMethod: 'delivery',
        // Common fields
        pieces: itemsCount,
        contentDescription: product.name,
        // PostEx-specific fields
        postexOrderRefNumber: req.body.orderRefNumber,
        invoicePayment: req.body.invoicePayment || 0,
        invoiceDivision: req.body.invoiceDivision || 1,
        orderType: req.body.orderType || 'Normal',
        transactionNotes: req.body.transactionNotes,
        pickupAddressCode: req.body.pickupAddressCode,
        storeAddressCode: req.body.storeAddressCode
      });
    }
    
    // Forward the request to PostEx API
    const postexData = { ...req.body };
    // Remove our custom fields that PostEx API doesn't need
    delete postexData.productId;
    delete postexData.itemsCount;
    
    const token = process.env.POSTEX_API_TOKEN;
    if (!token) {
      return res.status(500).json({ message: 'Missing POSTEX_API_TOKEN on server' });
    }
    const response = await fetch('https://api.postex.pk/services/integration/api/order/v3/create-order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'token': token
      },
      body: JSON.stringify(postexData)
    });
    
    const data = await response.json().catch(() => ({}));
    
    // If PostEx booking was successful and we have product info, update the order with tracking details
    if (data && productId && itemsCount) {
      try {
        const order = await Order.findOne({
          product: productId,
          handledBy: req.session.user.id,
          service: 'PostEx'
        }).sort({ createdAt: -1 });
        
        if (order) {
          // PostEx API response structure
          const trackingId = data.dist?.trackingNumber || data.trackingNumber || data.orderRefNumber;
          if (trackingId) {
            order.trackingId = trackingId;
            order.postexTrackingNumber = trackingId;
            order.postexBookingData = data; // Store complete response
            await order.save();
          }
        }
      } catch (updateErr) {
        console.error('Error updating PostEx order with tracking:', updateErr);
        // Don't fail the response, just log the error
      }
    }
    
    if (!response.ok) {
      return res.status(response.status).json(data);
    }
    
    res.json(data);
  } catch (err) {
    console.error('PostEx booking proxy error:', err);
    res.status(500).json({ message: 'Server error creating PostEx booking' });
  }
});

// Attendance page
app.get('/admin/attendence', isAuthenticated, async (req, res) => {
  res.render('attendence', {
    user: req.session.user,
    currentRoute: 'attendence',
    message: null
  });
});

// AJAX Check In
app.post('/admin/attendence/checkin', isAuthenticated, async (req, res) => {
  try {
    const now = new Date();
    const today = new Date();
    today.setHours(0,0,0,0);
    let attendance = await Attendance.findOne({ user: req.session.user.id, date: today });
    if (!attendance) {
      attendance = new Attendance({
        user: req.session.user.id,
        email: req.session.user.email,
        displayName: req.session.user.displayName,
        checkIn: now.toISOString(),
        status: 'present',
        date: today
      });
      await attendance.save();
    } else {
      if (attendance.checkIn) {
        return res.json({ success: false, error: 'You have already checked in today.' });
      }
      attendance.checkIn = now.toISOString();
      attendance.status = 'present';
      await attendance.save();
    }
    res.json({ success: true, checkIn: attendance.checkIn });
  } catch (err) {
    res.json({ success: false, error: 'Check-in failed.' });
  }
});

// AJAX Check Out
app.post('/admin/attendence/checkout', isAuthenticated, async (req, res) => {
  try {
    const now = new Date();
    const today = new Date();
    today.setHours(0,0,0,0);
    const attendance = await Attendance.findOne({ user: req.session.user.id, date: today });
    if (!attendance || !attendance.checkIn) {
      return res.json({ success: false, error: 'No check-in found for today.' });
    }
    if (attendance.checkOut) {
      // Already checked out today
      return res.json({ success: false, error: 'You have already checked out today.' });
    }
    attendance.checkOut = now.toISOString();
    // Calculate total time
    const totalMs = new Date(attendance.checkOut) - new Date(attendance.checkIn);
    const hours = Math.floor(totalMs / 3600000);
    const minutes = Math.floor((totalMs % 3600000) / 60000);
    const seconds = Math.floor((totalMs % 60000) / 1000);
    attendance.totalTime = `${hours.toString().padStart(2, '0')}:${minutes
      .toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    await attendance.save();
    res.json({ success: true, checkOut: now.toISOString(), totalTime: attendance.totalTime });
  } catch (err) {
    res.json({ success: false, error: 'Check-out failed.' });
  }
});

// Attendance details for employee (for modal)
app.get('/admin/attendance-details/:employeeId', isAuthenticated, async (req, res) => {
  try {
    const attendance = await Attendance.find({ user: req.params.employeeId })
      .sort({ date: -1 })
      .lean();
    res.json({ success: true, attendance });
  } catch (err) {
    res.json({ success: false, error: 'Failed to fetch attendance records.' });
  }
});

// Attendance summary (monthly/yearly) and absence detection
app.get('/admin/attendance-summary/:employeeId', isAuthenticated, async (req, res) => {
  try {
    const { month, year } = req.query;
    const employeeId = req.params.employeeId;
    let start, end;
    if (month) {
      // month format: YYYY-MM
      start = new Date(month + '-01');
      end = new Date(start);
      end.setMonth(end.getMonth() + 1);
    } else if (year) {
      start = new Date(year + '-01-01');
      end = new Date(year + '-12-31');
      end.setMonth(12, 0); // last day of year
    } else {
      // default: current month
      start = new Date();
      start.setDate(1);
      start.setHours(0,0,0,0);
      end = new Date(start);
      end.setMonth(end.getMonth() + 1);
    }
    // Get all days in range
    const days = [];
    let d = new Date(start);
    while (d < end) {
      days.push(new Date(d));
      d.setDate(d.getDate() + 1);
    }
    // Fetch attendance records
    const records = await Attendance.find({
      user: employeeId,
      date: { $gte: start, $lt: end }
    }).lean();
    // Map by date string
    const recordMap = {};
    records.forEach(r => {
      recordMap[new Date(r.date).toDateString()] = r;
    });
    // Build summary
    const summary = days.map(day => {
      const key = day.toDateString();
      if (recordMap[key]) {
        return { ...recordMap[key], absent: false };
      } else {
        return { date: day, status: 'absent', absent: true };
      }
    });
    res.json({ success: true, summary });
  } catch (err) {
    res.json({ success: false, error: 'Failed to fetch summary.' });
  }
});
// Export attendance to CSV
app.get('/admin/attendance-export/:employeeId', isAuthenticated, async (req, res) => {
  try {
    const { start, end } = req.query;
    const employeeId = req.params.employeeId;
    const query = { user: employeeId };
    if (start && end) {
      query.date = { $gte: new Date(start), $lte: new Date(end) };
    }
    const records = await Attendance.find(query).sort({ date: 1 }).lean();
    const fields = ['date', 'status', 'checkIn', 'checkOut', 'totalTime'];
    const opts = { fields, transforms: [r => ({ ...r, date: r.date ? new Date(r.date).toLocaleDateString() : '' })] };
    const parser = new Parser(opts);
    const csv = parser.parse(records);
    res.header('Content-Type', 'text/csv');
    res.attachment('attendance.csv');
    res.send(csv);
  } catch (err) {
    res.status(500).send('Failed to export CSV');
  }
});

// Get today's attendance for the logged-in user
app.get('/admin/attendence/today', isAuthenticated, async (req, res) => {
  try {
    const today = new Date();
    today.setHours(0,0,0,0);
    const attendance = await Attendance.findOne({ user: req.session.user.id, date: today });
    res.json({ success: true, attendance });
  } catch (err) {
    res.json({ success: false, error: 'Failed to fetch today\'s attendance.' });
  }
});

// Lightweight polling endpoint to check for new landing orders since a timestamp
app.get('/admin/orders/new-count', isAuthenticated, hasPermission('orders'), async (req, res) => {
  try {
    const { since } = req.query;
    if (!since) {
      const latest = await LandingOrder.findOne({}, { createdAt: 1 }).sort({ createdAt: -1 }).lean();
      return res.json({ count: 0, latest: latest?.createdAt || null });
    }
    const sinceDate = new Date(since);
    if (isNaN(sinceDate.getTime())) {
      return res.json({ count: 0, latest: null });
    }
    const [count, latest] = await Promise.all([
      LandingOrder.countDocuments({ createdAt: { $gt: sinceDate } }),
      LandingOrder.findOne({}, { createdAt: 1 }).sort({ createdAt: -1 }).lean()
    ]);
    res.json({ count, latest: latest?.createdAt || null });
  } catch (err) {
    console.error('new-count error:', err);
    res.json({ count: 0, latest: null });
  }
});

// Return HTML fragment for orders created after a timestamp, honoring filters
app.get('/admin/orders/new-fragment', isAuthenticated, hasPermission('orders'), async (req, res) => {
  try {
    const { since, search = '', date = '', status = '', handle = '', mix = '' } = req.query;
    let query = {};
    // reuse same filters as /admin/orders
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
        { productName: { $regex: search, $options: 'i' } }
      ];
    }
    if (date) {
      const start = new Date(date);
      start.setHours(0, 0, 0, 0);
      const end = new Date(date);
      end.setHours(23, 59, 59, 999);
      query.createdAt = { $gte: start, $lte: end };
    }
    if (status) {
      if (status === 'Pending') {
        query.$or = query.$or || [];
        query.$or.push(
          { callStatus: { $exists: false } },
          { callStatus: "" },
          { callStatus: null },
          { callStatus: "Pending" }
        );
      } else if (["Answered", "Declined", "Cancelled", "Not-Attend", "Power Off", "Confirmed", "Day Pending"].includes(status)) {
        query.callStatus = status;
      }
    }
    if (handle === 'Unhandled') {
      query.$or = [
        { isInProgress: false },
        { isInProgress: { $exists: false } },
        { isInProgress: null }
      ];
    } else if (handle === 'Handled') {
      query.isInProgress = true;
      // Show only orders handled by the current user (all roles)
      query.handledBy = req.session.user.id;
    }
    let mixPairs = [];
    const isMix = mix === '1';
    if (isMix) {
      const baseOrders = await LandingOrder.find(query, { name: 1, phone: 1 });
      const seen = new Set();
      mixPairs = baseOrders
        .map(o => `${o.name}||${o.phone}`)
        .filter(pair => {
          if (seen.has(pair)) return false;
          seen.add(pair);
          return true;
        })
        .map(pair => {
          const [n,p] = pair.split('||');
          return { name: n, phone: p };
        });
      if (mixPairs.length > 0) {
        query.$or = mixPairs.map(({ name, phone }) => ({ name, phone }));
      } else {
        query._id = null; // no results
      }
    }

    // since filter
    if (since) {
      const sinceDate = new Date(since);
      if (!isNaN(sinceDate.getTime())) {
        query.createdAt = query.createdAt || {};
        query.createdAt.$gt = sinceDate;
      }
    }

    const orders = await LandingOrder.find(query)
      .sort({ createdAt: -1 })
      .limit(50)
      .populate('handledBy', 'displayName email')
      .lean();

    const latest = await LandingOrder.findOne({}, { createdAt: 1 }).sort({ createdAt: -1 }).lean();

    // Render partial rows to HTML string
    res.render('partials/orderRows', { orders, user: req.session.user }, (err, html) => {
      if (err) {
        console.error('Render partial error:', err);
        return res.json({ html: '', latest: latest?.createdAt || null });
      }
      res.json({ html, latest: latest?.createdAt || null });
    });
  } catch (err) {
    console.error('new-fragment error:', err);
    res.json({ html: '', latest: null });
  }
});

// --- Global error handler ---
// Local Delivery API Endpoints
app.post('/api/local/create', isAuthenticated, async (req, res) => {
  try {
    const {
      customerName,
      customerPhone,
      deliveryAddress,
      cityName,
      productId,
      itemsPieces,
      transactionNotes,
      deliverVia
    } = req.body;

    // Validate required fields
    if (!customerName || !customerPhone || !deliveryAddress || !cityName || !itemsPieces || !deliverVia) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields'
      });
    }

    // Validate phone format
    const phonePattern = /^03[0-9]{9}$/;
    if (!phonePattern.test(customerPhone)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid phone number format. Use 03xxxxxxxxx'
      });
    }

    let product = null;
    let productName = 'Local Delivery';

    // Handle product validation and stock deduction if product is selected
    if (productId && itemsPieces) {
      product = await Product.findById(productId);
      if (!product) {
        return res.status(400).json({
          success: false,
          message: 'Product not found'
        });
      }
      if (product.stock < itemsPieces) {
        return res.status(400).json({
          success: false,
          message: `Insufficient stock. Available: ${product.stock}, Requested: ${itemsPieces}`
        });
      }
      
      // Reduce stock
      product.stock -= parseInt(itemsPieces);
      await product.save();
      productName = product.name;
    }

    // Create local delivery order
    const localOrder = new Order({
      customerName,
      phone: customerPhone,
      address: deliveryAddress,
      city: cityName,
      quantity: itemsPieces,
      service: 'Local',
      handledBy: req.session.user.id,
      pickupMethod: 'delivery',
      // Product information
      product: productId || null,
      contentDescription: productName,
      // Local-specific fields
      transactionNotes: transactionNotes || '',
      deliverVia,
      status: 'Pending',
      // Set tracking ID to a local format
      trackingId: `LOCAL-${Date.now()}-${Math.random().toString(36).substr(2, 5).toUpperCase()}`,
      createdAt: new Date()
    });

    await localOrder.save();

    // Create finance record
    const cost = product ? (product.costPrice * itemsPieces) : 0;
    const revenue = product ? (product.price * itemsPieces) : 0;
    
    await Finance.create({
      type: 'order',
      description: `Local Delivery Order for ${customerName} - ${productName} x${itemsPieces}`,
      cost: cost,
      revenue: revenue,
      date: new Date()
    });

    res.json({
      success: true,
      message: 'Local delivery order created successfully',
      orderId: localOrder._id,
      trackingId: localOrder.trackingId
    });

  } catch (error) {
    console.error('Local delivery creation error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create local delivery order'
    });
  }
});

app.get('/api/local/orders', isAuthenticated, async (req, res) => {
  try {
    // Get local delivery orders
    const query = { service: 'Local' };
    
    // If not admin, only show orders handled by current user
    if (req.session.user.role !== 'admin') {
      query.handledBy = req.session.user.id;
    }

    const orders = await Order.find(query)
      .populate('product', 'name')
      .sort({ createdAt: -1 })
      .limit(100); // Limit to last 100 orders

    // Format orders for display
    const formattedOrders = orders.map(order => ({
      _id: order._id,
      customerName: order.customerName,
      customerPhone: order.phone,
      deliveryAddress: order.address,
      cityName: order.city,
      itemsPieces: order.quantity,
      productName: order.product ? order.product.name : (order.contentDescription || 'Local Delivery'),
      transactionNotes: order.transactionNotes || '',
      deliverVia: order.deliverVia,
      status: order.status || 'Pending',
      trackingId: order.trackingId,
      createdAt: order.createdAt
    }));

    res.json({
      success: true,
      orders: formattedOrders
    });

  } catch (error) {
    console.error('Local orders fetch error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch local delivery orders'
    });
  }
});

app.use((err, req, res, next) => {
  console.error('[ERROR] Unhandled error for', req.method, req.originalUrl, err && err.stack ? err.stack : err);
  if (res.headersSent) return next(err);
  res.status(500).send('Internal Server Error');
});

// Export the app for Vercel/Serverless. Local dev uses server.js to listen.
module.exports = app;
