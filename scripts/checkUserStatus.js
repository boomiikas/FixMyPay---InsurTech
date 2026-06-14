const mongoose = require('mongoose');
const { Worker, Admin } = require('../models');

async function checkStatus() {
  const dbUri = 'mongodb://admin:password123@localhost:27017/gigshield?authSource=admin';
  await mongoose.connect(dbUri);

  const worker = await Worker.findOne({ 'personalInfo.email': 'worker@gigshield.com' });
  console.log('\n=== WORKER STATUS ===');
  if (worker) {
    console.log(`Email:          ${worker.personalInfo.email}`);
    console.log(`Account Status: ${worker.status.accountStatus}`);
    console.log(`Sub Status:     ${worker.status.subscriptionStatus}`);
    console.log(`Login Attempts: ${worker.security.loginAttempts}`);
    console.log(`Lock Until:     ${worker.security.lockUntil}`);
    console.log(`Locked Now:     ${!!(worker.security.lockUntil && worker.security.lockUntil > Date.now())}`);
  } else {
    console.log('Worker not found!');
  }

  const admin = await Admin.findOne({ 'personalInfo.email': 'admin@gigshield.com' });
  console.log('\n=== ADMIN STATUS ===');
  if (admin) {
    console.log(`Email:          ${admin.personalInfo.email}`);
    console.log(`Is Active:      ${admin.status.isActive}`);
    console.log(`Login Attempts: ${admin.security.loginAttempts}`);
    console.log(`Lock Until:     ${admin.security.lockUntil}`);
    console.log(`Locked Now:     ${!!(admin.security.lockUntil && admin.security.lockUntil > Date.now())}`);
  } else {
    console.log('Admin not found!');
  }
}

checkStatus().then(() => mongoose.disconnect());
