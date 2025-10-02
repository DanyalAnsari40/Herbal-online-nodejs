const cloudinary = require('cloudinary');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const multer = require('multer');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Configure Cloudinary storage for multer
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: {
    folder: 'admin-panel/profile-pics', // Folder in Cloudinary
    allowed_formats: ['jpg', 'jpeg', 'png', 'gif', 'webp'],
    transformation: [
      { width: 300, height: 300, crop: 'fill', gravity: 'face' }, // Resize and crop to 300x300, focusing on face
      { quality: 'auto:good' } // Optimize quality
    ],
    public_id: (req, file) => {
      // Generate unique filename with user ID and timestamp
      const userId = req.session.user?.id || req.session.user?._id || 'unknown';
      const timestamp = Date.now();
      return `profile_${userId}_${timestamp}`;
    },
  },
});

// Configure multer with Cloudinary storage
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Check file type
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  },
// Helper function to delete old profile picture from Cloudinary
const deleteProfilePicture = async (publicId) => {
  try {
    if (publicId) {
      const result = await cloudinary.v2.uploader.destroy(publicId);
      console.log('Deleted old profile picture:', result);
      return result;
    }
  } catch (error) {
    console.error('Error deleting profile picture:', error);
  }
};

// Helper function to get optimized URL
const getOptimizedUrl = (publicId, options = {}) => {
  if (!publicId) return '/uploads/default-profile.svg'; // fallback to default
  
  const defaultOptions = {
    width: 150,
    height: 150,
    crop: 'fill',
    gravity: 'face',
    quality: 'auto:good',
    format: 'auto'
  };
  
  const finalOptions = { ...defaultOptions, ...options };
  
  return cloudinary.v2.url(publicId, finalOptions);
};

// Helper function for different sizes
const getProfilePicUrl = (publicId, size = 'medium') => {
  const sizeOptions = {
    small: { width: 50, height: 50 },
    medium: { width: 150, height: 150 },
    large: { width: 300, height: 300 }
  };
  
  return getOptimizedUrl(publicId, sizeOptions[size] || sizeOptions.medium);
};

module.exports = {
  cloudinary,
  upload,
  deleteProfilePicture,
  getOptimizedUrl,
  getProfilePicUrl
};
