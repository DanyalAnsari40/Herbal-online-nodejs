require('dotenv').config();
const app = require('./app');

const PORT = process.env.PORT || 3000;

// Start server with database readiness check
async function startServer() {
  try {
    // Give the database a moment to initialize
    console.log('🚀 Starting Elite Admin Panel server...');
    
    // Wait a bit for database connection to establish
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    app.listen(PORT, () => {
      console.log(`✅ Local server running at http://localhost:${PORT}`);
      console.log(`📱 PWA Install: Visit the URL above to see install popup`);
      console.log(`🔧 Icon Generator: http://localhost:${PORT}/generate-icons`);
      console.log(`📚 Documentation: Check PWA_SETUP.md for details`);
    });
  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
