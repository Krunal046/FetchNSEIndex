const express = require('express');
const axios = require('axios');
const cheerio = require('cheerio');
const admin = require('firebase-admin');
const os = require('os');
const cluster = require('cluster');

// Firebase Admin initialization
const serviceAccount = require('./fir-e27d0-firebase-adminsdk-893r8-1e18d90645.json'); // Ensure this path is correct

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://fir-e27d0-default-rtdb.asia-southeast1.firebasedatabase.app/'
});

const db = admin.database();
const app = express();
const PORT = process.env.PORT || 3000; // Use the PORT environment variable provided by Render or default to 3000

// Serve static files from the 'public' folder
app.use(express.static('public'));

const indices = [
  'NIFTY_50',
  'NIFTY_BANK',
  'NIFTY_NEXT_50',
  'NIFTY_100',
  'NIFTY_200',
  'NIFTY_500',
  'NIFTY_MIDCAP_50',
  'INDIA_VIX'
];

let currentIndex = 0;

// Function to fetch and store data for a specific index
const fetchDataForIndex = async (index) => {
  const url = `https://www.google.com/finance/quote/${index}:INDEXNSE?hl=en`;

  try {
    const response = await axios.get(url);
    const html = response.data;
    const $ = cheerio.load(html);

    const divText = $("div.YMlKec.fxKbKc").text();

    if (divText) {
      console.log(`${index}: ${divText}`);

      const data = {
        LivePrice: divText,
        TTS: false,
        alarm: "",
        oldPrice: ""
      };

      const indexName = index.replace('_', ' ');
      await db.ref(`indices/${indexName}`).set(data);
    } else {
      console.log(`${index}: Div with the specified class not found.`);
    }
  } catch (error) {
    console.error(`Error fetching the webpage for ${index}: ${error}`);
  }
};

// Function to start fetching data for each index
const startFetching = () => {
  if (currentIndex >= indices.length) {
    currentIndex = 0;
  }

  const index = indices[currentIndex];
  fetchDataForIndex(index);

  currentIndex++;
};

let fetchInterval;

// Route to handle the root URL
app.get('/', (req, res) => {
  res.send('Welcome to the Financial Indices Fetcher! Use /start-fetching to begin and /stop-fetching to stop.');
});

// Route to start fetching data
app.get('/start-fetching', (req, res) => {
  if (!fetchInterval) {
    fetchInterval = setInterval(startFetching, 1000);
    res.send('Started fetching data.');
  } else {
    res.send('Fetching data is already running.');
  }
});

// Route to stop fetching data
app.get('/stop-fetching', (req, res) => {
  if (fetchInterval) {
    clearInterval(fetchInterval);
    fetchInterval = null;
    res.send('Stopped fetching data.');
  } else {
    res.send('Fetching data is not running.');
  }
});

// Auto-refresh logic
let autoRefreshInterval;

const autoRefresh = () => {
  autoRefreshInterval = setInterval(async () => {
    try {
      if (!fetchInterval) {
        await axios.get(`http://localhost:${PORT}/start-fetching`);
        console.log('Automatically restarted fetching data.');
      }
    } catch (error) {
      console.error('Error auto-refreshing the fetch process:', error.message);
    }
  }, 600000); // 10 minutes
};

// Start the auto-refresh function
autoRefresh();

// Cluster setup to handle multiple worker processes if needed
if (cluster.isMaster) {
  const numWorkers = os.cpus().length;
  console.log(`Master process is running with PID: ${process.pid}`);
  console.log(`Forking ${numWorkers} workers...`);

  for (let i = 0; i < numWorkers; i++) {
    cluster.fork();
  }

  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} exited with code: ${code}, signal: ${signal}`);
    console.log('Starting a new worker...');
    cluster.fork(); // Start a new worker if one exits
  });
} else {
  // Worker processes have their own server
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Worker ${process.pid} running on port ${PORT}`);
  });

  // Increase server timeout settings
  server.keepAliveTimeout = 120000; // 120 seconds
  server.headersTimeout = 120000; // 120 seconds
}
