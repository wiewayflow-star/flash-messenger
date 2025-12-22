/**
 * Flash Authentication
 */
const Auth = {
    init() {
        this.bindEvents();
        this.checkAuth();
    },

    // Generate unique visitor ID based on browser fingerprint
    getVisitorId() {
        let visitorId = Utils.storage.get('flash_visitor_id');
        if (!visitorId) {
            // Generate a unique ID based on browser characteristics
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            ctx.textBaseline = 'top';
            ctx.font = '14px Arial';
            ctx.fillText('Flash', 2, 2);
            const canvasData = canvas.toDataURL();
            
            const data = [
                navigator.userAgent,
                navigator.language,
                screen.width + 'x' + screen.height,
                new Date().getTimezoneOffset(),
                canvasData.slice(-50)
            ].join('|');
            
            // Simple hash
            let hash = 0;
            for (let i = 0; i < data.length; i++) {
                const char = data.charCodeAt(i);
                hash = ((hash << 5) - hash) + char;
                hash = hash & hash;
            }
            visitorId = 'v_' + Math.abs(hash).toString(36) + '_' + Date.now().toString(36);
            Utils.storage.set('flash_visitor_id', visitorId);
        }
        return visitorId;
    },

    bindEvents() {
        // Tab switching
        Utils.$$('.auth-tab').forEach(tab => {
            tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
        });

        // Login form
        Utils.$('#login-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.login(e.target);
        });

        // Register form
        Utils.$('#register-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.register(e.target);
        });
    },

    switchTab(tab) {
        Utils.$$('.auth-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
        Utils.$$('.auth-form').forEach(f => f.classList.toggle('active', f.id === `${tab}-form`));
        this.hideError();
    },

    async checkAuth() {
        // First try token-based auth (faster)
        if (Store.state.token) {
            try {
                const { user } = await API.auth.me();
                Store.setUser(user, Store.state.token);
                this.onAuthSuccess();
                return;
            } catch (error) {
                Store.clearUser();
            }
        }
        
        // Then try auto-login by device (only if no token)
        const visitorId = this.getVisitorId();
        
        try {
            const { user, token } = await API.auth.autoLogin(visitorId);
            Store.setUser(user, token);
            this.onAuthSuccess();
            console.log('[Auth] Автоматический вход успешен');
        } catch (e) {
            // Auto-login failed - that's OK, user will login manually
            console.log('[Auth] Автовход не удался, требуется ручной вход');
        }
    },

    async login(form) {
        const email = form.email.value;
        const password = form.password.value;
        const visitorId = this.getVisitorId();

        try {
            const { user, token } = await API.auth.login(email, password, visitorId);
            Store.setUser(user, token);
            this.onAuthSuccess();
        } catch (error) {
            this.showError(error.message);
        }
    },

    async register(form) {
        const email = form.email.value;
        const username = form.username.value;
        const password = form.password.value;

        try {
            const { user, token } = await API.auth.register(email, username, password);
            Store.setUser(user, token);
            this.onAuthSuccess();
        } catch (error) {
            this.showError(error.message);
        }
    },

    async logout() {
        try {
            await API.auth.logout();
        } catch (e) {
            // Ignore
        }
        
        // Clear visitor ID to require re-login
        Utils.storage.remove('flash_visitor_id');
        
        Store.clearUser();
        WS.disconnect();
        
        // Clear crypto keys on logout
        if (window.FlashCrypto) {
            FlashCrypto.clearKeys();
        }
        
        Utils.$('#auth-screen').classList.add('active');
        Utils.$('#main-screen').classList.remove('active');
    },

    async onAuthSuccess() {
        Utils.$('#auth-screen').classList.remove('active');
        Utils.$('#main-screen').classList.add('active');
        
        // Initialize E2EE crypto system
        if (window.FlashCrypto) {
            await FlashCrypto.init();
            const publicKey = await FlashCrypto.exportPublicKey();
            if (publicKey) {
                // Send public key to server
                try {
                    await API.users.updatePublicKey(publicKey);
                } catch (e) {
                    console.error('[Auth] Failed to upload public key');
                }
            }
        }
        
        WS.connect();
        App.init();
        
        // Initialize Voice system
        if (window.Voice) {
            Voice.init();
        }
    },

    showError(message) {
        const el = Utils.$('#auth-error');
        el.textContent = message;
        el.classList.add('show');
    },

    hideError() {
        Utils.$('#auth-error').classList.remove('show');
    }
};

// Initialize auth
document.addEventListener('DOMContentLoaded', () => Auth.init());
