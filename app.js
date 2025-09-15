const express = require('express');
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
// for Finance mangemnet
const Finance = require('./models/Finance');
const multer = require('multer');
// Use memory storage on Vercel (serverless FS is read-only); disk storage locally
const upload = multer(process.env.VERCEL ? { storage: multer.memoryStorage() } : { dest: 'public/uploads/' });
const LandingOrder = require('./models/Order'); // your simple schema: name, phone, createdAt
const { Parser } = require('json2csv');

const app = express();
// Middleware
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.set('view engine', 'ejs');
// Absolute paths for views/static for Vercel
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));
// Trust proxy for secure cookies behind Vercel/Proxies
app.set('trust proxy', 1);
app.use(session({
  secret: process.env.SESSION_SECRET || 'change-this-secret',
  resave: false,
  saveUninitialized: false,
  store: MongoStore.create({
    mongoUrl: process.env.MONGOURI,
    ttl: 14 * 24 * 60 * 60
  }),
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// MongoDB connection
mongoose.connect(process.env.MONGOURI, {
  connectTimeoutMS: 30000, // 30 seconds
  socketTimeoutMS: 30000,  // 30 seconds
  serverSelectionTimeoutMS: 60000, // 60 seconds for server selection
}).then(() => console.log('MongoDB connected'))
  .catch(err => console.error('MongoDB connection error:', err));

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
  permissions: [{ type: String, enum: ['orders', 'create-order', 'employee-management', 'track-product', 'product-management', 'finance'] }],
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

// Hardcoded admin setup (run once or check if exists)
const setupAdmin = async () => {
  const adminEmail = 'rao@rao.com';
  const adminExists = await Employee.findOne({ email: adminEmail });
  if (!adminExists) {
    const hashedPassword = await bcrypt.hash('123456', 10);
    await Employee.create({
      email: adminEmail,
      password: hashedPassword,
      role: 'admin',
      permissions: ['orders', 'create-order', 'employee-management', 'track-product', 'product-management', 'finance']
    });
    console.log('Admin user created');
  }
};
setupAdmin();

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

// Routes
//!!!!!!!! added by danyal
// admin/tracking
app.get('/admin/tracking', isAuthenticated, hasPermission('employee-management'), (req, res) => {
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

// Login Handler
app.post('/login', async (req, res) => {
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
      permissions: employee.permissions
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

// Landing Page
app.get('/', (req, res) => {
  const message = req.query.success ? 'آرڈ درج ہوگیا ہے' : null;
  res.render('index', { message });
});
// orders
app.post('/order', async (req, res) => {
  try {
    const { name, phone } = req.body;
    if (!name || !phone) {
      return res.render('index', { message: 'Name and phone are required' });
    }
    await LandingOrder.create({ name, phone });
    res.redirect('/?success=1');
  } catch (err) {
    console.error(err);
    res.render('index', { message: 'آرڈ درج نہیں ہوا ' });
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
      createOrderCount = await Order.countDocuments(); // total orders created

      totalDispatchedOrders = await Order.countDocuments({
        $or: [
          { trackingId: { $exists: true, $ne: "", $nin: ["Order Returned"] } },
          { pickupMethod: "office", trackingId: { $ne: "Order Returned" } }
        ]
      }); // total dispatched orders excluding returned

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
      }); // total orders created by this employee

      totalDispatchedOrders = await Order.countDocuments({
        handledBy: req.session.user.id,
        $or: [
          { trackingId: { $exists: true, $ne: "", $nin: ["Order Returned"] } },
          { pickupMethod: "office", trackingId: { $ne: "Order Returned" } }
        ]
      }); // orders by this employee excluding returned
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

// Admin Orders
app.get('/admin/orders', isAuthenticated, hasPermission('orders'), async (req, res) => {
  try {
    const pageSize = 10;
    const currentPage = parseInt(req.query.page) || 1;
    const skip = (currentPage - 1) * pageSize;

    const query = {};
    const search = req.query.search || "";
    const selectedDate = req.query.date || "";

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } }
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
      } else if (["Answered", "Declined", "Cancelled", "Not-Attend", "Power Off"].includes(req.query.status)) {
        query.callStatus = req.query.status;
      } else {
        // fallback: ignore unknown status
      }
    }

    // ✅ SAFER HANDLE FILTER
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
      mix // pass mix to EJS
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
  if (!['Answered', 'Declined', 'Pending', 'Cancelled', 'Not-Attend', 'Power Off'].includes(callStatus)) return res.redirect('/admin/orders');

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
// POST - Handle Order Creation
app.post('/admin/create-order', isAuthenticated, hasPermission('create-order'), async (req, res) => {
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


// Add Employee
app.post('/admin/employee-management', isAuthenticated, hasPermission('employee-management'), async (req, res) => {
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
    const employeePermissions = role === 'admin' ? ['orders', 'create-order', 'employee-management', 'track-product', 'product-management', 'finance'] :
      role === 'manager' ? (Array.isArray(permissions) ? permissions : [permissions]).filter(p => ['orders', 'create-order', 'employee-management', 'track-product', 'product-management', 'finance'].includes(p)) :
        (Array.isArray(permissions) ? permissions : [permissions]).filter(p => ['orders', 'create-order', 'track-product', 'product-management', 'finance'].includes(p));
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
// Update Employee
app.post('/admin/employees/edit/:id', isAuthenticated, hasPermission('employee-management'), async (req, res) => {
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
      allowedPermissions = ['orders', 'create-order', 'employee-management', 'track-product', 'product-management', 'finance'];
    } else if (role === 'manager') {
      allowedPermissions = ['orders', 'create-order', 'employee-management', 'track-product', 'product-management', 'finance'];
    } else {
      allowedPermissions = ['orders', 'create-order', 'track-product', 'product-management', 'finance'];
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
// Route to add new product
app.post('/admin/product-management', isAuthenticated, hasPermission('employee-management'), async (req, res) => {
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
// Handle edit submission
app.post('/admin/products/edit/:id', isAuthenticated, hasPermission('product-management'), async (req, res) => {
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

// Booking proxy: POST -> POST
app.post('/api/tcs/booking', isAuthenticated, async (req, res) => {
  try {
    const bearer = process.env.TCS_BEARER;
    const accessToken = process.env.TCS_ACCESS_TOKEN;
    if (!accessToken) {
      return res.status(500).json({ message: 'Missing TCS_ACCESS_TOKEN on server' });
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
    res.json(data);
  } catch (err) {
    console.error('TCS booking proxy error:', err);
    res.status(500).json({ message: 'Server error creating TCS booking' });
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
        { phone: { $regex: search, $options: 'i' } }
      ];
    }
    if (date) {
      const start = new Date(date);
      start.setHours(0,0,0,0);
      const end = new Date(date);
      end.setHours(23,59,59,999);
      query.createdAt = { $gte: start, $lte: end };
    }
    if (status) {
      if (status === 'Pending') {
        query.$or = query.$or || [];
        query.$or.push(
          { callStatus: { $exists: false } },
          { callStatus: '' },
          { callStatus: null },
          { callStatus: 'Pending' }
        );
      } else if (["Answered", "Declined", "Cancelled", "Not-Attend", "Power Off"].includes(status)) {
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

// Export the app for Vercel/Serverless. Local dev uses server.js to listen.
module.exports = app;
