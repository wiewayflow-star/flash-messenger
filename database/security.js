/**
 * Flash Database Module - Security Layer
 * Handles all cryptographic operations
 * 
 * SECURITY: Implementation details are intentionally abstracted
 * Passwords are NEVER stored in plain text
 * Passwords CANNOT be recovered - only verified
 */

const crypto = require('crypto');
const config = require('./config');

const Security = {
    /**
     * Generate cryptographically secure random salt
     * @private
     */
    _generateSalt() {
        return crypto.randomBytes(config.security.saltLength).toString('hex');
    },

    /**
     * Derive key from password using secure algorithm
     * @private
     */
    _deriveKey(password, salt) {
        return new Promise((resolve, reject) => {
            crypto.pbkdf2(
                password,
                salt,
                config.security.iterations,
                config.security.keyLength,
                config.security.digest,
                (err, derivedKey) => {
                    if (err) reject(err);
                    else resolve(derivedKey.toString('hex'));
                }
            );
        });
    },

    /**
     * Hash password for storage
     * Returns format: salt:hash (both hex encoded)
     * Original password CANNOT be recovered
     */
    async hashPassword(password) {
        if (!password || typeof password !== 'string') {
            throw new Error('Invalid password');
        }
        
        const salt = this._generateSalt();
        const hash = await this._deriveKey(password, salt);
        
        // Return combined format - salt is needed for verification
        return `${salt}:${hash}`;
    },

    /**
     * Verify password against stored hash
     * Uses constant-time comparison to prevent timing attacks
     */
    async verifyPassword(password, storedHash) {
        if (!password || !storedHash) {
            return false;
        }
        
        try {
            const [salt, originalHash] = storedHash.split(':');
            if (!salt || !originalHash) {
                return false;
            }
            
            const hash = await this._deriveKey(password, salt);
            
            // Constant-time comparison to prevent timing attacks
            return crypto.timingSafeEqual(
                Buffer.from(hash, 'hex'),
                Buffer.from(originalHash, 'hex')
            );
        } catch (e) {
            return false;
        }
    },

    /**
     * Hash email for privacy (one-way)
     * Used for lookups without exposing actual email
     */
    hashEmail(email) {
        if (!email || typeof email !== 'string') {
            throw new Error('Invalid email');
        }
        
        const normalized = email.toLowerCase().trim();
        return crypto
            .createHash('sha256')
            .update(normalized + process.env.EMAIL_SALT || 'flash_email_salt')
            .digest('hex');
    },

    /**
     * Encrypt email for storage (reversible for account recovery)
     * Uses AES-256-GCM
     */
    encryptEmail(email) {
        if (!email || typeof email !== 'string') {
            throw new Error('Invalid email');
        }
        
        const key = crypto.scryptSync(
            process.env.EMAIL_KEY || 'flash_email_encryption_key',
            'flash_salt',
            32
        );
        
        const iv = crypto.randomBytes(16);
        const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
        
        let encrypted = cipher.update(email.toLowerCase().trim(), 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        const authTag = cipher.getAuthTag().toString('hex');
        
        // Format: iv:authTag:encrypted
        return `${iv.toString('hex')}:${authTag}:${encrypted}`;
    },

    /**
     * Decrypt email (for account recovery only)
     * @private - Should only be used internally
     */
    _decryptEmail(encryptedEmail) {
        try {
            const [ivHex, authTagHex, encrypted] = encryptedEmail.split(':');
            
            const key = crypto.scryptSync(
                process.env.EMAIL_KEY || 'flash_email_encryption_key',
                'flash_salt',
                32
            );
            
            const iv = Buffer.from(ivHex, 'hex');
            const authTag = Buffer.from(authTagHex, 'hex');
            const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
            decipher.setAuthTag(authTag);
            
            let decrypted = decipher.update(encrypted, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            
            return decrypted;
        } catch (e) {
            return null;
        }
    },

    /**
     * Generate secure random ID
     */
    generateId() {
        return crypto.randomUUID();
    },

    /**
     * Generate secure session token
     */
    generateToken() {
        return crypto.randomBytes(48).toString('hex');
    }
};

module.exports = Security;
