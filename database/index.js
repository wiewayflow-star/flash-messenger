/**
 * Flash Database Module
 * Isolated, secure account storage
 * 
 * Features:
 * - Password hashing (PBKDF2 with SHA-512)
 * - Email encryption (AES-256-GCM)
 * - Rate limiting (brute force protection)
 * - File-based persistent storage
 * 
 * SECURITY:
 * - Passwords CANNOT be recovered - only verified
 * - Emails are encrypted and can only be decrypted internally
 * - All sensitive data is hashed or encrypted before storage
 */

const Accounts = require('./accounts');
const Security = require('./security');
const RateLimiter = require('./rate-limiter');
const config = require('./config');

module.exports = {
    // Main account operations
    Accounts,
    
    // Security utilities (limited exposure)
    Security: {
        generateId: Security.generateId,
        generateToken: Security.generateToken,
        hashEmail: Security.hashEmail
    },
    
    // Rate limiting
    RateLimiter,
    
    // Configuration (read-only)
    config: {
        rateLimit: { ...config.rateLimit }
    },

    /**
     * Initialize database module
     */
    async init() {
        await Accounts.init();
        console.log('[Database] Module initialized');
    }
};
