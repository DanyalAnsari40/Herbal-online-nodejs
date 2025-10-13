const mongoose = require('mongoose');

const employeeSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  password: {
    type: String,
    required: true,
  },
  role: {
    type: String,
    enum: ['staff', 'manager', 'admin'],
    required: true,
  },
  permissions: [{
    type: String,
    enum: ['orders', 'create-order', 'employee-management', 'track-product','product-management','finance', 'call-operator'],
  }],
    profilePic: {
    type: String, // store filename or URL
    default: '', 
  },
  displayName: {
    type: String,
    default: '',
  },
  createdAt: {
    type: Date,
    default: Date.now,s
  },
});

module.exports = mongoose.model('Employee', employeeSchema);
