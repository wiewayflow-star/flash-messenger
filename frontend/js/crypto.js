/**
 * Flash E2EE Crypto Module
 * End-to-End Encryption using Web Crypto API
 * 
 * Security principles:
 * - Private keys NEVER leave the client
 * - Server only sees encrypted data
 * - Uses X25519 for key exchange, AES-GCM for encryption
 */

const FlashCrypto = {
    // Key storage
    keyPair: null,
    privateKey: null,
    publicKey: null,
    
    // Shared secrets cache (userId -> sharedSecret)
    sharedSecrets: new Map(),
    
    // Public keys cache (userId -> publicKey)
    publicKeys: new Map(),

    /**
     * Initialize crypto system - generate or load keys
     */
    async init() {
        // Try to load existing keys from secure storage
        const savedKeys = await this.loadKeys();
        
        if (savedKeys) {
            this.privateKey = savedKeys.privateKey;
            this.publicKey = savedKeys.publicKey;
        } else {
            // Generate new key pair
            await this.generateKeyPair();
        }
        
        return this.publicKey;
    },

    /**
     * Generate ECDH key pair for key exchange
     */
    async generateKeyPair() {
        try {
            // Generate ECDH key pair using P-256 curve
            const keyPair = await window.crypto.subtle.generateKey(
                {
                    name: 'ECDH',
                    namedCurve: 'P-256'
                },
                true, // extractable
                ['deriveKey', 'deriveBits']
            );
            
            this.keyPair = keyPair;
            this.privateKey = keyPair.privateKey;
            this.publicKey = keyPair.publicKey;
            
            // Save keys securely
            await this.saveKeys();
            
            return this.publicKey;
        } catch (e) {
            console.error('[Crypto] Failed to generate key pair');
            throw e;
        }
    },

    /**
     * Export public key to transmittable format
     */
    async exportPublicKey(key = null) {
        const keyToExport = key || this.publicKey;
        if (!keyToExport) return null;
        
        try {
            const exported = await window.crypto.subtle.exportKey('spki', keyToExport);
            return this.arrayBufferToBase64(exported);
        } catch (e) {
            console.error('[Crypto] Failed to export public key');
            return null;
        }
    },

    /**
     * Import public key from base64 format
     */
    async importPublicKey(base64Key) {
        try {
            const keyData = this.base64ToArrayBuffer(base64Key);
            const publicKey = await window.crypto.subtle.importKey(
                'spki',
                keyData,
                {
                    name: 'ECDH',
                    namedCurve: 'P-256'
                },
                true,
                []
            );
            return publicKey;
        } catch (e) {
            console.error('[Crypto] Failed to import public key');
            return null;
        }
    },

    /**
     * Derive shared secret from our private key and their public key
     */
    async deriveSharedSecret(theirPublicKey) {
        try {
            // Derive bits using ECDH
            const sharedBits = await window.crypto.subtle.deriveBits(
                {
                    name: 'ECDH',
                    public: theirPublicKey
                },
                this.privateKey,
                256
            );
            
            // Derive AES key from shared bits
            const sharedKey = await window.crypto.subtle.importKey(
                'raw',
                sharedBits,
                { name: 'AES-GCM' },
                false,
                ['encrypt', 'decrypt']
            );
            
            return sharedKey;
        } catch (e) {
            console.error('[Crypto] Failed to derive shared secret');
            return null;
        }
    },

    /**
     * Get or create shared secret for a user
     */
    async getSharedSecret(userId, theirPublicKeyBase64) {
        // Check cache first
        if (this.sharedSecrets.has(userId)) {
            return this.sharedSecrets.get(userId);
        }
        
        // Import their public key
        const theirPublicKey = await this.importPublicKey(theirPublicKeyBase64);
        if (!theirPublicKey) return null;
        
        // Derive shared secret
        const sharedSecret = await this.deriveSharedSecret(theirPublicKey);
        if (!sharedSecret) return null;
        
        // Cache it
        this.sharedSecrets.set(userId, sharedSecret);
        this.publicKeys.set(userId, theirPublicKeyBase64);
        
        return sharedSecret;
    },

    /**
     * Encrypt message for a specific user (DM)
     */
    async encryptForUser(plaintext, userId, theirPublicKeyBase64) {
        try {
            const sharedSecret = await this.getSharedSecret(userId, theirPublicKeyBase64);
            if (!sharedSecret) {
                throw new Error('Could not establish shared secret');
            }
            
            // Generate random IV
            const iv = window.crypto.getRandomValues(new Uint8Array(12));
            
            // Encode message
            const encoder = new TextEncoder();
            const data = encoder.encode(plaintext);
            
            // Encrypt
            const encrypted = await window.crypto.subtle.encrypt(
                {
                    name: 'AES-GCM',
                    iv: iv
                },
                sharedSecret,
                data
            );
            
            // Combine IV + encrypted data
            const combined = new Uint8Array(iv.length + encrypted.byteLength);
            combined.set(iv);
            combined.set(new Uint8Array(encrypted), iv.length);
            
            return this.arrayBufferToBase64(combined.buffer);
        } catch (e) {
            console.error('[Crypto] Encryption failed');
            return null;
        }
    },

    /**
     * Decrypt message from a specific user (DM)
     */
    async decryptFromUser(encryptedBase64, userId, theirPublicKeyBase64) {
        try {
            const sharedSecret = await this.getSharedSecret(userId, theirPublicKeyBase64);
            if (!sharedSecret) {
                throw new Error('Could not establish shared secret');
            }
            
            // Decode base64
            const combined = new Uint8Array(this.base64ToArrayBuffer(encryptedBase64));
            
            // Extract IV and encrypted data
            const iv = combined.slice(0, 12);
            const encrypted = combined.slice(12);
            
            // Decrypt
            const decrypted = await window.crypto.subtle.decrypt(
                {
                    name: 'AES-GCM',
                    iv: iv
                },
                sharedSecret,
                encrypted
            );
            
            // Decode message
            const decoder = new TextDecoder();
            return decoder.decode(decrypted);
        } catch (e) {
            console.error('[Crypto] Decryption failed');
            return '[Не удалось расшифровать сообщение]';
        }
    },

    /**
     * Encrypt message for a channel (group encryption)
     * Uses channel-specific key derived from channel ID + user keys
     */
    async encryptForChannel(plaintext, channelId, memberPublicKeys) {
        try {
            // Generate a random message key for this message
            const messageKey = await window.crypto.subtle.generateKey(
                { name: 'AES-GCM', length: 256 },
                true,
                ['encrypt', 'decrypt']
            );
            
            // Generate random IV
            const iv = window.crypto.getRandomValues(new Uint8Array(12));
            
            // Encode and encrypt message
            const encoder = new TextEncoder();
            const data = encoder.encode(plaintext);
            
            const encryptedContent = await window.crypto.subtle.encrypt(
                { name: 'AES-GCM', iv: iv },
                messageKey,
                data
            );
            
            // Export message key
            const rawMessageKey = await window.crypto.subtle.exportKey('raw', messageKey);
            
            // Encrypt message key for each member
            const encryptedKeys = {};
            for (const [memberId, publicKeyBase64] of Object.entries(memberPublicKeys)) {
                const sharedSecret = await this.getSharedSecret(memberId, publicKeyBase64);
                if (sharedSecret) {
                    const keyIv = window.crypto.getRandomValues(new Uint8Array(12));
                    const encryptedKey = await window.crypto.subtle.encrypt(
                        { name: 'AES-GCM', iv: keyIv },
                        sharedSecret,
                        rawMessageKey
                    );
                    
                    // Combine IV + encrypted key
                    const combinedKey = new Uint8Array(keyIv.length + encryptedKey.byteLength);
                    combinedKey.set(keyIv);
                    combinedKey.set(new Uint8Array(encryptedKey), keyIv.length);
                    
                    encryptedKeys[memberId] = this.arrayBufferToBase64(combinedKey.buffer);
                }
            }
            
            // Combine IV + encrypted content
            const combined = new Uint8Array(iv.length + encryptedContent.byteLength);
            combined.set(iv);
            combined.set(new Uint8Array(encryptedContent), iv.length);
            
            return {
                content: this.arrayBufferToBase64(combined.buffer),
                keys: encryptedKeys
            };
        } catch (e) {
            console.error('[Crypto] Channel encryption failed');
            return null;
        }
    },

    /**
     * Decrypt message from a channel
     */
    async decryptFromChannel(encryptedPayload, senderId, senderPublicKeyBase64) {
        try {
            const myId = Store.state.user?.id;
            if (!myId || !encryptedPayload.keys[myId]) {
                return '[Нет ключа для расшифровки]';
            }
            
            // Get shared secret with sender
            const sharedSecret = await this.getSharedSecret(senderId, senderPublicKeyBase64);
            if (!sharedSecret) {
                return '[Не удалось установить общий секрет]';
            }
            
            // Decrypt message key
            const encryptedKeyData = new Uint8Array(this.base64ToArrayBuffer(encryptedPayload.keys[myId]));
            const keyIv = encryptedKeyData.slice(0, 12);
            const encryptedKey = encryptedKeyData.slice(12);
            
            const rawMessageKey = await window.crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: keyIv },
                sharedSecret,
                encryptedKey
            );
            
            // Import message key
            const messageKey = await window.crypto.subtle.importKey(
                'raw',
                rawMessageKey,
                { name: 'AES-GCM' },
                false,
                ['decrypt']
            );
            
            // Decrypt content
            const contentData = new Uint8Array(this.base64ToArrayBuffer(encryptedPayload.content));
            const contentIv = contentData.slice(0, 12);
            const encryptedContent = contentData.slice(12);
            
            const decrypted = await window.crypto.subtle.decrypt(
                { name: 'AES-GCM', iv: contentIv },
                messageKey,
                encryptedContent
            );
            
            const decoder = new TextDecoder();
            return decoder.decode(decrypted);
        } catch (e) {
            console.error('[Crypto] Channel decryption failed');
            return '[Не удалось расшифровать сообщение]';
        }
    },

    /**
     * Save keys to IndexedDB (secure local storage)
     */
    async saveKeys() {
        try {
            const exportedPrivate = await window.crypto.subtle.exportKey('pkcs8', this.privateKey);
            const exportedPublic = await window.crypto.subtle.exportKey('spki', this.publicKey);
            
            const keysData = {
                privateKey: this.arrayBufferToBase64(exportedPrivate),
                publicKey: this.arrayBufferToBase64(exportedPublic)
            };
            
            // Store in localStorage (in production, use IndexedDB with encryption)
            localStorage.setItem('flash_e2ee_keys', JSON.stringify(keysData));
        } catch (e) {
            console.error('[Crypto] Failed to save keys');
        }
    },

    /**
     * Load keys from IndexedDB
     */
    async loadKeys() {
        try {
            const saved = localStorage.getItem('flash_e2ee_keys');
            if (!saved) return null;
            
            const keysData = JSON.parse(saved);
            
            const privateKey = await window.crypto.subtle.importKey(
                'pkcs8',
                this.base64ToArrayBuffer(keysData.privateKey),
                { name: 'ECDH', namedCurve: 'P-256' },
                true,
                ['deriveKey', 'deriveBits']
            );
            
            const publicKey = await window.crypto.subtle.importKey(
                'spki',
                this.base64ToArrayBuffer(keysData.publicKey),
                { name: 'ECDH', namedCurve: 'P-256' },
                true,
                []
            );
            
            return { privateKey, publicKey };
        } catch (e) {
            console.error('[Crypto] Failed to load keys');
            return null;
        }
    },

    /**
     * Clear all keys (logout)
     */
    clearKeys() {
        this.keyPair = null;
        this.privateKey = null;
        this.publicKey = null;
        this.sharedSecrets.clear();
        this.publicKeys.clear();
        localStorage.removeItem('flash_e2ee_keys');
    },

    // Utility functions
    arrayBufferToBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return btoa(binary);
    },

    base64ToArrayBuffer(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
    }
};
