# 🚀 Landing Page Order API Documentation

## Overview
This API endpoint allows you to submit orders from multiple landing pages to your admin panel. It's designed to be flexible and accept various fields while maintaining data integrity.

## API Endpoint
```
POST /api/order
Content-Type: application/json
```

## Base URL
```
https://your-domain.com/api/order
```

## Required Fields
| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `name` | String | Customer name (min 2 chars) | "Ahmed Ali" |
| `phone` | String | Pakistani phone number | "03001234567" |

## Optional Fields
| Field | Type | Description | Example |
|-------|------|-------------|---------|
| `productName` | String | Product name | "Diabo Control Plus" |
| `email` | String | Customer email | "customer@email.com" |
| `address` | String | Customer address | "House 123, Street 5" |
| `city` | String | Customer city | "Karachi" |
| `source` | String | Landing page source | "facebook-ad" |
| `campaign` | String | Marketing campaign | "diabetes-awareness-2024" |
| `landingPageId` | String | Unique page identifier | "landing-page-001" |
| `utm_source` | String | UTM source parameter | "google" |
| `utm_medium` | String | UTM medium parameter | "cpc" |
| `utm_campaign` | String | UTM campaign parameter | "diabetes-control" |

## Request Example

### Basic Request (Minimum Fields)
```javascript
fetch('https://your-domain.com/api/order', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    name: "Ahmed Ali",
    phone: "03001234567"
  })
})
```

### Enhanced Request (With Tracking)
```javascript
fetch('https://your-domain.com/api/order', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    name: "Ahmed Ali",
    phone: "03001234567",
    productName: "Diabo Control Plus",
    email: "ahmed@email.com",
    city: "Karachi",
    source: "facebook-ad",
    campaign: "diabetes-awareness-2024",
    landingPageId: "landing-page-001",
    utm_source: "facebook",
    utm_medium: "social",
    utm_campaign: "diabetes-control"
  })
})
```

### HTML Form Example
```html
<form id="orderForm">
  <input type="text" name="name" placeholder="Your Name" required>
  <input type="tel" name="phone" placeholder="03001234567" required>
  <input type="hidden" name="productName" value="Diabo Control">
  <input type="hidden" name="source" value="landing-page-diabetes">
  <input type="hidden" name="landingPageId" value="lp-001">
  <button type="submit">Order Now</button>
</form>

<script>
document.getElementById('orderForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const formData = new FormData(e.target);
  const data = Object.fromEntries(formData);
  
  try {
    const response = await fetch('/api/order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    
    const result = await response.json();
    if (result.success) {
      alert('Order submitted successfully!');
    } else {
      alert('Error: ' + result.message);
    }
  } catch (error) {
    alert('Network error occurred');
  }
});
</script>
```

## Response Format

### Success Response (201 Created)
```json
{
  "success": true,
  "message": "Order created successfully",
  "orderId": "64f7b1234567890abcdef123",
  "data": {
    "name": "Ahmed Ali",
    "phone": "03001234567",
    "productName": "Diabo Control Plus",
    "createdAt": "2024-01-15T10:30:00.000Z"
  }
}
```

### Error Response (400 Bad Request)
```json
{
  "success": false,
  "message": "Name is required (minimum 2 characters)"
}
```

### Error Response (500 Internal Server Error)
```json
{
  "success": false,
  "message": "Failed to create order",
  "error": "Database connection failed"
}
```

## Phone Number Validation
The API accepts Pakistani phone numbers in these formats:
- `03001234567`
- `+923001234567`
- `0300-123-4567`
- `0300 123 4567`

## Security Features
- ✅ Input validation and sanitization
- ✅ XSS protection (removes dangerous characters)
- ✅ Phone number format validation
- ✅ Rate limiting ready
- ✅ Error handling

## Integration Examples

### For 200 Landing Pages
You can use the same API endpoint for all your landing pages by:

1. **Set different product names per page:**
```javascript
// Landing Page 1
{ name: "Customer", phone: "03001234567", productName: "Diabo Control" }

// Landing Page 2  
{ name: "Customer", phone: "03001234567", productName: "Heart Care Plus" }

// Landing Page 3
{ name: "Customer", phone: "03001234567", productName: "Weight Loss Pro" }
```

2. **Track landing page sources:**
```javascript
{ 
  name: "Customer", 
  phone: "03001234567",
  source: "facebook-diabetes-ad",
  landingPageId: "lp-diabetes-001",
  campaign: "winter-2024"
}
```

3. **Use UTM parameters for analytics:**
```javascript
{
  name: "Customer",
  phone: "03001234567", 
  utm_source: "google",
  utm_medium: "cpc",
  utm_campaign: "diabetes-keywords"
}
```

## Testing the API

### Using cURL
```bash
curl -X POST https://your-domain.com/api/order \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Test Customer",
    "phone": "03001234567",
    "productName": "Diabo Control",
    "source": "test-landing-page"
  }'
```

### Using Postman
1. Set method to `POST`
2. URL: `https://your-domain.com/api/order`
3. Headers: `Content-Type: application/json`
4. Body (raw JSON):
```json
{
  "name": "Test Customer",
  "phone": "03001234567",
  "productName": "Test Product"
}
```

## Admin Panel Integration
All orders submitted via this API will appear in your admin panel with:
- ✅ Customer name and phone
- ✅ Product name in dedicated column
- ✅ Source tracking information
- ✅ UTM parameters for analytics
- ✅ Full search functionality
- ✅ Real-time notifications

## Best Practices
1. **Always include `productName`** to identify which product the customer wants
2. **Use `source` field** to track which landing page generated the order
3. **Include `landingPageId`** for unique page identification
4. **Add UTM parameters** for marketing analytics
5. **Handle errors gracefully** in your frontend
6. **Test thoroughly** before deploying to production

## Rate Limiting
Consider implementing rate limiting on your server to prevent abuse:
- Recommended: 100 requests per minute per IP
- Use tools like `express-rate-limit` for implementation
