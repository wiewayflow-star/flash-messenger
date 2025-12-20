/**
 * Flash Database Module - Configuration
 * Isolated database configuration
 */

module.exports = {
    // Storage settings
    storage: {
        accountsFile: 'accounts.dat',
        backupEnabled: true,
        backupInterval: 3600000 // 1 hour
    },
    
    // Security settings (implementation details hidden)
    security: {
        iterations: 100000,
        keyLength: 64,
        digest: 'sha512',
        saltLength: 32
    },
    
    // Rate limiting for brute force protection
    rateLimit: {
        maxAttempts: 5,
        windowMs: 900000, // 15 minutes
        blockDuration: 1800000 // 30 minutes
    },
    
    // MySQL connection (if used)
    mysql: {
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'flash_db'
    }
};
