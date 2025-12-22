/**
 * Flash Main Application
 */
const App = {
    // Interval for status updates
    statusUpdateInterval: null,

    async init() {
        this.bindEvents();
        this.updateUserPanel();
        await this.loadServers();
        this.requestNotificationPermission();
        this.checkInviteCode();
        
        // Show home (DM list) by default so right side is not empty
        this.showHome();
        
        // Start periodic status updates
        this.startStatusUpdates();
    },

    // Start periodic status updates every 4 seconds
    startStatusUpdates() {
        if (this.statusUpdateInterval) {
            clearInterval(this.statusUpdateInterval);
        }
        
        this.statusUpdateInterval = setInterval(() => {
            this.refreshFriendsStatus();
        }, 4000);
    },

    // Refresh friends status from server
    async refreshFriendsStatus() {
        try {
            const { friends } = await API.users.getFriends();
            if (friends && friends.length > 0) {
                friends.forEach(friend => {
                    this.updateUserStatus(friend.id, friend.status || 'offline');
                });
            }
        } catch (e) {
            // Silently fail - don't spam console
        }
    },

    requestNotificationPermission() {
        if ('Notification' in window && Notification.permission === 'default') {
            Notification.requestPermission();
        }
    },

    async updateFriendRequestsBadge() {
        // Update badge on "Друзья" button
        try {
            const { incoming } = await API.friends.getRequests();
            const existingBadge = document.querySelector('.friend-requests-badge');
            
            if (incoming && incoming.length > 0) {
                const badgeText = incoming.length > 99 ? '99+' : incoming.length;
                if (existingBadge) {
                    existingBadge.textContent = badgeText;
                } else {
                    // Refresh home to show badge
                    if (!Store.state.currentServer && !Store.state.currentDM) {
                        this.showHome();
                    }
                }
            } else if (existingBadge) {
                existingBadge.remove();
            }
        } catch (e) {
            console.error('Failed to update friend requests badge:', e);
        }
    },

    updateUserStatus(userId, status) {
        // Update user status in members list
        const member = Store.state.members.find(m => m.id === userId);
        if (member) {
            member.status = status;
            this.renderMembers();
        }

        // Update ALL status dots for this user across the entire page
        document.querySelectorAll(`[data-user="${userId}"] .status-dot`).forEach(dot => {
            dot.className = `status-dot ${status}`;
        });
        
        // Update status text in DM list
        document.querySelectorAll(`[data-user="${userId}"] .dm-status`).forEach(el => {
            el.textContent = this.getStatusText(status);
        });
    },

    bindEvents() {
        // Server list clicks
        Utils.$('#server-list').addEventListener('click', (e) => {
            const icon = e.target.closest('.server-icon');
            if (icon) this.selectServer(icon.dataset.server);
        });

        // Home icon
        Utils.$('.home-icon').addEventListener('click', () => this.showHome());

        // Add server
        Utils.$('.add-server').addEventListener('click', () => this.showModal('create-server-modal'));

        // Join server
        Utils.$('.join-server').addEventListener('click', () => this.showModal('join-server-modal'));

        // Join server form
        Utils.$('#join-server-form').addEventListener('submit', (e) => {
            e.preventDefault();
            const code = e.target.code.value.trim().toUpperCase();
            if (code) {
                this.joinServerByInvite(code);
                this.hideModal('join-server-modal');
                e.target.reset();
            }
        });

        // Channel list clicks
        Utils.$('#channel-list').addEventListener('click', (e) => {
            const item = e.target.closest('.channel-item');
            if (item && item.dataset.type === 'text') {
                this.selectChannel(item.dataset.channel);
            } else if (item && item.dataset.type === 'voice') {
                // Join voice channel
                if (window.Voice) {
                    Voice.joinChannel(item.dataset.channel, item.querySelector('.channel-name')?.textContent || 'Голосовой канал');
                }
            }
        });

        // Voice channel context menu (right click)
        Utils.$('#channel-list').addEventListener('contextmenu', (e) => {
            const item = e.target.closest('.channel-item');
            if (item && item.dataset.type === 'voice') {
                e.preventDefault();
                this.showVoiceChannelContextMenu(e, item.dataset.channel);
            }
        });

        // Message form
        Utils.$('#message-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.sendMessage();
        });

        // Message input typing
        Utils.$('#message-input').addEventListener('input', Utils.debounce(() => {
            if (Store.state.currentChannel) {
                WS.sendTyping(Store.state.currentChannel.id);
            }
        }, 1000));

        // Create server form
        Utils.$('#create-server-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.createServer(e.target);
        });

        // Settings button
        Utils.$('#settings-btn').addEventListener('click', () => {
            this.showModal('settings-modal');
            this.loadSettings();
        });

        // Settings tabs
        Utils.$$('.settings-tab').forEach(tab => {
            if (!tab.classList.contains('danger')) {
                tab.addEventListener('click', () => this.switchSettingsTab(tab.dataset.section));
            }
        });

        // Logout
        Utils.$('#logout-btn').addEventListener('click', () => {
            this.hideModal('settings-modal');
            Auth.logout();
        });

        // Profile form
        Utils.$('#profile-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.updateProfile(e.target);
        });

        // Password form
        Utils.$('#password-form')?.addEventListener('submit', (e) => {
            e.preventDefault();
            this.changePassword(e.target);
        });

        // Avatar file upload - click on avatar itself
        Utils.$('#settings-avatar')?.addEventListener('click', (e) => {
            Utils.$('#avatar-file-input')?.click();
        });
        
        Utils.$('#avatar-file-input')?.addEventListener('change', (e) => {
            this.handleImageUpload(e.target.files[0], 'avatar');
            e.target.value = ''; // Reset for same file
        });

        // Banner file upload
        Utils.$('#settings-banner')?.addEventListener('click', (e) => {
            if (!e.target.closest('.banner-overlay') && e.target.id !== 'settings-banner') return;
            Utils.$('#banner-file-input')?.click();
        });
        
        Utils.$('#banner-file-input')?.addEventListener('change', (e) => {
            this.handleImageUpload(e.target.files[0], 'banner');
            e.target.value = ''; // Reset for same file
        });

        // Flash mode toggle
        Utils.$('#toggle-flash-mode').addEventListener('click', () => {
            const current = Store.state.settings.flashMode;
            Store.updateSettings({ flashMode: !current });
            Utils.$('#toggle-flash-mode').textContent = current ? 'Включить Flash Mode' : 'Выключить Flash Mode';
        });

        // Settings checkboxes
        Utils.$('#setting-animations').addEventListener('change', (e) => {
            Store.updateSettings({ animations: e.target.checked });
        });
        Utils.$('#setting-glow').addEventListener('change', (e) => {
            Store.updateSettings({ glow: e.target.checked });
        });
        Utils.$('#setting-dynamic-bg').addEventListener('change', (e) => {
            Store.updateSettings({ dynamicBg: e.target.checked });
        });

        // Members toggle
        Utils.$('#members-toggle').addEventListener('click', () => {
            Utils.$('#members-sidebar').classList.toggle('show');
        });

        // Search users
        Utils.$('#search-users-btn').addEventListener('click', () => this.showModal('search-modal'));
        Utils.$('#user-search-input').addEventListener('input', Utils.debounce((e) => {
            this.searchUsers(e.target.value);
        }, 300));

        // Modal close buttons
        Utils.$$('.modal-close, .modal-cancel').forEach(btn => {
            btn.addEventListener('click', () => {
                const modal = btn.closest('.modal');
                if (modal) modal.classList.remove('show');
            });
        });

        // Close modal on backdrop click
        Utils.$$('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) modal.classList.remove('show');
            });
        });

        // Emoji picker
        Utils.$('#emoji-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            const picker = Utils.$('#emoji-picker');
            picker.classList.toggle('show');
            
            const rect = e.target.getBoundingClientRect();
            picker.style.bottom = (window.innerHeight - rect.top + 10) + 'px';
            picker.style.right = (window.innerWidth - rect.right) + 'px';
        });

        Utils.$$('.emoji-item').forEach(item => {
            item.addEventListener('click', () => {
                const input = Utils.$('#message-input');
                input.value += item.textContent;
                input.focus();
                Utils.$('#emoji-picker').classList.remove('show');
            });
        });

        // Close emoji picker on outside click
        document.addEventListener('click', () => {
            Utils.$('#emoji-picker').classList.remove('show');
        });

        // Search results click (event delegation)
        document.addEventListener('click', (e) => {
            const resultWrapper = e.target.closest('.search-result-wrapper');
            if (resultWrapper) {
                const userId = resultWrapper.dataset.user;
                if (userId) this.showUserProfile(userId);
            }
        });

        // DM item click (event delegation)
        document.addEventListener('click', (e) => {
            const dmItem = e.target.closest('.dm-item');
            if (dmItem) {
                const userId = dmItem.dataset.user;
                this.openDM(userId);
            }
        });

        // Add friend button
        document.addEventListener('click', (e) => {
            if (e.target.id === 'add-friend-btn') {
                this.sendFriendRequest();
            }
        });
    },

    // UI Updates
    updateUserPanel() {
        const user = Store.state.user;
        if (!user) return;

        Utils.$('#user-name').textContent = user.username;
        Utils.$('#user-tag').textContent = user.tag;
        
        const avatarEl = Utils.$('#user-avatar');
        if (user.avatar) {
            avatarEl.style.backgroundImage = `url(${user.avatar})`;
            avatarEl.style.backgroundSize = 'cover';
            avatarEl.style.backgroundPosition = 'center';
            avatarEl.textContent = '';
        } else {
            avatarEl.style.backgroundImage = '';
            avatarEl.textContent = Utils.getInitials(user.username);
        }
    },

    // Servers
    async loadServers() {
        try {
            const { servers } = await API.servers.list();
            Store.setServers(servers);
            this.renderServers();
            // Don't auto-select server - showHome() will be called after this
        } catch (error) {
            console.error('Failed to load servers:', error);
        }
    },

    renderServers() {
        const container = Utils.$('#server-list');
        container.innerHTML = Store.state.servers.map(server => 
            Components.serverIcon(server, server.id === Store.state.currentServer?.id)
        ).join('');
    },

    async selectServer(serverId) {
        const server = Store.state.servers.find(s => s.id === serverId);
        if (!server) return;

        Store.setCurrentServer(server);
        this.renderServers();
        
        Utils.$('#server-name').textContent = server.name;

        // Load channels
        try {
            const { channels } = await API.channels.list(serverId);
            Store.setChannels(channels);
            
            // Load voice channel users for each voice channel
            const voiceChannels = channels.filter(c => c.type === 'voice');
            for (const vc of voiceChannels) {
                try {
                    const { users } = await API.voice.getChannelUsers(vc.id);
                    Store.setVoiceChannelUsers(vc.id, users);
                } catch (e) {
                    console.log('[Voice] No users in channel:', vc.id);
                }
            }
            
            this.renderChannels();

            // Load members
            const { members } = await API.servers.getMembers(serverId);
            Store.setMembers(members);
            this.renderMembers();

            // Select first text channel
            const textChannel = channels.find(c => c.type === 'text');
            if (textChannel) {
                this.selectChannel(textChannel.id);
            }
        } catch (error) {
            console.error('Failed to load server data:', error);
        }
    },

    renderChannels() {
        const container = Utils.$('#channel-list');
        const textChannels = Store.state.channels.filter(c => c.type === 'text');
        const voiceChannels = Store.state.channels.filter(c => c.type === 'voice');

        container.innerHTML = `
            <button class="btn btn-primary" style="width: 100%; margin-bottom: 12px;" onclick="App.showServerInvite()">
                <svg viewBox="0 0 24 24" width="16" height="16" style="margin-right: 6px; vertical-align: middle;">
                    <path fill="currentColor" d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                </svg>
                Пригласить
            </button>
            <div class="channel-category">
                <div class="category-header">Текстовые каналы</div>
                ${textChannels.map(c => Components.channelItem(c, c.id === Store.state.currentChannel?.id)).join('')}
            </div>
            <div class="channel-category">
                <div class="category-header">Голосовые каналы</div>
                ${voiceChannels.map(c => Components.channelItem(c, false, Store.getVoiceChannelUsers(c.id))).join('')}
            </div>
        `;
        
        // Start voice channel timers
        this.startVoiceChannelTimers();
    },

    // Voice channel timer interval
    voiceTimerInterval: null,

    startVoiceChannelTimers() {
        // Clear existing interval
        if (this.voiceTimerInterval) {
            clearInterval(this.voiceTimerInterval);
        }
        
        // Update timers immediately
        this.updateVoiceChannelTimers();
        
        // Update every second
        this.voiceTimerInterval = setInterval(() => {
            this.updateVoiceChannelTimers();
        }, 1000);
    },

    updateVoiceChannelTimers() {
        const timers = document.querySelectorAll('[data-channel-timer]');
        timers.forEach(timer => {
            const channelId = timer.dataset.channelTimer;
            const startTime = Store.getVoiceChannelStartTime(channelId);
            
            if (startTime) {
                const elapsed = Math.floor((Date.now() - startTime) / 1000);
                const hours = Math.floor(elapsed / 3600);
                const minutes = Math.floor((elapsed % 3600) / 60);
                const seconds = elapsed % 60;
                
                if (hours > 0) {
                    timer.textContent = `${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                } else {
                    timer.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
                }
            }
        });
    },

    async selectChannel(channelId) {
        const channel = Store.state.channels.find(c => c.id === channelId);
        if (!channel) return;

        // Exit DM mode
        this.isDMMode = false;
        Store.state.currentDM = null;
        Store.state.currentDMUser = null;

        // Unsubscribe from previous channel
        if (Store.state.currentChannel) {
            WS.unsubscribe(Store.state.currentChannel.id);
        }

        Store.setCurrentChannel(channel);
        this.renderChannels();
        
        Utils.$('#current-channel-name').textContent = channel.name;
        Utils.$('#channel-hash').style.display = ''; // Show # for channels
        
        // Show chat area
        Utils.$('.main-content')?.classList.remove('no-chat');
        
        // Show message input
        Utils.$('.message-input-container')?.style.setProperty('display', '');

        // Subscribe to new channel
        WS.subscribe(channelId);

        // Load messages
        try {
            const { messages } = await API.messages.list(channelId);
            Store.setMessages(messages);
            this.renderMessages();
            this.scrollToBottom();
        } catch (error) {
            console.error('Failed to load messages:', error);
        }
    },

    // Messages
    async renderMessages() {
        const container = Utils.$('#messages-list');
        const messages = Store.state.messages;
        
        // Decrypt messages if needed
        const decryptedMessages = await Promise.all(messages.map(async (msg) => {
            // If already decrypted locally, use that
            if (msg.decryptedContent) {
                return { ...msg, displayContent: msg.decryptedContent };
            }
            
            // Try to decrypt
            if (window.FlashCrypto && msg.content) {
                try {
                    // Check if it's encrypted (base64 encoded)
                    if (this.isEncryptedContent(msg.content)) {
                        const authorId = msg.author?.id;
                        if (authorId && authorId !== Store.state.user?.id) {
                            // Get sender's public key
                            const { publicKey } = await API.users.getPublicKey(authorId);
                            if (publicKey) {
                                const decrypted = await FlashCrypto.decryptFromUser(msg.content, authorId, publicKey);
                                return { ...msg, displayContent: decrypted };
                            }
                        } else if (authorId === Store.state.user?.id) {
                            // Our own message - should have been stored decrypted
                            return { ...msg, displayContent: msg.content };
                        }
                    }
                } catch (e) {
                    // Decryption failed, show as is
                }
            }
            
            return { ...msg, displayContent: msg.content };
        }));
        
        // Render with grouping
        container.innerHTML = decryptedMessages.map((msg, index) => {
            const prevMsg = index > 0 ? decryptedMessages[index - 1] : null;
            const isGrouped = Utils.shouldGroupMessages(prevMsg, msg);
            // Use displayContent for rendering
            const displayMsg = { ...msg, content: msg.displayContent || msg.content };
            return Components.message(displayMsg, isGrouped);
        }).join('');
    },

    // Check if content looks like encrypted data
    isEncryptedContent(content) {
        if (!content || content.length < 20) return false;
        // Check if it's base64 encoded (encrypted content)
        try {
            // Encrypted content is base64 and typically longer
            const base64Regex = /^[A-Za-z0-9+/]+=*$/;
            return base64Regex.test(content) && content.length > 50;
        } catch {
            return false;
        }
    },

    scrollToBottom() {
        const container = Utils.$('#messages-container');
        container.scrollTop = container.scrollHeight;
    },

    async sendMessage() {
        const input = Utils.$('#message-input');
        const content = input.value.trim();
        
        if (!content) return;

        // Check if in DM mode or channel mode
        if (this.isDMMode && Store.state.currentDM) {
            console.log('[Send] Sending encrypted DM to:', Store.state.currentDM.id);
            input.value = '';
            try {
                // Get recipient's public key for E2EE
                const otherUser = Store.state.currentDMUser;
                let encryptedContent = content;
                
                if (window.FlashCrypto && otherUser) {
                    try {
                        // Get recipient's public key
                        const { publicKey } = await API.users.getPublicKey(otherUser.id);
                        if (publicKey) {
                            encryptedContent = await FlashCrypto.encryptForUser(content, otherUser.id, publicKey);
                        }
                    } catch (e) {
                        console.error('[E2EE] Encryption failed, sending unencrypted');
                    }
                }
                
                const { message } = await API.dm.sendMessage(Store.state.currentDM.id, encryptedContent);
                
                // Store original content locally for display
                message.decryptedContent = content;
                message.encrypted = true;
                
                Store.addMessage(message);
                this.renderMessages();
                this.scrollToBottom();
            } catch (error) {
                console.error('Failed to send DM:', error);
                input.value = content;
            }
        } else if (Store.state.currentChannel) {
            input.value = '';
            try {
                // For channels, encrypt for all members
                let encryptedContent = content;
                
                if (window.FlashCrypto && Store.state.members.length > 0) {
                    try {
                        // Get public keys for all members
                        const memberKeys = {};
                        for (const member of Store.state.members) {
                            if (member.id !== Store.state.user?.id) {
                                try {
                                    const { publicKey } = await API.users.getPublicKey(member.id);
                                    if (publicKey) memberKeys[member.id] = publicKey;
                                } catch (e) {
                                    // Skip members without public keys
                                }
                            }
                        }
                        
                        if (Object.keys(memberKeys).length > 0) {
                            const encrypted = await FlashCrypto.encryptForChannel(content, Store.state.currentChannel.id, memberKeys);
                            if (encrypted) {
                                encryptedContent = JSON.stringify(encrypted);
                            }
                        }
                    } catch (e) {
                        console.error('[E2EE] Channel encryption failed');
                    }
                }
                
                const { message } = await API.messages.send(Store.state.currentChannel.id, encryptedContent);
                
                // Store original content locally
                message.decryptedContent = content;
                message.encrypted = true;
                
                Store.addMessage(message);
                this.renderMessages();
                this.scrollToBottom();
            } catch (error) {
                console.error('Failed to send message:', error);
                input.value = content;
            }
        }
    },

    updateTypingIndicator() {
        const indicator = Utils.$('#typing-indicator');
        const users = Array.from(Store.state.typingUsers);
        
        if (users.length === 0) {
            indicator.innerHTML = '';
            return;
        }

        const members = users.map(id => Store.state.members.find(m => m.id === id)?.username || 'Кто-то');
        indicator.innerHTML = `<span class="typing-dots"><span></span><span></span><span></span></span> ${members.join(', ')} печата${members.length > 1 ? 'ют' : 'ет'}...`;
    },

    // Members
    renderMembers() {
        const container = Utils.$('#members-list');
        container.innerHTML = Store.state.members.map(m => Components.memberItem(m)).join('');
    },

    // Create server
    async createServer(form) {
        const name = form.name.value;
        const description = form.description.value;

        try {
            const { server } = await API.servers.create(name, description);
            Store.addServer(server);
            this.renderServers();
            this.selectServer(server.id);
            this.hideModal('create-server-modal');
            form.reset();
        } catch (error) {
            console.error('Failed to create server:', error);
        }
    },

    // Search
    async searchUsers(query) {
        const container = Utils.$('#search-results');
        
        console.log('[Search] Query:', query);
        
        if (!query || query.length < 2) {
            container.innerHTML = '';
            return;
        }

        try {
            const { users } = await API.users.search(query);
            console.log('[Search] Found users:', users);
            container.innerHTML = users.length 
                ? users.map(u => Components.searchResult(u)).join('')
                : '<p style="color: var(--text-muted); text-align: center;">Никого не найдено</p>';
        } catch (error) {
            console.error('[Search] Error:', error);
            container.innerHTML = '<p style="color: var(--danger); text-align: center;">Ошибка поиска</p>';
        }
    },

    // Settings
    loadSettings() {
        const user = Store.state.user;
        const settings = Store.state.settings;

        Utils.$('#settings-username').textContent = user.username;
        Utils.$('#settings-tag').textContent = user.tag;
        
        // Avatar
        const avatarEl = Utils.$('#settings-avatar');
        const avatarOverlay = avatarEl.querySelector('.avatar-overlay');
        if (user.avatar) {
            avatarEl.style.backgroundImage = `url(${user.avatar})`;
            // Clear text but keep overlay
            Array.from(avatarEl.childNodes).forEach(node => {
                if (node !== avatarOverlay && node.nodeType === Node.TEXT_NODE) {
                    node.remove();
                }
            });
        } else {
            avatarEl.style.backgroundImage = '';
            // Set initials but keep overlay
            const initials = Utils.getInitials(user.username);
            // Remove old text nodes
            Array.from(avatarEl.childNodes).forEach(node => {
                if (node !== avatarOverlay && node.nodeType === Node.TEXT_NODE) {
                    node.remove();
                }
            });
            // Add initials as text node before overlay
            if (avatarOverlay) {
                avatarEl.insertBefore(document.createTextNode(initials), avatarOverlay);
            } else {
                avatarEl.textContent = initials;
            }
        }
        
        // Banner
        const bannerEl = Utils.$('#settings-banner');
        if (bannerEl) {
            if (user.banner) {
                bannerEl.style.backgroundImage = `url(${user.banner})`;
            } else {
                bannerEl.style.backgroundImage = '';
            }
        }
        
        Utils.$('#profile-username').value = user.username;
        Utils.$('#profile-bio').value = user.bio || '';
        Utils.$('#profile-status').value = user.status || 'online';

        Utils.$('#setting-animations').checked = settings.animations;
        Utils.$('#setting-glow').checked = settings.glow;
        Utils.$('#setting-dynamic-bg').checked = settings.dynamicBg;
        Utils.$('#toggle-flash-mode').textContent = settings.flashMode ? 'Выключить Flash Mode' : 'Включить Flash Mode';
    },

    switchSettingsTab(section) {
        Utils.$$('.settings-tab').forEach(t => t.classList.toggle('active', t.dataset.section === section));
        Utils.$$('.settings-section').forEach(s => s.classList.toggle('active', s.dataset.section === section));
    },

    async updateProfile(form) {
        const data = {
            username: form.username.value,
            bio: form.bio.value,
            status: form.status.value
        };

        try {
            const { user } = await API.users.updateMe(data);
            Store.state.user = { ...Store.state.user, ...user };
            Utils.storage.set('flash_user', Store.state.user);
            this.updateUserPanel();
            this.loadSettings();
        } catch (error) {
            console.error('Failed to update profile:', error);
        }
    },

    // Handle image file upload (avatar/banner)
    async handleImageUpload(file, type) {
        if (!file) return;
        
        if (file.size > 5 * 1024 * 1024) {
            alert('Файл слишком большой. Максимум 5MB');
            return;
        }
        
        if (!file.type.startsWith('image/')) {
            alert('Выберите изображение');
            return;
        }
        
        // Open new image editor
        ImageEditor.open(file, type, async (base64, imageType) => {
            try {
                const data = imageType === 'avatar' ? { avatar: base64 } : { banner: base64 };
                const { user } = await API.users.updateMe(data);
                
                Store.state.user = { ...Store.state.user, ...user };
                Utils.storage.set('flash_user', Store.state.user);
                this.updateUserPanel();
                this.loadSettings();
            } catch (error) {
                console.error('Failed to save image:', error);
                alert('Ошибка сохранения изображения');
            }
        });
    },

    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    },

    async changePassword(form) {
        const currentPassword = form.currentPassword.value;
        const newPassword = form.newPassword.value;
        const confirmPassword = form.confirmPassword.value;
        const messageEl = Utils.$('#password-message');
        
        if (newPassword !== confirmPassword) {
            messageEl.textContent = 'Пароли не совпадают';
            messageEl.style.color = 'var(--danger)';
            return;
        }
        
        if (newPassword.length < 6) {
            messageEl.textContent = 'Пароль минимум 6 символов';
            messageEl.style.color = 'var(--danger)';
            return;
        }
        
        try {
            await API.auth.changePassword(currentPassword, newPassword);
            messageEl.textContent = 'Пароль успешно изменён!';
            messageEl.style.color = 'var(--success)';
            form.reset();
        } catch (error) {
            messageEl.textContent = error.message || 'Ошибка смены пароля';
            messageEl.style.color = 'var(--danger)';
        }
    },

    // Home view
    async showHome() {
        Utils.$$('.server-icon').forEach(i => i.classList.remove('active'));
        Utils.$('.home-icon').classList.add('active');
        Utils.$('#server-name').textContent = 'Flash';
        
        Store.setCurrentServer(null);
        Store.setCurrentChannel(null);
        Store.setMessages([]);
        this.renderMessages();
        
        // Hide chat area when no chat is open
        Utils.$('.main-content')?.classList.add('no-chat');
        
        // Load friends for DM list
        try {
            const { friends } = await API.users.getFriends();
            
            let dmListHtml = '';
            if (friends.length > 0) {
                dmListHtml = `
                    <div class="dm-section">
                        <div class="dm-section-title">Личные сообщения</div>
                        ${friends.map(friend => {
                            const avatarStyle = friend.avatar 
                                ? `background-image: url(${friend.avatar}); background-size: cover; background-position: center;`
                                : `background: ${Utils.getUserColor(friend.id)}`;
                            const avatarContent = friend.avatar ? '' : Utils.getInitials(friend.username);
                            const unreadCount = Store.getUnreadDM(friend.id);
                            const unreadBadge = unreadCount > 0 
                                ? `<span class="dm-unread-badge">${unreadCount > 99 ? '99+' : unreadCount}</span>` 
                                : '';
                            return `
                            <div class="dm-item" data-user="${friend.id}">
                                <div class="dm-avatar" style="${avatarStyle}">
                                    ${avatarContent}
                                    <span class="status-dot ${friend.status || 'offline'}"></span>
                                </div>
                                <div class="dm-info">
                                    <div class="dm-name">${Utils.escapeHtml(friend.username)}${unreadBadge}</div>
                                    <div class="dm-status">${this.getStatusText(friend.status)}</div>
                                </div>
                            </div>
                        `}).join('')}
                    </div>
                `;
            } else {
                dmListHtml = `
                    <p style="color: var(--text-muted); text-align: center; padding: 20px; font-size: 13px;">
                        Добавьте друзей, чтобы начать общение
                    </p>
                `;
            }
            
            // Get friend requests count for badge
            let friendRequestsBadge = '';
            try {
                const { incoming } = await API.friends.getRequests();
                if (incoming && incoming.length > 0) {
                    friendRequestsBadge = `<span class="friend-requests-badge">${incoming.length > 99 ? '99+' : incoming.length}</span>`;
                }
            } catch (e) {}
            
            Utils.$('#channel-list').innerHTML = `
                <button class="btn btn-primary" style="width: 100%; margin-bottom: 8px;" onclick="App.showHome()">
                    Обновить
                </button>
                <button class="btn btn-secondary" style="width: 100%; margin-bottom: 16px; position: relative;" onclick="App.showFriends()">
                    Друзья${friendRequestsBadge}
                </button>
                <div class="dm-list">${dmListHtml}</div>
            `;
        } catch (error) {
            console.error('Failed to load friends:', error);
            Utils.$('#channel-list').innerHTML = `
                <button class="btn btn-secondary" style="width: 100%; margin-bottom: 16px;" onclick="App.showFriends()">
                    Друзья
                </button>
                <div class="dm-list">
                    <p style="color: var(--text-muted); text-align: center; padding: 20px;">
                        Ошибка загрузки
                    </p>
                </div>
            `;
        }
    },

    // User Profile
    async showUserProfile(userId) {
        try {
            const { user } = await API.users.get(userId);
            
            // Update modal content
            Utils.$('#profile-view-avatar').textContent = Utils.getInitials(user.username);
            Utils.$('#profile-view-username').textContent = user.username;
            Utils.$('#profile-view-tag').textContent = user.tag;
            Utils.$('#profile-view-bio').textContent = user.bio || 'Нет описания';
            Utils.$('#profile-view-status').textContent = this.getStatusText(user.status);
            Utils.$('#profile-view-created').textContent = Utils.formatDate(user.created_at);
            
            // Store current profile user ID
            this.currentProfileUserId = userId;
            
            // Check friendship status
            const { friends } = await API.users.getFriends();
            const isFriend = friends.some(f => f.id === userId);
            
            const addFriendBtn = Utils.$('#add-friend-btn');
            if (isFriend) {
                addFriendBtn.textContent = 'Удалить из друзей';
                addFriendBtn.className = 'btn btn-danger';
                addFriendBtn.onclick = () => this.removeFriendFromProfile();
            } else {
                addFriendBtn.textContent = 'Добавить в друзья';
                addFriendBtn.className = 'btn btn-success';
                addFriendBtn.onclick = () => this.sendFriendRequest();
            }
            
            // Show modal
            this.hideModal('search-modal');
            this.showModal('user-profile-modal');
        } catch (error) {
            console.error('Failed to load user profile:', error);
        }
    },

    async sendFriendRequest() {
        if (!this.currentProfileUserId) return;

        const addFriendBtn = Utils.$('#add-friend-btn');
        const originalText = addFriendBtn.textContent;
        
        try {
            // Disable button and show loading
            addFriendBtn.disabled = true;
            addFriendBtn.textContent = 'Отправка...';
            
            await API.friends.sendRequest(this.currentProfileUserId);
            
            // Show success animation
            addFriendBtn.innerHTML = `
                <svg viewBox="0 0 24 24" style="width: 20px; height: 20px; stroke: currentColor; stroke-width: 3; fill: none; margin-right: 8px;">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                Запрос отправлен
            `;
            addFriendBtn.className = 'btn btn-success';
            addFriendBtn.style.pointerEvents = 'none';
            
            // Close modal after delay
            setTimeout(() => {
                this.hideModal('user-profile-modal');
            }, 1500);
        } catch (error) {
            console.error('Failed to send friend request:', error);
            addFriendBtn.textContent = originalText;
            addFriendBtn.disabled = false;
            // Show error inline instead of alert
            addFriendBtn.textContent = error.message || 'Ошибка';
            addFriendBtn.className = 'btn btn-danger';
            setTimeout(() => {
                addFriendBtn.textContent = originalText;
                addFriendBtn.className = 'btn btn-success';
            }, 2000);
        }
    },

    async removeFriendFromProfile() {
        if (!this.currentProfileUserId) return;
        if (!confirm('Удалить из друзей?')) return;
        
        const btn = Utils.$('#add-friend-btn');
        
        try {
            btn.disabled = true;
            btn.textContent = 'Удаление...';
            
            await API.friends.remove(this.currentProfileUserId);
            
            // Show success
            btn.innerHTML = `
                <svg viewBox="0 0 24 24" style="width: 20px; height: 20px; stroke: currentColor; stroke-width: 3; fill: none; margin-right: 8px;">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                Удалено
            `;
            
            setTimeout(() => {
                this.hideModal('user-profile-modal');
            }, 1000);
        } catch (error) {
            console.error('Failed to remove friend:', error);
            btn.textContent = 'Ошибка';
            setTimeout(() => {
                btn.textContent = 'Удалить из друзей';
                btn.disabled = false;
            }, 2000);
        }
    },

    getStatusText(status) {
        const statuses = {
            online: 'Онлайн',
            idle: 'Не на месте',
            dnd: 'Не беспокоить',
            offline: 'Оффлайн'
        };
        return statuses[status] || 'Неизвестно';
    },

    // Update unread badge for a specific user in DM list
    updateDMUnreadBadge(userId) {
        const dmItem = document.querySelector(`.dm-item[data-user="${userId}"]`);
        if (!dmItem) return;
        
        const dmName = dmItem.querySelector('.dm-name');
        if (!dmName) return;
        
        // Remove existing badge
        const existingBadge = dmName.querySelector('.dm-unread-badge');
        if (existingBadge) existingBadge.remove();
        
        // Add new badge if there are unread messages
        const unreadCount = Store.getUnreadDM(userId);
        if (unreadCount > 0) {
            const badge = document.createElement('span');
            badge.className = 'dm-unread-badge';
            badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
            dmName.appendChild(badge);
        }
    },

    // Modals
    showModal(id) {
        Utils.$(`#${id}`).classList.add('show');
    },

    hideModal(id) {
        Utils.$(`#${id}`).classList.remove('show');
    },

    // Voice channel context menu
    showVoiceChannelContextMenu(e, channelId) {
        // Only show for server owner
        const server = Store.state.currentServer;
        if (!server || server.owner_id !== Store.state.user?.id) {
            return;
        }

        // Remove existing context menu
        this.hideContextMenu();

        const channel = Store.state.channels.find(c => c.id === channelId);
        if (!channel) return;

        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.id = 'voice-context-menu';
        menu.innerHTML = `
            <div class="context-menu-item" data-action="rename">
                <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
                Переименовать
            </div>
            <div class="context-menu-item" data-action="mute">
                <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>
                ${channel.muted ? 'Включить звук' : 'Заглушить канал'}
            </div>
            <div class="context-menu-item" data-action="hideNames">
                <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
                ${channel.hideNames ? 'Показать имена' : 'Скрыть имена'}
            </div>
            <div class="context-menu-divider"></div>
            <div class="context-menu-item danger" data-action="delete">
                <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
                Удалить канал
            </div>
        `;

        menu.style.left = `${e.clientX}px`;
        menu.style.top = `${e.clientY}px`;

        document.body.appendChild(menu);

        // Bind menu actions
        menu.addEventListener('click', (ev) => {
            const item = ev.target.closest('.context-menu-item');
            if (!item) return;

            const action = item.dataset.action;
            this.handleVoiceChannelAction(action, channelId);
            this.hideContextMenu();
        });

        // Close on click outside
        setTimeout(() => {
            document.addEventListener('click', this.hideContextMenu, { once: true });
        }, 10);
    },

    hideContextMenu() {
        const menu = document.getElementById('voice-context-menu');
        if (menu) menu.remove();
    },

    handleVoiceChannelAction(action, channelId) {
        const channel = Store.state.channels.find(c => c.id === channelId);
        if (!channel) return;

        switch (action) {
            case 'rename':
                this.showRenameChannelModal(channelId);
                break;
            case 'mute':
                channel.muted = !channel.muted;
                this.renderChannels();
                break;
            case 'hideNames':
                channel.hideNames = !channel.hideNames;
                this.renderChannels();
                break;
            case 'delete':
                if (confirm(`Удалить канал "${channel.name}"?`)) {
                    this.deleteChannel(channelId);
                }
                break;
        }
    },

    showRenameChannelModal(channelId) {
        const channel = Store.state.channels.find(c => c.id === channelId);
        if (!channel) return;

        const modal = document.createElement('div');
        modal.className = 'modal show';
        modal.id = 'rename-channel-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <h2>Переименовать канал</h2>
                <form id="rename-channel-form">
                    <div class="form-group">
                        <label>Название канала</label>
                        <input type="text" id="new-channel-name" value="${Utils.escapeHtml(channel.name)}" required>
                    </div>
                    <div class="modal-actions">
                        <button type="button" class="btn btn-secondary" onclick="App.hideRenameModal()">Отмена</button>
                        <button type="submit" class="btn btn-primary">Сохранить</button>
                    </div>
                </form>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('#rename-channel-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const newName = document.getElementById('new-channel-name').value.trim();
            if (newName && newName !== channel.name) {
                channel.name = newName;
                this.renderChannels();
                // TODO: Send to server when API is ready
            }
            this.hideRenameModal();
        });
    },

    hideRenameModal() {
        const modal = document.getElementById('rename-channel-modal');
        if (modal) modal.remove();
    },

    async deleteChannel(channelId) {
        try {
            await API.channels.delete(channelId);
            Store.removeChannel(channelId);
            this.renderChannels();
        } catch (error) {
            console.error('Failed to delete channel:', error);
            alert('Ошибка удаления канала');
        }
    },

    // Go back from friends view
    goBackFromFriends() {
        // Hide chat area
        Utils.$('.main-content')?.classList.add('no-chat');
        Utils.$('#current-channel-name').textContent = '';
        
        // Show message input back (in case it was hidden)
        Utils.$('.message-input-container')?.style.setProperty('display', '');
    },

    // Friends view
    async showFriends() {
        Utils.$('#server-name').textContent = 'Друзья';
        
        // Show chat area (remove no-chat class)
        Utils.$('.main-content')?.classList.remove('no-chat');
        
        // Update header with back arrow
        Utils.$('#current-channel-name').innerHTML = `
            <span class="back-arrow" onclick="App.goBackFromFriends()" style="cursor: pointer; margin-right: 8px; opacity: 0.7;">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M19 12H5M12 19l-7-7 7-7"/>
                </svg>
            </span>
            Друзья
        `;
        Utils.$('#channel-hash').style.display = 'none';
        
        // Clear current channel/DM state
        Store.state.currentChannel = null;
        Store.state.currentDM = null;
        
        try {
            console.log('[Friends] Loading friends and requests...');
            const [friendsData, requestsData] = await Promise.all([
                API.users.getFriends(),
                API.friends.getRequests()
            ]);

            console.log('[Friends] friendsData:', friendsData);
            console.log('[Friends] requestsData:', requestsData);

            const { friends } = friendsData;
            const { incoming, outgoing } = requestsData;
            
            console.log('[Friends] friends:', friends);
            console.log('[Friends] incoming:', incoming);
            console.log('[Friends] outgoing:', outgoing);

            let html = '<div class="friends-container">';

            // Incoming requests
            if (incoming.length > 0) {
                html += `
                    <div class="friends-section">
                        <h3 style="color: var(--text-primary); margin-bottom: 12px;">Входящие запросы (${incoming.length})</h3>
                        ${incoming.map(req => `
                            <div class="friend-request-item">
                                <div class="friend-avatar" style="background: ${Utils.getUserColor(req.user.id)}">${Utils.getInitials(req.user.username)}</div>
                                <div class="friend-info">
                                    <div class="friend-name">${Utils.escapeHtml(req.user.username)}</div>
                                    <div class="friend-tag">${req.user.tag}</div>
                                </div>
                                <div class="friend-actions">
                                    <button class="btn btn-success btn-sm" onclick="App.acceptFriendRequest('${req.id}')">Принять</button>
                                    <button class="btn btn-danger btn-sm" onclick="App.rejectFriendRequest('${req.id}')">Отклонить</button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `;
            }

            // Outgoing requests
            if (outgoing.length > 0) {
                html += `
                    <div class="friends-section">
                        <h3 style="color: var(--text-primary); margin-bottom: 12px;">Исходящие запросы (${outgoing.length})</h3>
                        ${outgoing.map(req => `
                            <div class="friend-request-item">
                                <div class="friend-avatar" style="background: ${Utils.getUserColor(req.user.id)}">${Utils.getInitials(req.user.username)}</div>
                                <div class="friend-info">
                                    <div class="friend-name">${Utils.escapeHtml(req.user.username)}</div>
                                    <div class="friend-tag">${req.user.tag}</div>
                                </div>
                                <div class="friend-status">Ожидание...</div>
                            </div>
                        `).join('')}
                    </div>
                `;
            }

            // Friends list
            if (friends.length > 0) {
                html += `
                    <div class="friends-section">
                        <h3 style="color: var(--text-primary); margin-bottom: 12px;">Все друзья (${friends.length})</h3>
                        ${friends.map(friend => `
                            <div class="friend-item" data-user="${friend.id}">
                                <div class="friend-avatar" style="background: ${Utils.getUserColor(friend.id)}">
                                    ${Utils.getInitials(friend.username)}
                                    <span class="status-dot ${friend.status || 'offline'}"></span>
                                </div>
                                <div class="friend-info">
                                    <div class="friend-name">${Utils.escapeHtml(friend.username)}</div>
                                    <div class="friend-tag">${friend.tag}</div>
                                </div>
                                <div class="friend-actions">
                                    <button class="btn btn-secondary btn-sm" onclick="App.showUserProfile('${friend.id}')">Профиль</button>
                                    <button class="btn btn-danger btn-sm" onclick="App.removeFriend('${friend.id}')">Удалить</button>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                `;
            }

            if (incoming.length === 0 && outgoing.length === 0 && friends.length === 0) {
                html += `
                    <p style="color: var(--text-muted); text-align: center; padding: 40px 20px;">
                        У вас пока нет друзей. Найдите людей через поиск!
                    </p>
                `;
            }

            html += '</div>';

            Utils.$('#channel-list').innerHTML = `
                <button class="btn btn-primary" style="width: 100%; margin-bottom: 8px;" onclick="App.showModal('search-modal')">
                    Найти людей
                </button>
                <button class="btn btn-secondary" style="width: 100%; margin-bottom: 16px;" onclick="App.showFriends()">
                    Обновить
                </button>
            `;

            console.log('[Friends] Setting messages-list HTML, length:', html.length);
            const messagesList = Utils.$('#messages-list');
            console.log('[Friends] messages-list element:', messagesList);
            
            if (messagesList) {
                messagesList.innerHTML = html;
                console.log('[Friends] HTML set successfully');
            } else {
                console.error('[Friends] messages-list element not found!');
            }
            
            // Hide message input (this is not a chat)
            Utils.$('.message-input-container')?.style.setProperty('display', 'none');
            
            // Update badge count only (without triggering refresh)
            const badgeEl = document.querySelector('.friend-requests-badge');
            if (badgeEl && incoming.length === 0) {
                badgeEl.remove();
            } else if (badgeEl) {
                badgeEl.textContent = incoming.length > 99 ? '99+' : incoming.length;
            }
        } catch (error) {
            console.error('Failed to load friends:', error);
            Utils.$('#messages-list').innerHTML = '<p style="color: var(--danger); text-align: center; padding: 20px;">Ошибка загрузки друзей</p>';
        }
    },

    async acceptFriendRequest(requestId) {
        try {
            await API.friends.acceptRequest(requestId);
            this.showFriends();
        } catch (error) {
            console.error('Failed to accept request:', error);
            alert('Ошибка принятия запроса');
        }
    },

    async rejectFriendRequest(requestId) {
        try {
            await API.friends.rejectRequest(requestId);
            this.showFriends();
        } catch (error) {
            console.error('Failed to reject request:', error);
            alert('Ошибка отклонения запроса');
        }
    },

    async removeFriend(userId) {
        if (!confirm('Удалить из друзей?')) return;
        
        try {
            await API.friends.remove(userId);
            this.showFriends();
        } catch (error) {
            console.error('Failed to remove friend:', error);
            alert('Ошибка удаления друга');
        }
    },

    // DM Chat
    async openDM(userId) {
        try {
            // Create or get existing DM channel
            const { dmChannel } = await API.dm.create(userId);
            
            // Get other user info
            const { otherUser } = await API.dm.get(dmChannel.id);
            
            console.log('[DM] Opening DM channel:', dmChannel.id, 'with user:', otherUser.username);
            
            // Clear unread messages for this user
            Store.clearUnreadDM(otherUser.id);
            this.updateDMUnreadBadge(otherUser.id);
            
            // Update UI - show "Flash" in sidebar, username in chat header
            Utils.$('#server-name').textContent = 'Flash';
            Utils.$('#current-channel-name').textContent = `@${otherUser.username}`;
            Utils.$('#channel-hash').style.display = 'none'; // Hide # for DMs
            
            // Unsubscribe from previous channel
            if (Store.state.currentChannel) {
                WS.unsubscribe(Store.state.currentChannel.id);
            }
            
            // Store current DM - IMPORTANT: set before loading messages
            Store.state.currentDM = dmChannel;
            Store.state.currentDMUser = otherUser;
            Store.setCurrentServer(null);
            Store.setCurrentChannel(null);
            
            // Show chat area
            Utils.$('.main-content')?.classList.remove('no-chat');
            
            // Show message input
            Utils.$('.message-input-container')?.style.setProperty('display', '');
            
            console.log('[DM] Current DM set to:', Store.state.currentDM);
            console.log('[DM] Store.state.currentDM.id:', Store.state.currentDM?.id);
            
            // Load messages
            const { messages } = await API.dm.getMessages(dmChannel.id);
            Store.setMessages(messages);
            this.renderMessages();
            this.scrollToBottom();
            
            // Update message form to send to DM
            this.isDMMode = true;
            
            // Show call button in header
            this.showDMCallButton(otherUser);
            
        } catch (error) {
            console.error('Failed to open DM:', error);
            alert('Ошибка открытия чата');
        }
    },

    // Show call button for DM
    showDMCallButton(user) {
        const headerActions = Utils.$('.header-actions');
        
        // Remove existing call button
        const existingBtn = document.getElementById('dm-call-btn');
        if (existingBtn) existingBtn.remove();
        
        // Add call button
        const callBtn = document.createElement('button');
        callBtn.className = 'icon-btn';
        callBtn.id = 'dm-call-btn';
        callBtn.title = 'Позвонить';
        callBtn.innerHTML = `
            <svg viewBox="0 0 24 24" width="24" height="24">
                <path fill="currentColor" d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/>
            </svg>
        `;
        callBtn.onclick = () => this.startDMCall(user);
        
        headerActions.insertBefore(callBtn, headerActions.firstChild);
    },

    // Start DM call
    startDMCall(user) {
        if (!Store.state.currentDM) {
            alert('Откройте чат для звонка');
            return;
        }
        
        if (window.Voice) {
            // Check if we're already in a call with this user (rejoin scenario)
            if (Voice.currentCall && Voice.currentCall.dmId === Store.state.currentDM.id) {
                alert('Вы уже в звонке');
                return;
            }
            
            Voice.startCall(Store.state.currentDM.id, user);
        } else {
            alert('Голосовая система не загружена');
        }
    },

    // Server invites
    async showServerInvite() {
        if (!Store.state.currentServer) {
            alert('Выберите сервер');
            return;
        }

        try {
            const { invite } = await API.servers.createInvite(Store.state.currentServer.id);
            const inviteUrl = `${window.location.origin}?invite=${invite.code}`;
            
            // Show invite modal
            this.showInviteModal(invite.code, inviteUrl);
        } catch (error) {
            console.error('Failed to create invite:', error);
            alert('Ошибка создания приглашения');
        }
    },

    showInviteModal(code, url) {
        // Remove existing modal
        const existing = document.getElementById('invite-modal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.className = 'modal show';
        modal.id = 'invite-modal';
        modal.innerHTML = `
            <div class="modal-content">
                <div class="modal-header">
                    <h2>Пригласить на сервер</h2>
                    <button class="modal-close" onclick="document.getElementById('invite-modal').remove()">&times;</button>
                </div>
                <div class="invite-content">
                    <p style="color: var(--text-secondary); margin-bottom: 16px;">
                        Отправьте эту ссылку друзьям, чтобы они могли присоединиться к серверу "${Utils.escapeHtml(Store.state.currentServer.name)}"
                    </p>
                    <div class="invite-code-container">
                        <input type="text" class="invite-code-input" value="${url}" readonly id="invite-url-input">
                        <button class="btn btn-primary" onclick="App.copyInviteLink()">Копировать</button>
                    </div>
                    <div class="invite-code-display">
                        <span style="color: var(--text-muted);">Код приглашения:</span>
                        <span style="color: var(--primary); font-weight: 600; font-size: 18px;">${code}</span>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(modal);
        
        // Close on backdrop click
        modal.addEventListener('click', (e) => {
            if (e.target === modal) modal.remove();
        });
    },

    copyInviteLink() {
        const input = document.getElementById('invite-url-input');
        input.select();
        document.execCommand('copy');
        
        // Show feedback
        const btn = input.nextElementSibling;
        const originalText = btn.textContent;
        btn.textContent = 'Скопировано!';
        btn.classList.add('btn-success');
        btn.classList.remove('btn-primary');
        
        setTimeout(() => {
            btn.textContent = originalText;
            btn.classList.remove('btn-success');
            btn.classList.add('btn-primary');
        }, 2000);
    },

    // Join server by invite
    async joinServerByInvite(code) {
        try {
            const { server } = await API.servers.joinByInvite(code);
            Store.addServer(server);
            this.renderServers();
            this.selectServer(server.id);
            alert(`Вы присоединились к серверу "${server.name}"!`);
            
            // Clear URL params
            window.history.replaceState({}, document.title, window.location.pathname);
        } catch (error) {
            console.error('Failed to join server:', error);
            alert(error.message || 'Ошибка присоединения к серверу');
        }
    },

    // Check for invite in URL on load
    checkInviteCode() {
        const params = new URLSearchParams(window.location.search);
        const inviteCode = params.get('invite');
        if (inviteCode) {
            // Wait for auth then join
            setTimeout(() => {
                if (Store.state.token) {
                    this.joinServerByInvite(inviteCode);
                }
            }, 1000);
        }
    }
};

// Make App globally available for WebSocket handlers
window.App = App;
