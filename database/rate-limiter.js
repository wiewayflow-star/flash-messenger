/**
 * Flash Database Module - Rate Limiter
 * Brute force protection for authentication
 */

const config = require('./config');

const RateLimiter = {
    // Track failed attempts: ip/email -> { count, firstAttempt, blockedUntil }
    _attempts: new Map(),

    /**
     * Check if identifier is blocked
     * @param {string} identifier - IP or email hash
     * @returns {Object} - { blocked, remainingTime }
     */
    isBlocked(identifier) {
        const record = this._attempts.get(identifier);
        
        if (!record) {
            return { blocked: false, remainingTime: 0 };
        }

        // Check if block has expired
        if (record.blockedUntil && Date.now() < record.blockedUntil) {
            const remainingTime = Math.ceil((record.blockedUntil - Date.now()) / 1000);
            return { blocked: true, remainingTime };
        }

        // Check if window has expired - reset
        if (Date.now() - record.firstAttempt > config.rateLimit.windowMs) {
            this._attempts.delete(identifier);
            return { blocked: false, remainingTime: 0 };
        }

        return { blocked: false, remainingTime: 0 };
    },

    /**
     * Record failed attempt
     * @param {string} identifier - IP or email hash
     * @returns {Object} - { blocked, attemptsLeft, blockedFor }
     */
    recordFailure(identifier) {
        let record = this._attempts.get(identifier);

        if (!record) {
            record = {
                count: 0,
                firstAttempt: Date.now(),
                blockedUntil: null
            };
        }

        // Reset if window expired
        if (Date.now() - record.firstAttempt > config.rateLimit.windowMs) {
            record = {
                count: 0,
                firstAttempt: Date.now(),
                blockedUntil: null
            };
        }

        record.count++;

        // Check if should block
        if (record.count >= config.rateLimit.maxAttempts) {
            record.blockedUntil = Date.now() + config.rateLimit.blockDuration;
            this._attempts.set(identifier, record);

            const blockedFor = Math.ceil(config.rateLimit.blockDuration / 1000);
            console.log(`[RateLimiter] Blocked ${identifier} for ${blockedFor}s`);

            return {
                blocked: true,
                attemptsLeft: 0,
                blockedFor
            };
        }

        this._attempts.set(identifier, record);

        return {
            blocked: false,
            attemptsLeft: config.rateLimit.maxAttempts - record.count,
            blockedFor: 0
        };
    },

    /**
     * Clear record on successful login
     * @param {string} identifier - IP or email hash
     */
    clearRecord(identifier) {
        this._attempts.delete(identifier);
    },

    /**
     * Get remaining attempts
     * @param {string} identifier - IP or email hash
     */
    getRemainingAttempts(identifier) {
        const record = this._attempts.get(identifier);
        
        if (!record) {
            return config.rateLimit.maxAttempts;
        }

        // Reset if window expired
        if (Date.now() - record.firstAttempt > config.rateLimit.windowMs) {
            return config.rateLimit.maxAttempts;
        }

        return Math.max(0, config.rateLimit.maxAttempts - record.count);
    },

    /**
     * Cleanup old records (call periodically)
     */
    cleanup() {
        const now = Date.now();
        const maxAge = config.rateLimit.windowMs + config.rateLimit.blockDuration;

        for (const [identifier, record] of this._attempts.entries()) {
            if (now - record.firstAttempt > maxAge) {
                this._attempts.delete(identifier);
            }
        }
    }
};

// Cleanup every 5 minutes
setInterval(() => RateLimiter.cleanup(), 5 * 60 * 1000);

module.exports = RateLimiter;
