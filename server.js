const express = require('express');
const ffmpeg = require('fluent-ffmpeg');
const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
const path = require('path');
const { URL } = require('url');
const tmp = require('tmp');
const fs = require('fs');
const https = require('https');
const http = require('http');

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// CORS
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
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

// Download remote video to temp file
function downloadVideo(videoUrl) {
  return new Promise((resolve, reject) => {
    tmp.file({ postfix: '.mp4' }, (err, tmpPath, fd, cleanupCallback) => {
      if (err) return reject(err);

      const file = fs.createWriteStream(tmpPath);
      const client = videoUrl.startsWith('https') ? https : http;

      client.get(videoUrl, (response) => {
        if (response.statusCode !== 200) {
          cleanupCallback();
          return reject(new Error(`Failed to download video: ${response.statusCode}`));
        }

        response.pipe(file);
        file.on('finish', () => {
          file.close(() => resolve({ tmpPath, cleanupCallback }));
        });
      }).on('error', (err) => {
        cleanupCallback();
        reject(err);
      });
    });
  });
}

// Generate thumbnail from local video file
async function generateThumbnailBase64(videoUrl) {
  const { tmpPath, cleanupCallback } = await downloadVideo(videoUrl);
  const filename = getFilenameFromUrl(videoUrl);
  const chunks = [];

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanupCallback();
      reject({
        success: false,
        error: 'Thumbnail generation timeout',
        details: 'The process took too long to complete',
      });
    }, 25000);

    ffmpeg(tmpPath)
      .inputOptions('-ss 00:00:01.000')
      .outputOptions(['-frames:v 1', '-vf scale=320:-1', '-f image2pipe', '-vcodec mjpeg'])
      .format('mjpeg')
      .on('error', (err) => {
        clearTimeout(timeout);
        cleanupCallback();
        reject({
          success: false,
          error: 'FFmpeg failed',
          details: err.message,
        });
      })
      .on('end', () => {
        clearTimeout(timeout);
        cleanupCallback();
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

// Home page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// GET fallback for API
app.get('/api/thumbnail', (req, res) => {
  res.status(405).json({
    success: false,
    error: 'Method Not Allowed',
    message: 'Use POST with videoUrl in JSON body',
  });
});

// POST API to generate thumbnail
app.post('/api/thumbnail', async (req, res) => {
  const { videoUrl } = req.body;

  if (!videoUrl) {
    return res.status(400).json({
      success: false,
      error: 'videoUrl is required',
    });
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
