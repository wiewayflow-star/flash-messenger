/**
 * Flash API Client
 */
const API = {
    async request(endpoint, options = {}) {
        const url = CONFIG.API_URL + endpoint;
        const headers = {
            'Content-Type': 'application/json',
            ...options.headers
        };

        if (Store.state.token) {
            headers['Authorization'] = `Bearer ${Store.state.token}`;
        }

        try {
            const response = await fetch(url, {
                ...options,
                headers
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Ошибка запроса');
            }

            return data;
        } catch (error) {
            console.error('API Error:', error);
            throw error;
        }
    },

    // Auth
    auth: {
        async register(email, username, password) {
            return API.request('/auth/register', {
                method: 'POST',
                body: JSON.stringify({ email, username, password })
            });
        },

        async login(email, password, visitorId) {
            return API.request('/auth/login', {
                method: 'POST',
                body: JSON.stringify({ email, password, visitorId })
            });
        },

        async autoLogin(visitorId) {
            return API.request('/auth/auto-login', {
                method: 'POST',
                body: JSON.stringify({ visitorId })
            });
        },

        async logout() {
            return API.request('/auth/logout', { method: 'POST' });
        },

        async me() {
            return API.request('/auth/me');
        },

        async changePassword(currentPassword, newPassword) {
            return API.request('/auth/change-password', {
                method: 'POST',
                body: JSON.stringify({ currentPassword, newPassword })
            });
        }
    },

    // Servers
    servers: {
        async list() {
            return API.request('/servers');
        },

        async create(name, description) {
            return API.request('/servers', {
                method: 'POST',
                body: JSON.stringify({ name, description })
            });
        },

        async get(serverId) {
            return API.request(`/servers/${serverId}`);
        },

        async getMembers(serverId) {
            return API.request(`/servers/${serverId}/members`);
        },

        async delete(serverId) {
            return API.request(`/servers/${serverId}`, { method: 'DELETE' });
        },

        async createInvite(serverId) {
            return API.request(`/servers/${serverId}/invites`, { method: 'POST' });
        },

        async joinByInvite(code) {
            return API.request(`/invites/${code}/join`, { method: 'POST' });
        }
    },

    // Channels
    channels: {
        async list(serverId) {
            return API.request(`/channels/server/${serverId}`);
        },

        async create(serverId, name, type = 'text') {
            return API.request(`/channels/server/${serverId}`, {
                method: 'POST',
                body: JSON.stringify({ name, type })
            });
        },

        async get(channelId) {
            return API.request(`/channels/${channelId}`);
        },

        async delete(channelId) {
            return API.request(`/channels/${channelId}`, { method: 'DELETE' });
        }
    },

    // Messages
    messages: {
        async list(channelId) {
            return API.request(`/messages/channel/${channelId}`);
        },

        async send(channelId, content) {
            return API.request(`/messages/channel/${channelId}`, {
                method: 'POST',
                body: JSON.stringify({ content })
            });
        },

        async edit(messageId, content) {
            return API.request(`/messages/${messageId}`, {
                method: 'PATCH',
                body: JSON.stringify({ content })
            });
        },

        async delete(messageId) {
            return API.request(`/messages/${messageId}`, { method: 'DELETE' });
        },

        async addReaction(messageId, emoji) {
            return API.request(`/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`, {
                method: 'PUT'
            });
        }
    },

    // Users
    users: {
        async get(userId) {
            return API.request(`/users/${userId}`);
        },

        async updateMe(data) {
            return API.request('/users/me', {
                method: 'PATCH',
                body: JSON.stringify(data)
            });
        },

        async updateStatus(status) {
            return API.request('/users/me/status', {
                method: 'POST',
                body: JSON.stringify({ status })
            });
        },

        async updatePublicKey(publicKey) {
            return API.request('/users/me/public-key', {
                method: 'POST',
                body: JSON.stringify({ publicKey })
            });
        },

        async getPublicKey(userId) {
            return API.request(`/users/${userId}/public-key`);
        },

        async search(query) {
            return API.request(`/users/search?q=${encodeURIComponent(query)}`);
        },

        async find(username, tag) {
            return API.request('/users/find', {
                method: 'POST',
                body: JSON.stringify({ username, tag })
            });
        },

        async getFriends() {
            return API.request('/users/me/friends');
        }
    },

    // Friends
    friends: {
        async sendRequest(userId) {
            return API.request(`/friends/request/${userId}`, { method: 'POST' });
        },

        async getRequests() {
            return API.request('/friends/requests');
        },

        async acceptRequest(requestId) {
            return API.request(`/friends/requests/${requestId}/accept`, { method: 'POST' });
        },

        async rejectRequest(requestId) {
            return API.request(`/friends/requests/${requestId}/reject`, { method: 'POST' });
        },

        async remove(userId) {
            return API.request(`/friends/${userId}`, { method: 'DELETE' });
        }
    },

    // DM Channels
    dm: {
        async create(userId) {
            return API.request(`/dm/create/${userId}`, { method: 'POST' });
        },

        async get(dmId) {
            return API.request(`/dm/${dmId}`);
        },

        async getMessages(dmId) {
            return API.request(`/dm/${dmId}/messages`);
        },

        async sendMessage(dmId, content) {
            return API.request(`/dm/${dmId}/messages`, {
                method: 'POST',
                body: JSON.stringify({ content })
            });
        }
    },

    // Voice
    voice: {
        async getChannelUsers(channelId) {
            return API.request(`/voice/${channelId}/users`);
        }
    },

    // Group Calls (Конфы)
    groupCalls: {
        async create(memberIds, name) {
            return API.request('/group-calls', {
                method: 'POST',
                body: JSON.stringify({ memberIds, name })
            });
        },

        async list() {
            return API.request('/group-calls');
        },

        async get(groupId) {
            return API.request(`/group-calls/${groupId}`);
        },

        async accept(groupId) {
            return API.request(`/group-calls/${groupId}/accept`, {
                method: 'POST'
            });
        },

        async leave(groupId) {
            return API.request(`/group-calls/${groupId}/leave`, {
                method: 'POST'
            });
        }
    }
};
