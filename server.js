const express = require('express');
const http = require('http');
const path = require('path');

const app = express();
const PORT = 811;
const WT_BASE_URL = 'http://127.0.0.1:8111';

// Serve static files from the 'public' directory (using absolute path for packaged Electron compatibility)
app.use(express.static(path.join(__dirname, 'public')));

// Route to check if War Thunder is running and reachable
app.get('/api/status', async (req, res) => {
  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 1000); // 1s timeout
    const response = await fetch(`${WT_BASE_URL}/state`, { signal: controller.signal });
    clearTimeout(id);
    if (response.ok) {
      return res.json({ status: 'connected' });
    }
  } catch (e) {
    // Ignore and return disconnected
  }
  res.json({ status: 'disconnected' });
});

// Proxy function to forward requests to localhost:8111
async function proxyToWT(req, res, path) {
  const queryString = req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
  const url = `${WT_BASE_URL}${path}${queryString}`;

  try {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 2000); // 2s timeout
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(id);

    if (!response.ok) {
      return res.status(response.status).json({ error: `WT client returned status ${response.status}` });
    }

    // Set content type header
    const contentType = response.headers.get('content-type');
    if (contentType) {
      res.setHeader('content-type', contentType);
    }

    // Send binary or text depending on endpoint
    if (path.endsWith('.img') || contentType?.includes('image')) {
      const buffer = Buffer.from(await response.arrayBuffer());
      return res.send(buffer);
    } else {
      const json = await response.json();
      return res.json(json);
    }
  } catch (error) {
    return res.status(503).json({
      error: 'War Thunder client unreachable',
      message: error.message,
      connected: false
    });
  }
}

// Map the proxy routes
app.get('/state', (req, res) => proxyToWT(req, res, '/state'));
app.get('/indicators', (req, res) => proxyToWT(req, res, '/indicators'));
app.get('/map_obj.json', (req, res) => proxyToWT(req, res, '/map_obj.json'));
app.get('/map_info.json', (req, res) => proxyToWT(req, res, '/map_info.json'));
app.get('/map.img', (req, res) => proxyToWT(req, res, '/map.img'));
app.get('/hudmsg', (req, res) => proxyToWT(req, res, '/hudmsg'));

const server = app.listen(PORT, () => {
  console.log(`===========================================================`);
  console.log(` War Thunder Tactical Map Wrapper is running!`);
  console.log(` Access it at: http://localhost:${PORT}`);
  console.log(` Querying War Thunder Client at: ${WT_BASE_URL}`);
  console.log(`===========================================================`);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`===========================================================`);
    console.warn(` [Warning] Port ${PORT} is already in use.`);
    console.warn(` Assuming another instance is already running.`);
    console.warn(` Electron will connect to the existing instance.`);
    console.warn(`===========================================================`);
  } else {
    console.error('Server error:', err);
    process.exit(1);
  }
});
