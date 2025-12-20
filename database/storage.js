/**
 * Flash Database Module - Storage Layer
 * Handles persistent storage of accounts
 * 
 * All data is stored in encrypted/hashed format
 * Direct file access is prohibited from outside this module
 */

const fs = require('fs');
const path = require('path');
const config = require('./config');

const STORAGE_PATH = path.join(__dirname, config.storage.accountsFile);

const Storage = {
    // In-memory cache (loaded from file)
    _accounts: new Map(),
    _initialized: false,

    /**
     * Initialize storage - load existing accounts
     */
    async init() {
        if (this._initialized) return;
        
        try {
            if (fs.existsSync(STORAGE_PATH)) {
                const data = fs.readFileSync(STORAGE_PATH, 'utf8');
                const accounts = JSON.parse(data);
                
                for (const account of accounts) {
                    this._accounts.set(account.emailHash, account);
                }
            }
            
            this._initialized = true;
            
            // Setup auto-backup if enabled
            if (config.storage.backupEnabled) {
                setInterval(() => this._backup(), config.storage.backupInterval);
            }
        } catch (e) {
            // Start fresh if file is corrupted
            this._accounts = new Map();
            this._initialized = true;
        }
    },

    /**
     * Save all accounts to file
     * @private
     */
    async _save() {
        try {
            const accounts = Array.from(this._accounts.values());
            fs.writeFileSync(STORAGE_PATH, JSON.stringify(accounts, null, 2));
        } catch (e) {
            console.error('[Storage] Failed to save accounts');
        }
    },

    /**
     * Create backup
     * @private
     */
    async _backup() {
        try {
            const backupPath = STORAGE_PATH + '.backup';
            if (fs.existsSync(STORAGE_PATH)) {
                fs.copyFileSync(STORAGE_PATH, backupPath);
            }
        } catch (e) {
            // Backup failed silently
        }
    },

    /**
     * Store new account
     * @param {Object} account - Account data (already secured)
     */
    async create(account) {
        if (!account.emailHash || !account.passwordHash) {
            throw new Error('Invalid account data');
        }
        
        if (this._accounts.has(account.emailHash)) {
            throw new Error('Account already exists');
        }
        
        this._accounts.set(account.emailHash, account);
        await this._save();
        
        return account.id;
    },

    /**
     * Find account by email hash
     * @param {string} emailHash - Hashed email
     */
    async findByEmailHash(emailHash) {
        return this._accounts.get(emailHash) || null;
    },

    /**
     * Find account by ID
     * @param {string} id - Account ID
     */
    async findById(id) {
        for (const account of this._accounts.values()) {
            if (account.id === id) {
                return account;
            }
        }
        return null;
    },

    /**
     * Update account
     * @param {string} id - Account ID
     * @param {Object} updates - Fields to update
     */
    async update(id, updates) {
        for (const [emailHash, account] of this._accounts.entries()) {
            if (account.id === id) {
                // Merge updates (don't allow changing critical fields)
                const updated = {
                    ...account,
                    ...updates,
                    id: account.id, // Preserve ID
                    emailHash: account.emailHash, // Preserve email hash
                    passwordHash: updates.passwordHash || account.passwordHash,
                    createdAt: account.createdAt // Preserve creation date
                };
                
                this._accounts.set(emailHash, updated);
                await this._save();
                return true;
            }
        }
        return false;
    },

    /**
     * Check if account exists
     * @param {string} emailHash - Hashed email
     */
    async exists(emailHash) {
        return this._accounts.has(emailHash);
    },

    /**
     * Get total account count (for stats only)
     */
    async count() {
        return this._accounts.size;
    }
};

module.exports = Storage;
