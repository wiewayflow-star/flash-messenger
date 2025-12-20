/**
 * Flash Database Module - Accounts Service
 * Main service layer for account management
 * 
 * All passwords are hashed - CANNOT be recovered
 * All emails are encrypted for privacy
 */

const Security = require('./security');
const Storage = require('./storage');
const config = require('./config');

const Accounts = {
    _initialized: false,

    /**
     * Initialize accounts service
     */
    async init() {
        if (this._initialized) return;
        await Storage.init();
        this._initialized = true;
        console.log('[Database] Accounts service initialized');
    },

    /**
     * Register new account
     * @param {string} email - User email (will be encrypted)
     * @param {string} username - Display name
     * @param {string} password - Plain password (will be hashed)
     * @returns {Object} - Account data (without sensitive info)
     */
    async register(email, username, password) {
        await this.init();

        // Validate inputs
        if (!email || !username || !password) {
            throw new Error('Заполните все поля');
        }

        if (password.length < 6) {
            throw new Error('Пароль минимум 6 символов');
        }

        if (username.length < 2) {
            throw new Error('Имя минимум 2 символа');
        }

        // Check if email already exists
        const emailHash = Security.hashEmail(email);
        if (await Storage.exists(emailHash)) {
            throw new Error('Email уже зарегистрирован');
        }

        // Create secure account data
        const accountId = Security.generateId();
        const passwordHash = await Security.hashPassword(password);
        const encryptedEmail = Security.encryptEmail(email);

        const account = {
            id: accountId,
            emailHash,           // For lookups (one-way hash)
            encryptedEmail,      // For recovery (encrypted)
            passwordHash,        // Secure hash (cannot be reversed)
            username,
            tag: null,           // Will be set by server
            avatar: null,
            banner: null,
            bio: null,
            status: 'online',
            customStatus: null,
            publicKey: null,     // E2EE public key
            createdAt: new Date().toISOString()
        };

        await Storage.create(account);

        console.log(`[Database] Account created: ${username}`);

        // Return safe data (no hashes or encrypted data)
        return {
            id: account.id,
            username: account.username,
            createdAt: account.createdAt
        };
    },

    /**
     * Authenticate user
     * @param {string} email - User email
     * @param {string} password - Plain password
     * @returns {Object} - Account data if valid
     */
    async login(email, password) {
        await this.init();

        if (!email || !password) {
            throw new Error('Заполните все поля');
        }

        // Find account by email hash
        const emailHash = Security.hashEmail(email);
        const account = await Storage.findByEmailHash(emailHash);

        if (!account) {
            // Use same error to prevent email enumeration
            throw new Error('Неверный email или пароль');
        }

        // Verify password
        const isValid = await Security.verifyPassword(password, account.passwordHash);

        if (!isValid) {
            throw new Error('Неверный email или пароль');
        }

        console.log(`[Database] Login successful: ${account.username}`);

        // Return safe data
        return {
            id: account.id,
            username: account.username,
            tag: account.tag,
            avatar: account.avatar,
            banner: account.banner,
            bio: account.bio,
            status: account.status,
            publicKey: account.publicKey,
            createdAt: account.createdAt
        };
    },

    /**
     * Check if email is registered
     * @param {string} email - User email
     * @returns {boolean}
     */
    async emailExists(email) {
        await this.init();
        const emailHash = Security.hashEmail(email);
        return await Storage.exists(emailHash);
    },

    /**
     * Get account by ID (safe data only)
     * @param {string} id - Account ID
     * @returns {Object|null}
     */
    async getById(id) {
        await this.init();
        const account = await Storage.findById(id);
        
        if (!account) return null;

        return {
            id: account.id,
            username: account.username,
            tag: account.tag,
            avatar: account.avatar,
            banner: account.banner,
            bio: account.bio,
            status: account.status,
            publicKey: account.publicKey,
            createdAt: account.createdAt
        };
    },

    /**
     * Update account data
     * @param {string} id - Account ID
     * @param {Object} updates - Fields to update
     */
    async update(id, updates) {
        await this.init();

        // Filter allowed updates (no direct password/email changes)
        const allowedFields = ['username', 'tag', 'avatar', 'banner', 'bio', 'status', 'customStatus', 'publicKey'];
        const safeUpdates = {};

        for (const field of allowedFields) {
            if (updates[field] !== undefined) {
                safeUpdates[field] = updates[field];
            }
        }

        return await Storage.update(id, safeUpdates);
    },

    /**
     * Change password
     * @param {string} id - Account ID
     * @param {string} currentPassword - Current password
     * @param {string} newPassword - New password
     */
    async changePassword(id, currentPassword, newPassword) {
        await this.init();

        const account = await Storage.findById(id);
        if (!account) {
            throw new Error('Аккаунт не найден');
        }

        // Verify current password
        const isValid = await Security.verifyPassword(currentPassword, account.passwordHash);
        if (!isValid) {
            throw new Error('Неверный текущий пароль');
        }

        if (newPassword.length < 6) {
            throw new Error('Новый пароль минимум 6 символов');
        }

        // Hash new password
        const newPasswordHash = await Security.hashPassword(newPassword);
        await Storage.update(id, { passwordHash: newPasswordHash });

        console.log(`[Database] Password changed for account: ${id}`);
        return true;
    },

    /**
     * Get total accounts count
     */
    async count() {
        await this.init();
        return await Storage.count();
    }
};

module.exports = Accounts;
