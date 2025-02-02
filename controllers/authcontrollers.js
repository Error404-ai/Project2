const jwt = require('jsonwebtoken');
const sendEmail = require('../utils/sendemail');
const validator = require('validator');
const bcrypt = require('bcrypt');
const OTP = require('../models/otp');
const User = require('../models/User'); 

// Generate Access & Refresh Tokens
const generateTokens = (userId, email) => {
    const accessToken = jwt.sign(
        { userId, email },
        process.env.JWT_SECRET,
        { expiresIn: '15m' }
    );

    const refreshToken = jwt.sign(
        { userId },
        process.env.REFRESH_TOKEN_SECRET,
        { expiresIn: '7d' }
    );
    
    return { accessToken, refreshToken };
};

// Store Refresh Token
const storeRefreshToken = async (userId, refreshToken) => {
    await User.findByIdAndUpdate(userId, { refreshToken });
};

// Signup API
exports.signup = async (req, res) => {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
        return res.status(400).json({ message: 'Name, email, and password are required' });
    }

    if (!validator.isEmail(email)) {
        return res.status(400).json({ message: 'Invalid email format' });
    }

    try {
        const existingUser = await User.findOne({ email: email.toLowerCase() });

        if (existingUser) {
            return res.status(400).json({ message: 'User already exists. Please login or verify OTP.' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const newUser = new User({ name, email, password: hashedPassword, isVerified: false });
        await newUser.save();

        const otp = Math.floor(100000 + Math.random() * 900000).toString();
        await OTP.findOneAndUpdate({ email }, { otp, expiresAt: new Date(Date.now() + 30 * 60 * 1000) }, { upsert: true });

        await sendEmail(email, `Your OTP: ${otp}`, 'Email Verification');
        res.status(200).json({ message: 'User created. Please verify your email with OTP.' });
    } catch (error) {
        res.status(500).json({ message: 'Failed to create user', error: error.message });
    }
};

// Verify OTP API (Modified to not require email in req.body)
exports.verifyOTP = async (req, res) => {
    const { token, otp } = req.body;

    if (!token || !otp) {
        return res.status(400).json({ message: 'Token and OTP are required' });
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        const email = decoded.email;

        const otpRecord = await OTP.findOne({ email });
        if (!otpRecord || otpRecord.otp !== otp) {
            return res.status(400).json({ message: 'Invalid or expired OTP' });
        }

        const user = await User.findOneAndUpdate({ email }, { isVerified: true }, { new: true });
        const { accessToken, refreshToken } = generateTokens(user._id, user.email);
        await storeRefreshToken(user._id, refreshToken);

        await OTP.deleteOne({ email });
        res.status(200).json({ message: 'OTP verified successfully', accessToken, refreshToken });
    } catch (error) {
        res.status(500).json({ message: 'Error verifying OTP', error: error.message });
    }
};

// Login API
exports.login = async (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        return res.status(400).json({ message: 'Email and password are required' });
    }

    try {
        const user = await User.findOne({ email });
        if (!user || !(await bcrypt.compare(password, user.password))) {
            return res.status(400).json({ message: 'Invalid credentials' });
        }

        if (!user.isVerified) {
            return res.status(401).json({ message: 'Email not verified. Please verify first.' });
        }

        const { accessToken, refreshToken } = generateTokens(user._id, user.email);
        await storeRefreshToken(user._id, refreshToken);

        res.status(200).json({ message: 'Login successful', accessToken, refreshToken });
    } catch (error) {
        res.status(500).json({ message: 'Server error', error: error.message });
    }
};

// Refresh Token API
exports.refreshToken = async (req, res) => {
    const { refreshToken } = req.body;

    if (!refreshToken) {
        return res.status(400).json({ message: 'Refresh token is required' });
    }

    try {
        const decoded = jwt.verify(refreshToken, process.env.REFRESH_TOKEN_SECRET);
        const user = await User.findById(decoded.userId);

        if (!user || user.refreshToken !== refreshToken) {
            return res.status(403).json({ message: 'Invalid refresh token' });
        }

        const { accessToken, refreshToken: newRefreshToken } = generateTokens(user._id, user.email);
        await storeRefreshToken(user._id, newRefreshToken);

        res.status(200).json({ accessToken, refreshToken: newRefreshToken });
    } catch (error) {
        res.status(403).json({ message: 'Invalid refresh token', error: error.message });
    }
};
