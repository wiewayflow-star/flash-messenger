/**
 * Flash Authentication
 */
const Auth = {
    init() {
        this.bindEvents();
        this.checkAuth();
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
        if (!Store.state.token) return;

        try {
            const { user } = await API.auth.me();
            Store.setUser(user, Store.state.token);
            this.onAuthSuccess();
        } catch (error) {
            Store.clearUser();
        }
    },

    async login(form) {
        const email = form.email.value;
        const password = form.password.value;

        try {
            const { user, token } = await API.auth.login(email, password);
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
