const mongoose = require("mongoose");

const landingOrderSchema = new mongoose.Schema({
  name: String,
  phone: String,
  productName: { type: String, default: '' }, // Product name field
  
  // Optional fields for enhanced landing pages
  email: { type: String, default: '' },
  address: { type: String, default: '' },
  city: { type: String, default: '' },
  source: { type: String, default: '' }, // Landing page source
  campaign: { type: String, default: '' }, // Marketing campaign
  landingPageId: { type: String, default: '' }, // Unique landing page identifier
  
  // UTM tracking parameters
  utm_source: { type: String, default: '' },
  utm_medium: { type: String, default: '' },
  utm_campaign: { type: String, default: '' },
  
  // Flexible metadata field for any additional data
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
  
  createdAt: {
    type: Date,
    default: Date.now
  },
  isInProgress: { type: Boolean, default: false },
  handledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'Employee' },
  review: { type: String }, 
  callStatus: {
    type: String,
    enum: ['Answered', 'Declined', 'Pending', 'Cancelled', 'Not-Attend', 'Power Off', 'Confirmed', 'Day Pending'],
    default: 'Pending'
  }
  

});

module.exports = mongoose.model("LandingOrder", landingOrderSchema);
