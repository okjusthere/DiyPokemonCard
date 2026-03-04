require('dotenv').config();

const { createApp } = require('./app');

const PORT = process.env.PORT || 3000;
const app = createApp();

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\nDIY Pokemon Card Maker running on port ${PORT}`);
  });
}

module.exports = app;
