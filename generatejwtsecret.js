const crypto = require('crypto');

const jwtSecret = crypto.randomBytes(32).toString('hex');

console.log("Your JWT Secret:", jwtSecret);
