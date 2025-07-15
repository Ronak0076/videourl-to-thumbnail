const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const path = require('path');
const { URL } = require('url');

const app = express();
const PORT = process.env.PORT || 3000;

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// Utility to extract filename
function getFilenameFromUrl(videoUrl) {
  try {
    const parsedUrl = new URL(videoUrl);
    const filename = path.basename(parsedUrl.pathname);
    return path.parse(filename).name || 'thumbnail';
  } catch (error) {
    return 'thumbnail';
  }
}

// Generate thumbnail from video URL
function generateThumbnailBase64(videoUrl) {
  return new Promise((resolve, reject) => {
    const filename = getFilenameFromUrl(videoUrl);
    const chunks = [];

    const timeout = setTimeout(() => {
      reject({
        success: false,
        error: 'Thumbnail generation timeout',
        details: 'The process took too long to complete',
      });
    }, 25000);

    ffmpeg(videoUrl)
      .inputOptions('-ss 00:00:01.000')
      .outputOptions(['-frames:v 1', '-f image2pipe', '-vcodec mjpeg'])
      .format('mjpeg')
      .on('error', (err) => {
        clearTimeout(timeout);
        reject({
          success: false,
          error: 'Failed to generate thumbnail',
          details: err.message,
        });
      })
      .on('end', () => {
        clearTimeout(timeout);
        const buffer = Buffer.concat(chunks);
        const base64Image = buffer.toString('base64');
        resolve({
          success: true,
          filename,
          base64: `data:image/jpeg;base64,${base64Image}`,
          message: 'Thumbnail generated successfully',
        });
      })
      .pipe()
      .on('data', (chunk) => chunks.push(chunk));
  });
}

// UI route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// GET fallback for API
app.get('/api/thumbnail', (req, res) => {
  res.status(405).json({
    success: false,
    error: 'Method Not Allowed',
    message: 'Only POST method is allowed with videoUrl in JSON body.',
    usage: {
      method: 'POST',
      url: '/api/thumbnail',
      body: { videoUrl: 'https://example.com/video.mp4' },
    },
  });
});

// Thumbnail API
app.post('/api/thumbnail', async (req, res) => {
  const { videoUrl } = req.body;
  if (!videoUrl) {
    return res.status(400).json({ success: false, error: 'Video URL is required' });
  }

  try {
    const result = await generateThumbnailBase64(videoUrl);
    res.json(result);
  } catch (error) {
    res.status(500).json(error);
  }
});

app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
