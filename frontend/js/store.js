/**
 * Flash State Store
 */
const Store = {
    state: {
        user: null,
        token: null,
        servers: [],
        currentServer: null,
        channels: [],
        currentChannel: null,
        messages: [],
        members: [],
        typingUsers: new Set(),
        voiceChannelUsers: new Map(), // channelId -> [users]
        voiceChannelStartTime: new Map(), // channelId -> timestamp (when first user joined)
        unreadDMs: new Map(), // oderId -> count of unread messages
        settings: {
            animations: true,
            glow: true,
            dynamicBg: true,
            flashMode: false
        }
    },

    // Initialize from localStorage
    init() {
        const token = Utils.storage.get('flash_token');
        const user = Utils.storage.get('flash_user');

        if (token) this.state.token = token;
        if (user) this.state.user = user;
        
        // FORCE animations ON - clear old broken settings
        Utils.storage.remove('flash_settings');
        this.state.settings = {
            animations: true,
            glow: true,
            dynamicBg: true,
            flashMode: false
        };

        this.applySettings();
    },

    // User
    setUser(user, token) {
        this.state.user = user;
        this.state.token = token;
        Utils.storage.set('flash_token', token);
        Utils.storage.set('flash_user', user);
    },

    clearUser() {
        this.state.user = null;
        this.state.token = null;
        Utils.storage.remove('flash_token');
        Utils.storage.remove('flash_user');
    },

    // Servers
    setServers(servers) {
        this.state.servers = servers;
    },

    addServer(server) {
        // Prevent duplicates
        if (!this.state.servers.find(s => s.id === server.id)) {
            this.state.servers.push(server);
        }
    },

    setCurrentServer(server) {
        this.state.currentServer = server;
    },

    // Channels
    setChannels(channels) {
        this.state.channels = channels;
    },

    addChannel(channel) {
        if (!this.state.channels.find(c => c.id === channel.id)) {
            this.state.channels.push(channel);
        }
    },

    removeChannel(channelId) {
        this.state.channels = this.state.channels.filter(c => c.id !== channelId);
    },

    setCurrentChannel(channel) {
        this.state.currentChannel = channel;
    },

    // Messages
    setMessages(messages) {
        this.state.messages = messages;
    },

    addMessage(message) {
        console.log('[Store] addMessage called with:', message);
        console.log('[Store] Current messages count:', this.state.messages.length);
        // Check if message already exists
        if (!this.state.messages.find(m => m.id === message.id)) {
            this.state.messages.push(message);
            console.log('[Store] Message added. New count:', this.state.messages.length);
        } else {
            console.log('[Store] Message already exists, skipping');
        }
    },

    removeMessage(messageId) {
        this.state.messages = this.state.messages.filter(m => m.id !== messageId);
    },

    removeMessage(messageId) {
        this.state.messages = this.state.messages.filter(m => m.id !== messageId);
    },

    // Unread DMs
    addUnreadDM(oderId) {
        const current = this.state.unreadDMs.get(oderId) || 0;
        this.state.unreadDMs.set(oderId, current + 1);
    },

    clearUnreadDM(oderId) {
        this.state.unreadDMs.delete(oderId);
    },

    getUnreadDM(oderId) {
        return this.state.unreadDMs.get(oderId) || 0;
    },

    // Members
    setMembers(members) {
        this.state.members = members;
    },

    addMember(member) {
        if (!this.state.members.find(m => m.id === member.id)) {
            this.state.members.push(member);
        }
    },

    removeMember(userId) {
        this.state.members = this.state.members.filter(m => m.id !== userId);
    },

    // Voice channel users
    setVoiceChannelUsers(channelId, users) {
        this.state.voiceChannelUsers.set(channelId, users);
        // Set start time if users exist and no start time yet
        if (users && users.length > 0 && !this.state.voiceChannelStartTime.has(channelId)) {
            this.state.voiceChannelStartTime.set(channelId, Date.now());
        } else if (!users || users.length === 0) {
            this.state.voiceChannelStartTime.delete(channelId);
        }
    },

    addVoiceChannelUser(channelId, user) {
        if (!this.state.voiceChannelUsers.has(channelId)) {
            this.state.voiceChannelUsers.set(channelId, []);
        }
        const users = this.state.voiceChannelUsers.get(channelId);
        if (!users.find(u => u.id === user.id)) {
            users.push(user);
            // Set start time if this is the first user
            if (users.length === 1) {
                this.state.voiceChannelStartTime.set(channelId, Date.now());
            }
        }
    },

    removeVoiceChannelUser(channelId, userId) {
        const users = this.state.voiceChannelUsers.get(channelId);
        if (users) {
            const filtered = users.filter(u => u.id !== userId);
            if (filtered.length === 0) {
                this.state.voiceChannelUsers.delete(channelId);
                this.state.voiceChannelStartTime.delete(channelId);
            } else {
                this.state.voiceChannelUsers.set(channelId, filtered);
            }
        }
    },

    getVoiceChannelUsers(channelId) {
        return this.state.voiceChannelUsers.get(channelId) || [];
    },

    getVoiceChannelStartTime(channelId) {
        return this.state.voiceChannelStartTime.get(channelId) || null;
    },

    // Typing
    addTypingUser(userId) {
        this.state.typingUsers.add(userId);
    },

    removeTypingUser(userId) {
        this.state.typingUsers.delete(userId);
    },

    // Settings
    updateSettings(settings) {
        this.state.settings = { ...this.state.settings, ...settings };
        Utils.storage.set('flash_settings', this.state.settings);
        this.applySettings();
    },

    applySettings() {
        const { animations, glow, dynamicBg, flashMode } = this.state.settings;
        document.body.classList.toggle('no-animations', !animations);
        document.body.classList.toggle('no-glow', !glow);
        document.body.classList.toggle('dynamic-bg', dynamicBg);
        document.body.classList.toggle('flash-mode', flashMode);
    }
};

// Initialize store
Store.init();

// Debug: reset settings if animations broken
// Run in console: Store.resetSettings()
Store.resetSettings = function() {
    this.state.settings = {
        animations: true,
        glow: true,
        dynamicBg: true,
        flashMode: false
    };
    Utils.storage.set('flash_settings', this.state.settings);
    this.applySettings();
    console.log('Settings reset!');
};
