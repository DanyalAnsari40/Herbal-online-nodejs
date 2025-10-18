const fs = require('fs');
const path = require('path');

// Create a simple SVG icon as base64 data URL for basic functionality
const createBasicIcon = (size) => {
  const svg = `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bgGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" style="stop-color:#FCA311;stop-opacity:1" />
        <stop offset="100%" style="stop-color:#14213D;stop-opacity:1" />
      </linearGradient>
    </defs>
    <rect width="${size}" height="${size}" rx="${size * 0.15}" ry="${size * 0.15}" fill="url(#bgGradient)"/>
    <text x="${size/2}" y="${size/2 + size * 0.05}" font-family="Arial, sans-serif" font-size="${size * 0.15}" font-weight="bold" text-anchor="middle" fill="white">EA</text>
  </svg>`;
  
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
};

// Create icons directory if it doesn't exist
const iconsDir = path.join(__dirname, 'public', 'icons');
if (!fs.existsSync(iconsDir)) {
  fs.mkdirSync(iconsDir, { recursive: true });
}

// Create a simple HTML file that generates PNG icons from SVG
const iconSizes = [16, 32, 72, 96, 128, 144, 152, 192, 384, 512];

const htmlContent = `<!DOCTYPE html>
<html>
<head>
    <title>Generate Icons</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        .icon { margin: 10px; display: inline-block; text-align: center; }
        canvas { border: 1px solid #ccc; }
    </style>
</head>
<body>
    <h1>Elite Admin Panel - Icon Generator</h1>
    <p>This page will generate all required PWA icons. Right-click each canvas and "Save image as..." with the filename shown.</p>
    
    <div id="icons"></div>
    
    <script>
        const sizes = ${JSON.stringify(iconSizes)};
        const iconsContainer = document.getElementById('icons');
        
        sizes.forEach(size => {
            const div = document.createElement('div');
            div.className = 'icon';
            
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            
            // Create gradient
            const gradient = ctx.createLinearGradient(0, 0, size, size);
            gradient.addColorStop(0, '#FCA311');
            gradient.addColorStop(1, '#14213D');
            
            // Draw rounded rectangle
            const radius = size * 0.15;
            ctx.fillStyle = gradient;
            ctx.beginPath();
            ctx.roundRect(0, 0, size, size, radius);
            ctx.fill();
            
            // Add text
            ctx.fillStyle = 'white';
            ctx.font = \`bold \${size * 0.15}px Arial\`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('EA', size/2, size/2);
            
            const label = document.createElement('p');
            label.textContent = \`icon-\${size}x\${size}.png\`;
            
            div.appendChild(label);
            div.appendChild(canvas);
            iconsContainer.appendChild(div);
        });
    </script>
</body>
</html>`;

fs.writeFileSync(path.join(iconsDir, 'generate-icons.html'), htmlContent);

console.log('✅ Icon generator created at /public/icons/generate-icons.html');
console.log('📝 To generate icons:');
console.log('   1. Start your server');
console.log('   2. Visit http://localhost:3000/generate-icons');
console.log('   3. Right-click each canvas and save as the filename shown');
console.log('   4. Save all icons in the /public/icons/ directory');
