const express = require('express');
const session = require('express-session');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { sessionStore } = require('../config/redis');

const authController = require('./controllers/authController');
const clientController = require('./controllers/clientController');
const { authenticateToken } = require('./middleware/auth');

const app = express();
//author: Tahsin MutoPey tahsin@mutevazip.com
// Middleware
app.use(helmet());
app.use(cors({
  origin: ['https://mutevazipeynircilik.com', 'https://portal.mutevazipeynircilik.com'],
  credentials: true
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(morgan('combined'));

// Session configuration
app.use(session({
  store: sessionStore,
  secret: '',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 24 // 24 hours
  }
}));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'customer-portal-api'
  });
});

// Routes
app.use('/api/auth', authController);
app.use('/api/clients', authenticateToken, clientController);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.path
  });
});

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Customer Portal API running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;