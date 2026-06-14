require('dotenv').config();
const mongoose = require('mongoose');
const { Worker, Admin } = require('../models');

async function unlockAccounts() {
  console.log('--- Connecting to database... ---');
  // Connect to the local MongoDB instance (forwarded to localhost by Docker)
  const dbUri = 'mongodb://admin:password123@localhost:27017/gigshield?authSource=admin';
  
  try {
    await mongoose.connect(dbUri, { serverSelectionTimeoutMS: 3000 });
  } catch (err) {
    console.log(`Failed to connect to local DB at ${dbUri}. Trying env MONGODB_URI...`);
    if (!process.env.MONGODB_URI) {
      console.error('No MONGODB_URI env variable set. Exiting.');
      process.exit(1);
    }
    await mongoose.connect(process.env.MONGODB_URI);
  }
  console.log('Connected to MongoDB.');

  console.log('\n--- Resetting Lockouts... ---');
  
  // Unlock all workers
  const workerResult = await Worker.updateMany(
    { $or: [ { 'security.loginAttempts': { $gt: 0 } }, { 'security.lockUntil': { $exists: true } } ] },
    { 
      $set: { 
        'security.loginAttempts': 0 
      },
      $unset: {
        'security.lockUntil': ''
      }
    }
  );
  console.log(`Unlocked workers: matched ${workerResult.matchedCount}, modified ${workerResult.modifiedCount}`);

  // Unlock all admins
  const adminResult = await Admin.updateMany(
    { $or: [ { 'security.loginAttempts': { $gt: 0 } }, { 'security.lockUntil': { $exists: true } } ] },
    { 
      $set: { 
        'security.loginAttempts': 0 
      },
      $unset: {
        'security.lockUntil': ''
      }
    }
  );
  console.log(`Unlocked admins: matched ${adminResult.matchedCount}, modified ${adminResult.modifiedCount}`);

  console.log('\n--- Seeding/Syncing correct credentials... ---');
  const bcrypt = require('bcryptjs');
  
  // Reset demo worker password explicitly
  const workerEmail = 'worker@gigshield.com';
  const workerHash = await bcrypt.hash('applein12', 12);
  const workerUpdated = await Worker.updateOne(
    { 'personalInfo.email': workerEmail },
    { $set: { 'security.password': workerHash } }
  );
  console.log(`Worker password updated: matched ${workerUpdated.matchedCount}, modified ${workerUpdated.modifiedCount}`);

  // Reset demo admin password explicitly
  const adminEmail = 'admin@gigshield.com';
  const adminHash = await bcrypt.hash('the34eye', 12);
  const adminUpdated = await Admin.updateOne(
    { 'personalInfo.email': adminEmail },
    { $set: { 'security.password': adminHash } }
  );
  console.log(`Admin password updated: matched ${adminUpdated.matchedCount}, modified ${adminUpdated.modifiedCount}`);

  console.log('\nAll accounts unlocked and passwords synchronized successfully!');
}

unlockAccounts()
  .then(async () => {
    await mongoose.disconnect();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error('Lockout reset failed:', err);
    try { await mongoose.disconnect(); } catch (_) {}
    process.exit(1);
  });
