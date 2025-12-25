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
        
        // Load global mute/deafen state
        this.loadGlobalAudioState();
        
        // Init titlebar for Electron
        this.initTitlebar();
    },

    // Initialize custom titlebar for Electron
    initTitlebar() {
        if (typeof window.electronAPI === 'undefined') return;
        
        const minimizeBtn = document.getElementById('titlebar-minimize');
        const maximizeBtn = document.getElementById('titlebar-maximize');
        const closeBtn = document.getElementById('titlebar-close');
        
        if (minimizeBtn) minimizeBtn.addEventListener('click', () => window.electronAPI.minimizeWindow());
        if (maximizeBtn) maximizeBtn.addEventListener('click', () => window.electronAPI.maximizeWindow());
        if (closeBtn) closeBtn.addEventListener('click', () => window.electronAPI.closeWindow());
        
        // Listen for maximize state changes
        if (window.electronAPI.onMaximizeChange) {
            window.electronAPI.onMaximizeChange((isMaximized) => {
                this.updateMaximizeIcon(isMaximized);
            });
        }
    },

    // Update maximize button icon
    updateMaximizeIcon(isMaximized) {
        const btn = document.getElementById('titlebar-maximize');
        if (!btn) return;
        
        if (isMaximized) {
            btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12"><path fill="none" stroke="currentColor" d="M3.5 8.5v-5h5M1.5 10.5v-5h5v5z"/></svg>';
            btn.title = 'Восстановить';
        } else {
            btn.innerHTML = '<svg width="12" height="12" viewBox="0 0 12 12"><rect fill="none" stroke="currentColor" width="9" height="9" x="1.5" y="1.5"/></svg>';
            btn.title = 'Развернуть';
        }
    },

    // Update titlebar title and icon
    updateTitlebar(title, iconUrl = null) {
        if (typeof window.electronAPI === 'undefined') return;
        
        const titleEl = document.getElementById('titlebar-title');
        const iconEl = document.getElementById('titlebar-icon');
        
        if (titleEl) titleEl.textContent = title;
        
        if (iconEl) {
            if (iconUrl) {
                iconEl.innerHTML = `<img src="${iconUrl}" alt="" style="width: 16px; height: 16px;">`;
            } else {
                iconEl.innerHTML = '<img src="assets/logo-white.svg" alt="Flash" width="16" height="16">';
            }
        }
    },

    // Start periodic status updates every 4 seconds
    startStatusUpdates() {
        if (this.statusUpdateInterval) {
            clearInterval(this.statusUpdateInterval);
        }
        
        this.statusUpdateInterval = setInterval(() => {
            this.refreshFriendsStatus();
            // Also refresh DM sidebar if on home
            if (!Store.state.currentServer) {
                this.refreshDMSidebar();
            }
        }, 4000);
    },

    // Refresh DM sidebar without losing state
    async refreshDMSidebar() {
        try {
            const { friends } = await API.users.getFriends();
            
            // Update existing DM items or add new ones
            const dmList = Utils.$('.dm-list');
            if (!dmList) return;
            
            // Get friend requests count for badge
            let friendRequestsBadge = '';
            try {
                const { incoming } = await API.friends.getRequests();
                if (incoming && incoming.length > 0) {
                    friendRequestsBadge = `<span class="friend-requests-badge">${incoming.length > 99 ? '99+' : incoming.length}</span>`;
                }
            } catch (e) {}
            
            // Update badge on friends button
            const friendsBtn = Utils.$('#friends-nav-btn');
            if (friendsBtn) {
                const existingBadge = friendsBtn.querySelector('.friend-requests-badge');
                if (existingBadge) existingBadge.remove();
                if (friendRequestsBadge) {
                    friendsBtn.insertAdjacentHTML('beforeend', friendRequestsBadge);
                }
            }
            
            // Update DM list
            if (friends.length > 0) {
                const currentDMUserId = Store.state.currentDMUser?.id;
                
                dmList.innerHTML = friends.map(friend => {
                    const avatarStyle = friend.avatar 
                        ? `background-image: url(${friend.avatar}); background-size: cover; background-position: center;`
                        : `background: ${Utils.getUserColor(friend.id)}`;
                    const avatarContent = friend.avatar ? '' : Utils.getInitials(friend.username);
                    const unreadCount = Store.getUnreadDM(friend.id);
                    const unreadBadge = unreadCount > 0 
                        ? `<span class="dm-unread-badge">${unreadCount > 99 ? '99+' : unreadCount}</span>` 
                        : '';
                    const isActive = currentDMUserId === friend.id;
                    return `
                    <div class="dm-item ${isActive ? 'active' : ''}" data-user="${friend.id}">
                        <div class="dm-avatar" style="${avatarStyle}">
                            ${avatarContent}
                            <span class="status-dot ${friend.status || 'offline'}"></span>
                        </div>
                        <div class="dm-info">
                            <div class="dm-name">${Utils.escapeHtml(friend.username)}${unreadBadge}</div>
                        </div>
                    </div>
                `}).join('');
            }
        } catch (e) {
            // Silently fail
        }
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
        // Server tooltip positioning
        document.addEventListener('mouseenter', (e) => {
            const icon = e.target.closest('.server-icon');
            if (icon) {
                const tooltip = icon.querySelector('.server-tooltip');
                if (tooltip) {
                    const rect = icon.getBoundingClientRect();
                    tooltip.style.left = (rect.right + 12) + 'px';
                    tooltip.style.top = (rect.top + rect.height / 2) + 'px';
                    tooltip.style.transform = 'translateY(-50%)';
                }
            }
        }, true);

        // Server list clicks
        Utils.$('#server-list').addEventListener('click', (e) => {
            const icon = e.target.closest('.server-icon');
            if (icon) this.selectServer(icon.dataset.server);
        });

        // Server list right-click (context menu)
        Utils.$('#server-list').addEventListener('contextmenu', (e) => {
            const icon = e.target.closest('.server-icon');
            if (icon) {
                e.preventDefault();
                this.showServerContextMenu(e, icon.dataset.server);
            }
        });

        // Close context menu on click outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.server-context-menu')) {
                this.hideServerContextMenu();
            }
        });

        // Home icon - just show friends view, don't reload sidebar
        Utils.$('.home-icon').addEventListener('click', () => {
            // Only switch to home if not already there
            if (Store.state.currentServer) {
                this.showHome();
            }
        });

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

        // Messages container scroll - track if user scrolled up
        Utils.$('#messages-container')?.addEventListener('scroll', () => {
            this.checkScrollPosition();
        });

        // New messages bar click - scroll to bottom
        Utils.$('#new-messages-bar')?.addEventListener('click', () => {
            this.scrollToBottom();
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

        // Message input for mentions (@)
        Utils.$('#message-input').addEventListener('input', (e) => {
            this.handleMentionInput(e.target);
        });

        // Message input keydown for mentions navigation
        Utils.$('#message-input').addEventListener('keydown', (e) => {
            this.handleMentionKeydown(e);
        });

        // Close mentions popup on click outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.mentions-popup') && !e.target.closest('#message-input')) {
                this.hideMentionsPopup();
            }
        });

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

        // User panel mute button (global mute)
        Utils.$('#user-mute-btn')?.addEventListener('click', () => {
            this.toggleGlobalMute();
        });

        // User panel deafen button (global deafen)
        Utils.$('#user-deafen-btn')?.addEventListener('click', () => {
            this.toggleGlobalDeafen();
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

        // Emoji & GIF picker
        Utils.$('#emoji-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            const picker = Utils.$('#emoji-picker');
            picker.classList.toggle('show');
            
            const rect = e.target.getBoundingClientRect();
            picker.style.bottom = (window.innerHeight - rect.top + 10) + 'px';
            picker.style.right = (window.innerWidth - rect.right) + 'px';
            
            // Load GIF categories when picker opens
            if (picker.classList.contains('show') && !this.gifCategoriesLoaded) {
                this.loadGifCategories();
                this.gifCategoriesLoaded = true;
            }
        });

        // Picker tabs
        Utils.$$('.picker-tab').forEach(tab => {
            tab.addEventListener('click', () => {
                Utils.$$('.picker-tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                
                const tabName = tab.dataset.tab;
                Utils.$$('.picker-content').forEach(c => c.style.display = 'none');
                Utils.$(`#picker-${tabName}`).style.display = 'block';
                
                // Load categories when switching to GIFs tab
                if (tabName === 'gifs' && !this.gifCategoriesLoaded) {
                    this.loadGifCategories();
                    this.gifCategoriesLoaded = true;
                }
                
                // Reset to categories view when switching to GIFs
                if (tabName === 'gifs') {
                    Utils.$('#gif-categories').style.display = 'grid';
                    Utils.$('#gif-results').style.display = 'none';
                    Utils.$('#gif-search').value = '';
                }
            });
        });

        // Emoji click
        Utils.$$('.emoji-item').forEach(item => {
            item.addEventListener('click', () => {
                const input = Utils.$('#message-input');
                input.value += item.textContent;
                input.focus();
                Utils.$('#emoji-picker').classList.remove('show');
            });
        });

        // GIF category click
        Utils.$$('.gif-category').forEach(cat => {
            cat.addEventListener('click', () => {
                const search = cat.dataset.search;
                if (search === '') return; // Favorites
                Utils.$('#gif-search').value = search === 'trending' ? '' : search;
                this.searchGifs(search === 'trending' ? '' : search);
            });
        });

        // GIF search
        let gifSearchTimeout;
        Utils.$('#gif-search')?.addEventListener('input', (e) => {
            clearTimeout(gifSearchTimeout);
            gifSearchTimeout = setTimeout(() => {
                const query = e.target.value.trim();
                if (query) {
                    this.searchGifs(query);
                } else {
                    Utils.$('#gif-categories').style.display = 'grid';
                    Utils.$('#gif-results').style.display = 'none';
                }
            }, 300);
        });

        // Prevent picker from closing when clicking inside it
        Utils.$('#emoji-picker')?.addEventListener('click', (e) => {
            e.stopPropagation();
        });

        // Close emoji picker on outside click
        document.addEventListener('click', (e) => {
            const picker = Utils.$('#emoji-picker');
            if (picker && !picker.contains(e.target) && !e.target.closest('#emoji-btn')) {
                picker.classList.remove('show');
            }
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
        // Mini profile popup
        Utils.$('#user-info-clickable')?.addEventListener('click', (e) => {
            e.stopPropagation();
            this.toggleMiniProfile();
        });

        // Mini profile edit button
        Utils.$('#mini-profile-edit-btn')?.addEventListener('click', () => {
            this.hideMiniProfile();
            this.showModal('settings-modal');
            this.loadSettings();
            this.switchSettingsTab('profile');
        });

        // Status selector click to toggle dropdown
        Utils.$('#status-current')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const dropdown = Utils.$('#status-dropdown');
            dropdown?.classList.toggle('show');
        });

        // Status options
        Utils.$$('.status-option').forEach(option => {
            option.addEventListener('click', () => {
                const status = option.dataset.status;
                this.setUserStatus(status);
                Utils.$('#status-dropdown')?.classList.remove('show');
            });
        });

        // Close mini profile on outside click
        document.addEventListener('click', (e) => {
            const miniProfile = Utils.$('#user-mini-profile');
            const userInfo = Utils.$('#user-info-clickable');
            const statusSelector = Utils.$('#mini-profile-status-selector');
            
            // Close status dropdown if clicking outside
            if (statusSelector && !statusSelector.contains(e.target)) {
                Utils.$('#status-dropdown')?.classList.remove('show');
            }
            
            if (miniProfile?.classList.contains('show') && 
                !miniProfile.contains(e.target) && 
                !userInfo?.contains(e.target)) {
                this.hideMiniProfile();
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

    // Mini Profile Functions
    toggleMiniProfile() {
        const miniProfile = Utils.$('#user-mini-profile');
        if (miniProfile.classList.contains('show')) {
            this.hideMiniProfile();
        } else {
            this.showMiniProfile();
        }
    },

    showMiniProfile() {
        const user = Store.state.user;
        if (!user) return;

        const miniProfile = Utils.$('#user-mini-profile');
        
        // Update banner
        const banner = Utils.$('#mini-profile-banner');
        if (user.banner) {
            banner.style.backgroundImage = `url(${user.banner})`;
            banner.style.backgroundSize = 'cover';
            banner.style.backgroundPosition = 'center';
        } else {
            banner.style.backgroundImage = '';
            banner.style.background = `linear-gradient(135deg, var(--accent-dark), var(--accent))`;
        }

        // Update avatar
        const avatar = Utils.$('#mini-profile-avatar');
        if (user.avatar) {
            avatar.style.backgroundImage = `url(${user.avatar})`;
            avatar.style.backgroundSize = 'cover';
            avatar.style.backgroundPosition = 'center';
            avatar.textContent = '';
        } else {
            avatar.style.backgroundImage = '';
            avatar.style.background = Utils.getUserColor(user.id);
            avatar.textContent = Utils.getInitials(user.username);
        }

        // Update status badge
        const statusBadge = Utils.$('#mini-profile-status-badge');
        const currentStatus = user.status || 'online';
        statusBadge.className = `mini-profile-badge ${currentStatus}`;

        // Update name and tag
        Utils.$('#mini-profile-name').textContent = user.username;
        Utils.$('#mini-profile-tag').textContent = user.tag;

        // Update bio
        Utils.$('#mini-profile-bio').textContent = user.bio || '';

        // Update active status option
        Utils.$$('.status-option').forEach(opt => {
            opt.classList.toggle('active', opt.dataset.status === currentStatus);
        });

        miniProfile.classList.add('show');
    },

    hideMiniProfile() {
        Utils.$('#user-mini-profile')?.classList.remove('show');
    },

    async setUserStatus(status) {
        try {
            await API.users.updateStatus(status);
            Store.state.user.status = status;
            
            // Update status badge in mini profile
            const statusBadge = Utils.$('#mini-profile-status-badge');
            statusBadge.className = `mini-profile-badge ${status}`;

            // Update active status option
            Utils.$$('.status-option').forEach(opt => {
                opt.classList.toggle('active', opt.dataset.status === status);
            });

            // Update user avatar status dot
            const avatarEl = Utils.$('#user-avatar');
            if (avatarEl) {
                // Remove old status class and add new one
                avatarEl.className = `user-avatar status-${status}`;
            }

            this.hideMiniProfile();
        } catch (e) {
            console.error('Failed to update status:', e);
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
        container.innerHTML = Store.state.servers.map(server => {
            const isActive = server.id === Store.state.currentServer?.id;
            const hasUnread = this.serverUnreadMessages[server.id] > 0;
            const isMuted = this.isServerMuted(server.id);
            return Components.serverIcon(server, isActive, hasUnread, isMuted);
        }).join('');
    },

    async selectServer(serverId) {
        this.stopFriendsRefresh();
        const server = Store.state.servers.find(s => s.id === serverId);
        if (!server) return;

        // Clear unread messages for this server
        this.markServerAsRead(serverId);

        Store.setCurrentServer(server);
        this.renderServers();
        
        Utils.$('#server-name').textContent = server.name;
        
        // Update titlebar with server name and icon
        this.updateTitlebar(server.name, server.icon || null);

        // Show skeleton loading immediately
        this.showChannelsSkeleton();
        this.showMembersSkeleton();
        this.showMessagesSkeleton();

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

    // Show skeleton loading for channels
    showChannelsSkeleton() {
        const container = Utils.$('#channel-list');
        if (!container) return;
        container.innerHTML = `
            <div class="skeleton-channel"><div class="skeleton skeleton-channel-icon"></div><div class="skeleton skeleton-channel-name" style="width: 70%"></div></div>
            <div class="skeleton-channel"><div class="skeleton skeleton-channel-icon"></div><div class="skeleton skeleton-channel-name" style="width: 85%"></div></div>
            <div class="skeleton-channel"><div class="skeleton skeleton-channel-icon"></div><div class="skeleton skeleton-channel-name" style="width: 60%"></div></div>
            <div class="skeleton-channel"><div class="skeleton skeleton-channel-icon"></div><div class="skeleton skeleton-channel-name" style="width: 75%"></div></div>
        `;
    },

    // Show skeleton loading for members
    showMembersSkeleton() {
        const container = Utils.$('#members-list');
        if (!container) return;
        container.innerHTML = `
            <div class="skeleton-member"><div class="skeleton skeleton-member-avatar"></div><div class="skeleton skeleton-member-name" style="width: 90px"></div></div>
            <div class="skeleton-member"><div class="skeleton skeleton-member-avatar"></div><div class="skeleton skeleton-member-name" style="width: 70px"></div></div>
            <div class="skeleton-member"><div class="skeleton skeleton-member-avatar"></div><div class="skeleton skeleton-member-name" style="width: 100px"></div></div>
            <div class="skeleton-member"><div class="skeleton skeleton-member-avatar"></div><div class="skeleton skeleton-member-name" style="width: 80px"></div></div>
            <div class="skeleton-member"><div class="skeleton skeleton-member-avatar"></div><div class="skeleton skeleton-member-name" style="width: 95px"></div></div>
        `;
    },

    // Show skeleton loading for messages
    showMessagesSkeleton() {
        this.restoreChatStructure();
        const container = Utils.$('#messages-list');
        if (!container) return;
        container.innerHTML = `
            <div class="skeleton-message"><div class="skeleton skeleton-avatar"></div><div class="skeleton-content"><div class="skeleton skeleton-name"></div><div class="skeleton skeleton-text"></div><div class="skeleton skeleton-text"></div></div></div>
            <div class="skeleton-message"><div class="skeleton skeleton-avatar"></div><div class="skeleton-content"><div class="skeleton skeleton-name" style="width: 90px"></div><div class="skeleton skeleton-text" style="width: 80%"></div></div></div>
            <div class="skeleton-message"><div class="skeleton skeleton-avatar"></div><div class="skeleton-content"><div class="skeleton skeleton-name" style="width: 140px"></div><div class="skeleton skeleton-text" style="width: 95%"></div><div class="skeleton skeleton-text" style="width: 60%"></div></div></div>
            <div class="skeleton-message"><div class="skeleton skeleton-avatar"></div><div class="skeleton-content"><div class="skeleton skeleton-name" style="width: 100px"></div><div class="skeleton skeleton-text" style="width: 75%"></div></div></div>
        `;
    },

    // Show skeleton loading for DM sidebar
    showDMSidebarSkeleton() {
        const container = Utils.$('.dm-list');
        if (!container) return;
        container.innerHTML = `
            <div class="skeleton-dm"><div class="skeleton skeleton-dm-avatar"></div><div class="skeleton-dm-info"><div class="skeleton skeleton-dm-name" style="width: 80%"></div></div></div>
            <div class="skeleton-dm"><div class="skeleton skeleton-dm-avatar"></div><div class="skeleton-dm-info"><div class="skeleton skeleton-dm-name" style="width: 65%"></div></div></div>
            <div class="skeleton-dm"><div class="skeleton skeleton-dm-avatar"></div><div class="skeleton-dm-info"><div class="skeleton skeleton-dm-name" style="width: 90%"></div></div></div>
            <div class="skeleton-dm"><div class="skeleton skeleton-dm-avatar"></div><div class="skeleton-dm-info"><div class="skeleton skeleton-dm-name" style="width: 70%"></div></div></div>
        `;
    },

    // Show skeleton loading for friends list
    showFriendsSkeleton() {
        const container = Utils.$('#messages-container');
        if (!container) return;
        container.innerHTML = `
            <div class="friends-view" style="padding: 20px;">
                <div class="skeleton-friend"><div class="skeleton skeleton-friend-avatar"></div><div class="skeleton-friend-info"><div class="skeleton skeleton-friend-name"></div><div class="skeleton skeleton-friend-status"></div></div><div class="skeleton-friend-actions"><div class="skeleton skeleton-friend-btn"></div><div class="skeleton skeleton-friend-btn"></div></div></div>
                <div class="skeleton-friend"><div class="skeleton skeleton-friend-avatar"></div><div class="skeleton-friend-info"><div class="skeleton skeleton-friend-name" style="width: 100px"></div><div class="skeleton skeleton-friend-status"></div></div><div class="skeleton-friend-actions"><div class="skeleton skeleton-friend-btn"></div><div class="skeleton skeleton-friend-btn"></div></div></div>
                <div class="skeleton-friend"><div class="skeleton skeleton-friend-avatar"></div><div class="skeleton-friend-info"><div class="skeleton skeleton-friend-name" style="width: 140px"></div><div class="skeleton skeleton-friend-status"></div></div><div class="skeleton-friend-actions"><div class="skeleton skeleton-friend-btn"></div><div class="skeleton skeleton-friend-btn"></div></div></div>
            </div>
        `;
    },

    // Show skeleton loading for search results
    showSearchSkeleton() {
        const container = Utils.$('#search-results');
        if (!container) return;
        container.innerHTML = `
            <div class="skeleton-search"><div class="skeleton skeleton-search-avatar"></div><div class="skeleton skeleton-search-name"></div></div>
            <div class="skeleton-search"><div class="skeleton skeleton-search-avatar"></div><div class="skeleton skeleton-search-name" style="width: 100px"></div></div>
            <div class="skeleton-search"><div class="skeleton skeleton-search-avatar"></div><div class="skeleton skeleton-search-name" style="width: 160px"></div></div>
        `;
    },

    // Show skeleton loading for user profile
    showProfileSkeleton() {
        const modal = Utils.$('#user-profile-modal');
        if (!modal) return;
        const banner = modal.querySelector('.profile-banner');
        const avatar = modal.querySelector('.profile-avatar');
        const name = modal.querySelector('.profile-name');
        const tag = modal.querySelector('.profile-tag');
        const bio = modal.querySelector('.profile-bio');
        
        if (banner) banner.innerHTML = '<div class="skeleton" style="width: 100%; height: 100%; border-radius: 8px 8px 0 0;"></div>';
        if (avatar) avatar.innerHTML = '<div class="skeleton" style="width: 100%; height: 100%; border-radius: 50%;"></div>';
        if (name) name.innerHTML = '<div class="skeleton" style="width: 120px; height: 20px;"></div>';
        if (tag) tag.innerHTML = '<div class="skeleton" style="width: 80px; height: 14px;"></div>';
        if (bio) bio.innerHTML = '<div class="skeleton" style="width: 180px; height: 14px;"></div>';
    },

    renderChannels() {
        const container = Utils.$('#channel-list');
        const textChannels = Store.state.channels.filter(c => c.type === 'text');
        const voiceChannels = Store.state.channels.filter(c => c.type === 'voice');

        container.innerHTML = `
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

        // Stop friends view refresh
        this.stopFriendsRefresh();

        // Reset new messages bar
        this.hideNewMessagesBar();
        this.isUserScrolledUp = false;

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

        // Show skeleton loading for messages
        this.showMessagesSkeleton();

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

    // Restore chat structure if friends view was shown
    restoreChatStructure() {
        // Show header when leaving friends view
        Utils.$('.content-header')?.classList.remove('friends-view-header');
        const mc = Utils.$('#messages-container');
        if (!mc) return;
        // Check if messages-list exists, if not - restore it
        if (!Utils.$('#messages-list')) {
            mc.innerHTML = '<div class="messages-list" id="messages-list"></div>';
        }
    },

    // Messages
    async renderMessages() {
        // Restore chat structure first
        this.restoreChatStructure();
        
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

    // Append single message without re-rendering entire list (for real-time updates)
    appendMessage(message) {
        const container = Utils.$('#messages-list');
        if (!container) return;

        const messages = Store.state.messages;
        const prevMsg = messages.length > 1 ? messages[messages.length - 2] : null;
        const isGrouped = Utils.shouldGroupMessages(prevMsg, message);
        
        // Use decrypted content if available
        const displayMsg = { ...message, content: message.decryptedContent || message.content };
        let messageHtml = Components.message(displayMsg, isGrouped);
        
        // Add new-message class for animation
        messageHtml = messageHtml.replace('class="message', 'class="message new-message');
        
        // Append to container
        container.insertAdjacentHTML('beforeend', messageHtml);
        
        // Remove animation class after animation completes
        setTimeout(() => {
            const lastMsg = container.lastElementChild;
            if (lastMsg) lastMsg.classList.remove('new-message');
        }, 250);
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

    // New messages tracking
    newMessagesCount: 0,
    newMessagesFirstTime: null,
    isUserScrolledUp: false,

    scrollToBottom() {
        const container = Utils.$('#messages-container');
        container.scrollTop = container.scrollHeight;
        this.hideNewMessagesBar();
    },

    // Check if user is scrolled up from bottom
    checkScrollPosition() {
        const container = Utils.$('#messages-container');
        if (!container) return false;
        const threshold = 100; // pixels from bottom
        const isAtBottom = container.scrollHeight - container.scrollTop - container.clientHeight < threshold;
        this.isUserScrolledUp = !isAtBottom;
        
        // Hide bar if user scrolled to bottom
        if (isAtBottom) {
            this.hideNewMessagesBar();
        }
        return this.isUserScrolledUp;
    },

    // Show new messages bar
    showNewMessagesBar(count, firstTime) {
        const bar = Utils.$('#new-messages-bar');
        const textEl = Utils.$('#new-messages-text');
        if (!bar || !textEl) return;

        this.newMessagesCount = count;
        this.newMessagesFirstTime = firstTime;

        // Format time
        const time = new Date(firstTime).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        
        // Plural form
        let msgWord = 'сообщение';
        if (count > 1 && count < 5) msgWord = 'сообщения';
        else if (count >= 5 || count === 0) msgWord = 'сообщений';
        
        textEl.textContent = `${count} новое ${msgWord} с ${time}`;
        bar.classList.add('show');
    },

    // Hide new messages bar
    hideNewMessagesBar() {
        const bar = Utils.$('#new-messages-bar');
        if (bar) {
            bar.classList.remove('show');
        }
        this.newMessagesCount = 0;
        this.newMessagesFirstTime = null;
    },

    // Add new message while scrolled up
    addNewMessageWhileScrolledUp(message) {
        if (!this.newMessagesFirstTime) {
            this.newMessagesFirstTime = message.created_at || new Date().toISOString();
        }
        this.newMessagesCount++;
        this.showNewMessagesBar(this.newMessagesCount, this.newMessagesFirstTime);
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
        const currentUserId = Store.state.user?.id;
        const currentUserStatus = Store.state.user?.status || 'online';
        
        // Update current user's status in members list
        const membersWithCorrectStatus = Store.state.members.map(m => {
            if (m.id === currentUserId) {
                return { ...m, status: currentUserStatus };
            }
            return m;
        });
        
        container.innerHTML = membersWithCorrectStatus.map(m => Components.memberItem(m)).join('');
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

        // Show skeleton while loading
        this.showSearchSkeleton();

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
        
        // Load audio devices when switching to audio tab
        if (section === 'audio') {
            this.loadAudioSettings();
        }
    },

    // Audio settings
    audioTestStream: null,
    audioAnalyser: null,
    audioMeterInterval: null,

    async loadAudioSettings() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const audioInputs = devices.filter(d => d.kind === 'audioinput');
            const audioOutputs = devices.filter(d => d.kind === 'audiooutput');
            
            const savedSettings = Utils.storage.get('flash_audio_settings') || {};
            
            const inputSelect = Utils.$('#settings-audio-input');
            if (inputSelect) {
                inputSelect.innerHTML = audioInputs.map(d => 
                    `<option value="${d.deviceId}" ${d.deviceId === savedSettings.inputDevice ? 'selected' : ''}>${d.label || 'Микрофон ' + (audioInputs.indexOf(d) + 1)}</option>`
                ).join('');
            }
            
            const outputSelect = Utils.$('#settings-audio-output');
            if (outputSelect) {
                outputSelect.innerHTML = audioOutputs.map(d => 
                    `<option value="${d.deviceId}" ${d.deviceId === savedSettings.outputDevice ? 'selected' : ''}>${d.label || 'Динамик ' + (audioOutputs.indexOf(d) + 1)}</option>`
                ).join('');
            }
            
            Utils.$('#settings-mic-volume').value = savedSettings.micVolume ?? 100;
            Utils.$('#settings-mic-volume-value').textContent = (savedSettings.micVolume ?? 100) + '%';
            Utils.$('#settings-output-volume').value = savedSettings.outputVolume ?? 100;
            Utils.$('#settings-output-volume-value').textContent = (savedSettings.outputVolume ?? 100) + '%';
            
            Utils.$('#settings-noise-suppression').checked = savedSettings.noiseSuppression ?? true;
            Utils.$('#settings-echo-cancellation').checked = savedSettings.echoCancellation ?? true;
            Utils.$('#settings-auto-gain').checked = savedSettings.autoGain ?? true;
            
            // Store initial values for change detection
            this.initialAudioSettings = {
                inputDevice: Utils.$('#settings-audio-input')?.value || '',
                outputDevice: Utils.$('#settings-audio-output')?.value || '',
                micVolume: parseInt(Utils.$('#settings-mic-volume')?.value) || 100,
                outputVolume: parseInt(Utils.$('#settings-output-volume')?.value) || 100,
                noiseSuppression: Utils.$('#settings-noise-suppression')?.checked ?? true,
                echoCancellation: Utils.$('#settings-echo-cancellation')?.checked ?? true,
                autoGain: Utils.$('#settings-auto-gain')?.checked ?? true
            };
            
            this.bindAudioSettingsEvents();
        } catch (e) {
            console.error('Failed to load audio devices:', e);
        }
    },

    bindAudioSettingsEvents() {
        Utils.$('#settings-mic-volume')?.addEventListener('input', (e) => {
            Utils.$('#settings-mic-volume-value').textContent = e.target.value + '%';
        });
        
        Utils.$('#settings-output-volume')?.addEventListener('input', (e) => {
            Utils.$('#settings-output-volume-value').textContent = e.target.value + '%';
        });
        
        const testBtn = Utils.$('#settings-mic-test-btn');
        if (testBtn && !testBtn.dataset.bound) {
            testBtn.dataset.bound = 'true';
            testBtn.addEventListener('click', () => this.toggleMicTest());
        }
        
        const saveBtn = Utils.$('#settings-audio-save');
        if (saveBtn && !saveBtn.dataset.bound) {
            saveBtn.dataset.bound = 'true';
            saveBtn.addEventListener('click', () => this.saveAudioSettings());
        }
    },

    async toggleMicTest() {
        const btn = Utils.$('#settings-mic-test-btn');
        const meterFill = Utils.$('#settings-mic-meter-fill');
        
        if (this.audioTestStream) {
            // Stop test
            if (this.audioTestRawStream) {
                this.audioTestRawStream.getTracks().forEach(t => t.stop());
                this.audioTestRawStream = null;
            }
            this.audioTestStream.getTracks().forEach(t => t.stop());
            this.audioTestStream = null;
            if (this.audioTestContext) {
                try { this.audioTestContext.close(); } catch(e) {}
                this.audioTestContext = null;
            }
            if (this.audioMeterInterval) {
                clearInterval(this.audioMeterInterval);
                this.audioMeterInterval = null;
            }
            btn.textContent = 'Проверить микрофон';
            btn.classList.remove('btn-danger');
            btn.classList.add('btn-secondary');
            meterFill.style.width = '0%';
            return;
        }
        
        try {
            const deviceId = Utils.$('#settings-audio-input')?.value;
            const noiseSuppression = Utils.$('#settings-noise-suppression')?.checked ?? true;
            const echoCancellation = Utils.$('#settings-echo-cancellation')?.checked ?? true;
            const autoGain = Utils.$('#settings-auto-gain')?.checked ?? true;
            const micVolume = parseInt(Utils.$('#settings-mic-volume')?.value) || 100;
            
            // Get raw stream
            this.audioTestRawStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    deviceId: deviceId ? { exact: deviceId } : undefined,
                    noiseSuppression: noiseSuppression,
                    echoCancellation: echoCancellation,
                    autoGainControl: autoGain,
                    sampleRate: 48000,
                    sampleSize: 16,
                    channelCount: 1
                }
            });
            
            btn.textContent = 'Остановить';
            btn.classList.remove('btn-secondary');
            btn.classList.add('btn-danger');
            
            // Create audio processing chain (same as in calls)
            this.audioTestContext = new (window.AudioContext || window.webkitAudioContext)({
                sampleRate: 48000
            });
            const source = this.audioTestContext.createMediaStreamSource(this.audioTestRawStream);
            
            // High-pass filter to remove low frequency rumble
            const highpass = this.audioTestContext.createBiquadFilter();
            highpass.type = 'highpass';
            highpass.frequency.value = 80;
            highpass.Q.value = 0.7;
            
            // Low-pass filter to remove high frequency hiss
            const lowpass = this.audioTestContext.createBiquadFilter();
            lowpass.type = 'lowpass';
            lowpass.frequency.value = 12000;
            lowpass.Q.value = 0.7;
            
            // Compressor for dynamic range control
            const compressor = this.audioTestContext.createDynamicsCompressor();
            compressor.threshold.value = -24;
            compressor.knee.value = 12;
            compressor.ratio.value = 4;
            compressor.attack.value = 0.003;
            compressor.release.value = 0.25;
            
            // Gain node for volume
            const gainNode = this.audioTestContext.createGain();
            gainNode.gain.value = micVolume / 100;
            this.audioTestGainNode = gainNode;
            
            // Create destination for processed stream
            const destination = this.audioTestContext.createMediaStreamDestination();
            
            // Connect chain: source -> highpass -> lowpass -> compressor -> gain -> destination
            source.connect(highpass);
            highpass.connect(lowpass);
            lowpass.connect(compressor);
            compressor.connect(gainNode);
            gainNode.connect(destination);
            
            // Store processed stream
            this.audioTestStream = destination.stream;
            
            // Analyser for meter (connected after gain)
            this.audioAnalyser = this.audioTestContext.createAnalyser();
            this.audioAnalyser.fftSize = 256;
            gainNode.connect(this.audioAnalyser);
            
            const dataArray = new Uint8Array(this.audioAnalyser.frequencyBinCount);
            
            this.audioMeterInterval = setInterval(() => {
                if (!this.audioAnalyser) return;
                this.audioAnalyser.getByteFrequencyData(dataArray);
                const avg = dataArray.reduce((a, b) => a + b, 0) / dataArray.length;
                const volume = Math.min(100, (avg / 128) * 100);
                meterFill.style.width = volume + '%';
                
                // Update gain in real-time
                const currentVolume = parseInt(Utils.$('#settings-mic-volume')?.value) || 100;
                if (this.audioTestGainNode) {
                    this.audioTestGainNode.gain.value = currentVolume / 100;
                }
            }, 50);
            
        } catch (e) {
            console.error('Failed to start mic test:', e);
            alert('Не удалось получить доступ к микрофону');
        }
    },

    saveAudioSettings() {
        const settings = {
            inputDevice: Utils.$('#settings-audio-input')?.value || '',
            outputDevice: Utils.$('#settings-audio-output')?.value || '',
            micVolume: parseInt(Utils.$('#settings-mic-volume')?.value) || 100,
            outputVolume: parseInt(Utils.$('#settings-output-volume')?.value) || 100,
            noiseSuppression: Utils.$('#settings-noise-suppression')?.checked ?? true,
            echoCancellation: Utils.$('#settings-echo-cancellation')?.checked ?? true,
            autoGain: Utils.$('#settings-auto-gain')?.checked ?? true
        };
        
        // Check if settings changed from initial values (when settings were loaded)
        const initial = this.initialAudioSettings || {};
        const hasChanges = 
            settings.inputDevice !== initial.inputDevice ||
            settings.outputDevice !== initial.outputDevice ||
            settings.micVolume !== initial.micVolume ||
            settings.outputVolume !== initial.outputVolume ||
            settings.noiseSuppression !== initial.noiseSuppression ||
            settings.echoCancellation !== initial.echoCancellation ||
            settings.autoGain !== initial.autoGain;
        
        if (!hasChanges) {
            return; // Nothing changed, don't show success
        }
        
        Utils.storage.set('flash_audio_settings', settings);
        
        // Update initial settings to current (so next save won't trigger if nothing changed)
        this.initialAudioSettings = { ...settings };
        
        if (window.Voice) {
            Voice.settings = {
                ...Voice.settings,
                inputDevice: settings.inputDevice,
                outputDevice: settings.outputDevice,
                inputVolume: settings.micVolume,
                outputVolume: settings.outputVolume,
                noiseSuppression: settings.noiseSuppression,
                echoCancellation: settings.echoCancellation,
                autoGainControl: settings.autoGain
            };
            Voice.saveSettings();
            
            // Update gain node if audio processing is active
            if (Voice.inputGainNode) {
                Voice.inputGainNode.gain.value = settings.micVolume / 100;
            }
        }
        
        const btn = Utils.$('#settings-audio-save');
        const originalText = btn.textContent;
        btn.textContent = 'Сохранено!';
        btn.classList.add('btn-success');
        setTimeout(() => {
            btn.textContent = originalText;
            btn.classList.remove('btn-success');
        }, 2000);
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

    // Home view - renders DM sidebar (Discord style)
    async showHome() {
        Utils.$$('.server-icon').forEach(i => i.classList.remove('active'));
        Utils.$('.home-icon').classList.add('active');
        Utils.$('#server-name').textContent = 'Личные сообщения';
        
        Store.setCurrentServer(null);
        Store.setCurrentChannel(null);
        
        // Render DM sidebar
        await this.renderDMSidebar();
        
        // If no DM is open, show friends view
        if (!Store.state.currentDM) {
            this.showFriendsView();
        }
    },

    // Render DM sidebar (always visible when home is selected)
    async renderDMSidebar() {
        // Show skeleton immediately
        this.showDMSidebarSkeleton();
        
        try {
            const { friends } = await API.users.getFriends();
            
            // Get friend requests count for badge
            let friendRequestsBadge = '';
            try {
                const { incoming } = await API.friends.getRequests();
                if (incoming && incoming.length > 0) {
                    friendRequestsBadge = `<span class="friend-requests-badge">${incoming.length > 99 ? '99+' : incoming.length}</span>`;
                }
            } catch (e) {}
            
            // Check if friends view is active
            const isFriendsActive = !Store.state.currentDM;
            
            let dmListHtml = '';
            if (friends.length > 0) {
                dmListHtml = friends.map(friend => {
                    const avatarStyle = friend.avatar 
                        ? `background-image: url(${friend.avatar}); background-size: cover; background-position: center;`
                        : `background: ${Utils.getUserColor(friend.id)}`;
                    const avatarContent = friend.avatar ? '' : Utils.getInitials(friend.username);
                    const unreadCount = Store.getUnreadDM(friend.id);
                    const unreadBadge = unreadCount > 0 
                        ? `<span class="dm-unread-badge">${unreadCount > 99 ? '99+' : unreadCount}</span>` 
                        : '';
                    const isActive = Store.state.currentDMUser?.id === friend.id;
                    return `
                    <div class="dm-item ${isActive ? 'active' : ''}" data-user="${friend.id}">
                        <div class="dm-avatar" style="${avatarStyle}">
                            ${avatarContent}
                            <span class="status-dot ${friend.status || 'offline'}"></span>
                        </div>
                        <div class="dm-info">
                            <div class="dm-name">${Utils.escapeHtml(friend.username)}${unreadBadge}</div>
                        </div>
                    </div>
                `}).join('');
            }
            
            Utils.$('#channel-list').innerHTML = `
                <div class="dm-search-btn" id="dm-search-btn">
                    <span>Найти или начать беседу</span>
                </div>
                <div class="dm-nav-item ${isFriendsActive ? 'active' : ''}" id="friends-nav-btn">
                    <svg viewBox="0 0 24 24" width="24" height="24">
                        <path fill="currentColor" d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
                    </svg>
                    <span>Друзья</span>
                    ${friendRequestsBadge}
                </div>
                <div class="dm-section-header">
                    <span>Личные сообщения</span>
                </div>
                <div class="dm-list">${dmListHtml}</div>
            `;
            
            // Bind events
            Utils.$('#dm-search-btn')?.addEventListener('click', () => this.openSearchModal());
            Utils.$('#friends-nav-btn')?.addEventListener('click', () => this.showFriendsView());
            
        } catch (error) {
            console.error('Failed to load DM sidebar:', error);
            Utils.$('#channel-list').innerHTML = `
                <div class="dm-search-btn" id="dm-search-btn">
                    <span>Найти или начать беседу</span>
                </div>
                <div class="dm-nav-item active" id="friends-nav-btn">
                    <svg viewBox="0 0 24 24" width="24" height="24">
                        <path fill="currentColor" d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/>
                    </svg>
                    <span>Друзья</span>
                </div>
                <div class="dm-section-header">
                    <span>Личные сообщения</span>
                </div>
                <div class="dm-list">
                    <p style="color: var(--text-muted); text-align: center; padding: 20px; font-size: 13px;">
                        Ошибка загрузки
                    </p>
                </div>
            `;
            Utils.$('#dm-search-btn')?.addEventListener('click', () => this.openSearchModal());
            Utils.$('#friends-nav-btn')?.addEventListener('click', () => this.showFriendsView());
        }
    },

    // Show friends view in main content area
    friendsViewActive: false,
    friendsRefreshInterval: null,

    showFriendsView() {
        this.updateTitlebar('Друзья');
        Store.state.currentDM = null;
        Store.state.currentDMUser = null;
        Utils.$$('.dm-nav-item').forEach(el => el.classList.remove('active'));
        Utils.$('#friends-nav-btn')?.classList.add('active');
        Utils.$$('.dm-item').forEach(el => el.classList.remove('active'));
        Utils.$('.main-content')?.classList.remove('no-chat');
        // Hide header for friends view
        Utils.$('.content-header')?.classList.add('friends-view-header');
        this.friendsViewActive = true;
        this.renderFriendsView(true);
        this.startFriendsRefresh();
    },

    stopFriendsRefresh() {
        this.friendsViewActive = false;
        if (this.friendsRefreshInterval) {
            clearInterval(this.friendsRefreshInterval);
            this.friendsRefreshInterval = null;
        }
    },

    startFriendsRefresh() {
        if (this.friendsRefreshInterval) clearInterval(this.friendsRefreshInterval);
        this.friendsViewActive = true;
        this.friendsRefreshInterval = setInterval(() => {
            if (this.friendsViewActive) this.renderFriendsView();
        }, 3000);
    },

    friendsFilter: 'online',
    friendsSearchQuery: '',

    async renderFriendsView(showSkeleton = false) {
        const mc = Utils.$('#messages-container');
        if (!mc) return;
        Utils.$('.message-input-container')?.style.setProperty('display', 'none');
        Utils.$('#channel-hash').style.display = 'none';
        Utils.$('#current-channel-name').textContent = '';
        
        // Show skeleton only on first load
        if (showSkeleton) {
            this.showFriendsSkeleton();
        }
        
        try {
            const { friends } = await API.users.getFriends();
            const { incoming, outgoing } = await API.friends.getRequests();
            let filtered = this.friendsFilter === 'online' ? friends.filter(f => f.status === 'online' || f.status === 'idle' || f.status === 'dnd') : friends;
            if (this.friendsSearchQuery) filtered = filtered.filter(f => f.username.toLowerCase().includes(this.friendsSearchQuery.toLowerCase()));
            const onlineCount = friends.filter(f => f.status === 'online' || f.status === 'idle' || f.status === 'dnd').length;
            const pendingCount = incoming.length + outgoing.length;
            mc.innerHTML = '<div class="friends-view"><div class="friends-header"><div class="friends-header-left"><svg class="friends-icon" viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5c-1.66 0-3 1.34-3 3s1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5C6.34 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5c0-2.33-4.67-3.5-7-3.5zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z"/></svg><span class="friends-title">Друзья</span><div class="friends-tabs"><button class="friends-tab ' + (this.friendsFilter === 'online' ? 'active' : '') + '" data-filter="online">В сети</button><button class="friends-tab ' + (this.friendsFilter === 'all' ? 'active' : '') + '" data-filter="all">Все</button><button class="friends-tab ' + (this.friendsFilter === 'pending' ? 'active' : '') + '" data-filter="pending">Ожидание' + (pendingCount > 0 ? ' <span class="pending-badge">' + pendingCount + '</span>' : '') + '</button></div></div><button class="friends-add-btn" id="friends-add-btn">Добавить в друзья</button></div><div class="friends-search"><svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg><input type="text" placeholder="Поиск" id="friends-search-input" value="' + this.friendsSearchQuery + '"></div><div class="friends-count">' + (this.friendsFilter === 'online' ? 'В сети' : this.friendsFilter === 'pending' ? 'Ожидание' : 'Все друзья') + '  ' + (this.friendsFilter === 'pending' ? pendingCount : (this.friendsFilter === 'online' ? onlineCount : friends.length)) + '</div><div class="friends-list-content">' + (this.friendsFilter === 'pending' ? this.renderPendingRequests(incoming, outgoing) : this.renderFriendsList(filtered)) + '</div></div>';
            this.bindFriendsViewEvents();
        } catch (e) { mc.innerHTML = '<div class="friends-view"><div class="friends-error">Ошибка загрузки</div></div>'; }
    },

    renderFriendsList(friends) {
        if (!friends.length) return '<div class="friends-empty">Нет друзей' + (this.friendsFilter === 'online' ? ' в сети' : '') + '</div>';
        return friends.map(f => '<div class="friend-row" data-user-id="' + f.id + '"><div class="friend-row-left"><div class="friend-row-avatar" style="' + (f.avatar ? 'background-image:url(' + f.avatar + ');background-size:cover' : 'background:' + Utils.getUserColor(f.id)) + '">' + (f.avatar ? '' : Utils.getInitials(f.username)) + '<span class="status-indicator ' + (f.status || 'offline') + '"></span></div><div class="friend-row-info"><div class="friend-row-name">' + Utils.escapeHtml(f.username) + '</div><div class="friend-row-status">' + this.getStatusText(f.status) + '</div></div></div><div class="friend-row-actions"><button class="friend-action-btn" data-action="chat" title="Написать"><svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H6l-2 2V4h16v12z"/></svg></button><button class="friend-action-btn" data-action="more" title="Ещё"><svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z"/></svg></button></div></div>').join('');
    },

    renderPendingRequests(inc, out) {
        if (!inc.length && !out.length) return '<div class="friends-empty">Нет ожидающих запросов</div>';
        let h = '';
        if (inc.length) { h += '<div class="pending-section-title">Входящие  ' + inc.length + '</div>'; h += inc.map(r => '<div class="friend-row" data-user-id="' + r.id + '"><div class="friend-row-left"><div class="friend-row-avatar" style="' + (r.avatar ? 'background-image:url(' + r.avatar + ');background-size:cover' : 'background:' + Utils.getUserColor(r.id)) + '">' + (r.avatar ? '' : Utils.getInitials(r.username)) + '</div><div class="friend-row-info"><div class="friend-row-name">' + Utils.escapeHtml(r.username) + '</div><div class="friend-row-status">Входящий запрос</div></div></div><div class="friend-row-actions"><button class="friend-action-btn accept" data-action="accept" title="Принять"><svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg></button><button class="friend-action-btn decline" data-action="decline" title="Отклонить"><svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></button></div></div>').join(''); }
        if (out.length) { h += '<div class="pending-section-title">Исходящие  ' + out.length + '</div>'; h += out.map(r => '<div class="friend-row" data-user-id="' + r.id + '"><div class="friend-row-left"><div class="friend-row-avatar" style="' + (r.avatar ? 'background-image:url(' + r.avatar + ');background-size:cover' : 'background:' + Utils.getUserColor(r.id)) + '">' + (r.avatar ? '' : Utils.getInitials(r.username)) + '</div><div class="friend-row-info"><div class="friend-row-name">' + Utils.escapeHtml(r.username) + '</div><div class="friend-row-status">Исходящий запрос</div></div></div><div class="friend-row-actions"><button class="friend-action-btn decline" data-action="cancel" title="Отменить"><svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg></button></div></div>').join(''); }
        return h;
    },

    bindFriendsViewEvents() {
        Utils.$$('.friends-tab').forEach(t => t.addEventListener('click', () => { this.friendsFilter = t.dataset.filter; this.renderFriendsView(); }));
        Utils.$('#friends-search-input')?.addEventListener('input', Utils.debounce(e => { this.friendsSearchQuery = e.target.value; this.renderFriendsView(); }, 300));
        Utils.$('#friends-add-btn')?.addEventListener('click', () => { this.showModal('search-modal'); Utils.$('#user-search-input')?.focus(); });
        Utils.$$('.friend-row').forEach(r => r.addEventListener('click', e => { const a = e.target.closest('.friend-action-btn')?.dataset.action, id = r.dataset.userId; if (a === 'chat') this.openDM(id); else if (a === 'accept') this.acceptFriendRequest(id); else if (a === 'decline' || a === 'cancel') this.declineFriendRequest(id); else if (!a) this.openDM(id); }));
    },

    async acceptFriendRequest(id) { try { await API.friends.accept(id); this.renderFriendsView(); this.refreshDMSidebar(); } catch(e) {} },
    async declineFriendRequest(id) { try { await API.friends.decline(id); this.renderFriendsView(); } catch(e) {} },

    // Open search modal
    openSearchModal() {
        this.showModal('search-modal');
        Utils.$('#user-search-input')?.focus();
    },

    // GIF categories that rotate daily
    gifCategories: [
        ['смешно', 'грустно', 'танец', 'любовь', 'злой', 'шок'],
        ['привет', 'пока', 'спасибо', 'да', 'нет', 'думаю'],
        ['кот', 'собака', 'аниме', 'мем', 'реакция', 'праздник'],
        ['счастье', 'плачу', 'обнимашки', 'поцелуй', 'победа', 'провал'],
        ['нервный', 'милый', 'страшно', 'круто', 'скучно', 'сон'],
        ['еда', 'кофе', 'работа', 'отдых', 'спорт', 'музыка'],
        ['удивление', 'смущение', 'гнев', 'радость', 'грусть', 'страх']
    ],

    // Load GIF categories with previews
    async loadGifCategories() {
        const container = Utils.$('#gif-categories');
        if (!container) return;
        
        // Get today's categories based on day of year
        const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0)) / 86400000);
        const categorySet = this.gifCategories[dayOfYear % this.gifCategories.length];
        
        // Build categories HTML
        let html = `
            <div class="gif-category" data-search="">
                <div class="gif-category-bg favorites"></div>
                <span>⭐ Избранное</span>
            </div>
            <div class="gif-category" data-search="trending">
                <div class="gif-category-bg trending"></div>
                <span>📈 Популярные</span>
            </div>
        `;
        
        // Add dynamic categories
        categorySet.forEach(cat => {
            html += `
                <div class="gif-category" data-search="${cat}">
                    <div class="gif-category-bg" data-category="${cat}"></div>
                    <span>${cat}</span>
                </div>
            `;
        });
        
        container.innerHTML = html;
        
        // Bind click events
        container.querySelectorAll('.gif-category').forEach(cat => {
            cat.addEventListener('click', () => {
                const search = cat.dataset.search;
                if (search === '') return;
                Utils.$('#gif-search').value = search === 'trending' ? '' : search;
                this.searchGifs(search === 'trending' ? '' : search);
            });
        });
        
        // Load preview GIFs for each category
        this.loadCategoryPreviews(categorySet);
    },

    // Load preview GIFs for categories
    async loadCategoryPreviews(categories) {
        const apiKey = 'AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCYQ';
        
        for (const cat of categories) {
            try {
                const url = `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(cat)}&key=${apiKey}&limit=1&locale=ru_RU`;
                const response = await fetch(url);
                const data = await response.json();
                
                if (data.results && data.results[0]) {
                    const gifUrl = data.results[0].media_formats.tinygif?.url || data.results[0].media_formats.gif?.url;
                    const bgEl = document.querySelector(`.gif-category-bg[data-category="${cat}"]`);
                    if (bgEl && gifUrl) {
                        bgEl.style.backgroundImage = `url(${gifUrl})`;
                    }
                }
            } catch (e) {
                console.log('Failed to load preview for:', cat);
            }
        }
    },

    // Search GIFs from Tenor
    async searchGifs(query) {
        const resultsEl = Utils.$('#gif-results');
        const categoriesEl = Utils.$('#gif-categories');
        
        categoriesEl.style.display = 'none';
        resultsEl.style.display = 'grid';
        resultsEl.innerHTML = '<div class="gif-loading">Загрузка...</div>';
        
        try {
            const apiKey = 'AIzaSyAyimkuYQYF_FXVALexPuGQctUWRURdCYQ';
            const limit = 20;
            const url = query 
                ? `https://tenor.googleapis.com/v2/search?q=${encodeURIComponent(query)}&key=${apiKey}&limit=${limit}&locale=ru_RU`
                : `https://tenor.googleapis.com/v2/featured?key=${apiKey}&limit=${limit}&locale=ru_RU`;
            
            const response = await fetch(url);
            const data = await response.json();
            
            if (data.results && data.results.length > 0) {
                resultsEl.innerHTML = data.results.map(gif => {
                    const previewUrl = gif.media_formats.tinygif?.url || gif.media_formats.gif?.url;
                    const fullUrl = gif.media_formats.gif?.url || previewUrl;
                    return `<img src="${previewUrl}" data-full="${fullUrl}" alt="${gif.content_description || 'GIF'}" loading="lazy">`;
                }).join('');
                
                // Add click handlers for GIFs
                resultsEl.querySelectorAll('img').forEach(img => {
                    img.addEventListener('click', () => {
                        this.sendGif(img.dataset.full);
                        Utils.$('#emoji-picker').classList.remove('show');
                    });
                });
            } else {
                resultsEl.innerHTML = '<div class="gif-loading">Ничего не найдено</div>';
            }
        } catch (e) {
            console.error('Failed to search GIFs:', e);
            resultsEl.innerHTML = '<div class="gif-loading">Ошибка загрузки</div>';
        }
    },

    // Send GIF as message
    sendGif(url) {
        const channelId = Store.state.currentChannel?.id;
        const dmId = Store.state.currentDM;
        
        if (!channelId && !dmId) return;
        
        if (dmId) {
            WS.send('dm_message', {
                recipientId: Store.state.currentDMUser?.id,
                content: url
            });
        } else {
            // Send as regular message with GIF URL
            API.messages.send(channelId, url).catch(e => {
                console.error('Failed to send GIF:', e);
            });
        }
    },

    // User Profile
    async showUserProfile(userId) {
        // Show modal with skeleton first
        this.hideModal('search-modal');
        this.showModal('user-profile-modal');
        this.showProfileSkeleton();
        
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
        } catch (error) {
            console.error('Failed to load user profile:', error);
            this.hideModal('user-profile-modal');
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
        
        // Hide voice/call panel when leaving chat (but don't end the call)
        if (window.Voice) {
            Voice.hideVoicePanel();
            Voice.hideCallUI();
        }
        
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
        this.stopFriendsRefresh();
        
        // Reset new messages bar
        this.hideNewMessagesBar();
        this.isUserScrolledUp = false;
        
        try {
            // Create or get existing DM channel
            const { dmChannel } = await API.dm.create(userId);
            
            // Get other user info
            const { otherUser } = await API.dm.get(dmChannel.id);
            
            console.log('[DM] Opening DM channel:', dmChannel.id, 'with user:', otherUser.username);
            
            // Clear unread messages for this user
            Store.clearUnreadDM(otherUser.id);
            this.updateDMUnreadBadge(otherUser.id);
            
            // Update UI
            Utils.$('#server-name').textContent = 'Личные сообщения';
            Utils.$('#current-channel-name').textContent = `@${otherUser.username}`;
            Utils.$('#channel-hash').style.display = 'none'; // Hide # for DMs
            
            // Update titlebar
            this.updateTitlebar('Личные сообщения');
            
            // Unsubscribe from previous channel
            if (Store.state.currentChannel) {
                WS.unsubscribe(Store.state.currentChannel.id);
            }
            
            // Store current DM - IMPORTANT: set before loading messages
            Store.state.currentDM = dmChannel;
            Store.state.currentDMUser = otherUser;
            Store.setCurrentServer(null);
            Store.setCurrentChannel(null);
            
            // Update sidebar to highlight this DM
            Utils.$$('.dm-nav-item').forEach(el => el.classList.remove('active'));
            Utils.$$('.dm-item').forEach(el => {
                el.classList.toggle('active', el.dataset.user === otherUser.id);
            });
            
            // Show chat area
            Utils.$('.main-content')?.classList.remove('no-chat');
            
            // Show message input
            Utils.$('.message-input-container')?.style.setProperty('display', '');
            
            console.log('[DM] Current DM set to:', Store.state.currentDM);
            console.log('[DM] Store.state.currentDM.id:', Store.state.currentDM?.id);
            
            // Show skeleton loading for messages
            this.showMessagesSkeleton();
            
            // Load messages
            const { messages } = await API.dm.getMessages(dmChannel.id);
            Store.setMessages(messages);
            this.renderMessages();
            this.scrollToBottom();
            
            // Update message form to send to DM
            this.isDMMode = true;
            
            // Show call button in header
            this.showDMCallButton(otherUser);
            
            // Restore voice panel if there's an active call in this DM
            if (window.Voice && Voice.currentCall && Voice.currentCall.dmId === dmChannel.id) {
                Voice.showCallUI(otherUser, false);
            }
            
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
    },

    // Global mute state
    isGlobalMuted: false,
    isGlobalDeafened: false,
    wasMutedBeforeDeafen: false, // Remember mute state before deafen

    // Toggle global mute (works even when not in a call)
    toggleGlobalMute() {
        // If deafened, just toggle the mute state but don't undeafen
        if (this.isGlobalDeafened) {
            this.isGlobalMuted = !this.isGlobalMuted;
            this.wasMutedBeforeDeafen = this.isGlobalMuted;
            this.updateMuteButtonUI();
            Utils.storage.set('flash_global_muted', this.isGlobalMuted);
            return;
        }
        
        this.isGlobalMuted = !this.isGlobalMuted;
        this.updateMuteButtonUI();
        
        // Apply to Voice if in a call (voice channel or DM call)
        if (window.Voice && (Voice.currentChannel || Voice.currentCall)) {
            Voice.isMuted = this.isGlobalMuted;
            if (Voice.localStream) {
                Voice.localStream.getAudioTracks().forEach(track => track.enabled = !this.isGlobalMuted);
            }
            Voice.updateVoicePanelUI();
            // Update call UI buttons too
            Voice.updateCallUIButtons?.();
            // Notify server
            if (Voice.currentChannel) {
                WS.send('voice_mute', { channelId: Voice.currentChannel, muted: this.isGlobalMuted });
            }
        }
        
        // Save state
        Utils.storage.set('flash_global_muted', this.isGlobalMuted);
    },

    // Toggle global deafen (works even when not in a call)
    toggleGlobalDeafen() {
        if (!this.isGlobalDeafened) {
            // Turning ON deafen
            this.wasMutedBeforeDeafen = this.isGlobalMuted; // Remember current mute state
            this.isGlobalDeafened = true;
            this.isGlobalMuted = true; // Deafen always mutes
            this.updateMuteButtonUI();
            this.updateDeafenButtonUI();
            
            // Apply to Voice if in a call (voice channel or DM call)
            if (window.Voice && (Voice.currentChannel || Voice.currentCall)) {
                Voice.isDeafened = true;
                Voice.isMuted = true;
                if (Voice.localStream) {
                    Voice.localStream.getAudioTracks().forEach(track => track.enabled = false);
                }
                // Mute all peer audio
                for (const [peerId, peer] of Voice.peers) {
                    if (peer.audioElement) {
                        peer.audioElement.muted = true;
                    }
                }
                Voice.updateVoicePanelUI();
                Voice.updateCallUIButtons?.();
                if (Voice.currentChannel) {
                    WS.send('voice_deafen', { channelId: Voice.currentChannel, deafened: true });
                }
            }
        } else {
            // Turning OFF deafen
            this.isGlobalDeafened = false;
            this.isGlobalMuted = this.wasMutedBeforeDeafen; // Restore previous mute state
            this.updateMuteButtonUI();
            this.updateDeafenButtonUI();
            
            // Apply to Voice if in a call (voice channel or DM call)
            if (window.Voice && (Voice.currentChannel || Voice.currentCall)) {
                Voice.isDeafened = false;
                Voice.isMuted = this.isGlobalMuted;
                if (Voice.localStream) {
                    Voice.localStream.getAudioTracks().forEach(track => track.enabled = !this.isGlobalMuted);
                }
                // Unmute all peer audio
                for (const [peerId, peer] of Voice.peers) {
                    if (peer.audioElement) {
                        peer.audioElement.muted = false;
                    }
                }
                Voice.updateVoicePanelUI();
                Voice.updateCallUIButtons?.();
                if (Voice.currentChannel) {
                    WS.send('voice_deafen', { channelId: Voice.currentChannel, deafened: false });
                }
            }
        }
        
        // Save state
        Utils.storage.set('flash_global_muted', this.isGlobalMuted);
        Utils.storage.set('flash_global_deafened', this.isGlobalDeafened);
    },

    // Sync user panel buttons with Voice state (called from Voice)
    syncFromVoice() {
        if (window.Voice) {
            this.isGlobalMuted = Voice.isMuted;
            this.isGlobalDeafened = Voice.isDeafened;
            this.updateMuteButtonUI();
            this.updateDeafenButtonUI();
        }
    },

    // Update mute button UI
    updateMuteButtonUI() {
        const btn = Utils.$('#user-mute-btn');
        if (!btn) return;
        
        if (this.isGlobalMuted) {
            btn.classList.add('active');
            btn.innerHTML = `
                <svg viewBox="0 0 24 24" width="20" height="20">
                    <path fill="currentColor" d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/>
                </svg>
            `;
            btn.title = 'Включить микрофон';
        } else {
            btn.classList.remove('active');
            btn.innerHTML = `
                <svg viewBox="0 0 24 24" width="20" height="20">
                    <path fill="currentColor" d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z"/>
                </svg>
            `;
            btn.title = 'Выключить микрофон';
        }
    },

    // Update deafen button UI
    updateDeafenButtonUI() {
        const btn = Utils.$('#user-deafen-btn');
        if (!btn) return;
        
        if (this.isGlobalDeafened) {
            btn.classList.add('active');
            btn.innerHTML = `
                <svg viewBox="0 0 24 24" width="20" height="20">
                    <path fill="currentColor" d="M4.34 2.93L2.93 4.34 7.29 8.7 7 9H3v6h4l5 5v-6.59l4.18 4.18c-.65.49-1.38.88-2.18 1.11v2.06c1.34-.3 2.57-.92 3.61-1.75l2.05 2.05 1.41-1.41L4.34 2.93zM19 12c0 .82-.15 1.61-.41 2.34l1.53 1.53c.56-1.17.88-2.48.88-3.87 0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zm-7-8l-1.88 1.88L12 7.76zm4.5 8c0-1.77-1.02-3.29-2.5-4.03v1.79l2.48 2.48c.01-.08.02-.16.02-.24z"/>
                </svg>
            `;
            btn.title = 'Включить звук';
        } else {
            btn.classList.remove('active');
            btn.innerHTML = `
                <svg viewBox="0 0 24 24" width="20" height="20">
                    <path fill="currentColor" d="M12 1c-4.97 0-9 4.03-9 9v7c0 1.66 1.34 3 3 3h3v-8H5v-2c0-3.87 3.13-7 7-7s7 3.13 7 7v2h-4v8h3c1.66 0 3-1.34 3-3v-7c0-4.97-4.03-9-9-9z"/>
                </svg>
            `;
            btn.title = 'Выключить звук';
        }
    },

    // Load global mute/deafen state from storage
    loadGlobalAudioState() {
        this.isGlobalMuted = Utils.storage.get('flash_global_muted') || false;
        this.isGlobalDeafened = Utils.storage.get('flash_global_deafened') || false;
        this.updateMuteButtonUI();
        this.updateDeafenButtonUI();
    },

    // ============ MENTIONS SYSTEM ============
    
    mentionState: {
        active: false,
        startPos: -1,
        query: '',
        selectedIndex: 0,
        items: []
    },
    
    recentMentions: [], // Store recently mentioned users

    // Handle input for @ mentions
    handleMentionInput(input) {
        const value = input.value;
        const cursorPos = input.selectionStart;
        
        // Find @ symbol before cursor
        let atPos = -1;
        for (let i = cursorPos - 1; i >= 0; i--) {
            if (value[i] === '@') {
                atPos = i;
                break;
            }
            if (value[i] === ' ' || value[i] === '\n') break;
        }
        
        if (atPos >= 0) {
            const query = value.substring(atPos + 1, cursorPos).toLowerCase();
            console.log('[Mentions] @ found at', atPos, 'query:', query);
            this.mentionState.active = true;
            this.mentionState.startPos = atPos;
            this.mentionState.query = query;
            this.mentionState.selectedIndex = 0;
            this.showMentionsPopup(query);
        } else {
            this.hideMentionsPopup();
        }
    },

    // Handle keyboard navigation in mentions popup
    handleMentionKeydown(e) {
        if (!this.mentionState.active) return;
        
        const popup = Utils.$('#mentions-popup');
        const items = popup.querySelectorAll('.mention-item');
        
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.mentionState.selectedIndex = Math.min(this.mentionState.selectedIndex + 1, items.length - 1);
            this.updateMentionSelection();
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.mentionState.selectedIndex = Math.max(this.mentionState.selectedIndex - 1, 0);
            this.updateMentionSelection();
        } else if (e.key === 'Enter' || e.key === 'Tab') {
            if (items.length > 0) {
                e.preventDefault();
                const selectedItem = items[this.mentionState.selectedIndex];
                if (selectedItem) {
                    this.insertMention(selectedItem.dataset.mentionId, selectedItem.dataset.mentionName, selectedItem.dataset.mentionType);
                }
            }
        } else if (e.key === 'Escape') {
            this.hideMentionsPopup();
        }
    },

    // Update visual selection in popup
    updateMentionSelection() {
        const popup = Utils.$('#mentions-popup');
        const items = popup.querySelectorAll('.mention-item');
        items.forEach((item, i) => {
            item.classList.toggle('selected', i === this.mentionState.selectedIndex);
        });
        // Scroll selected item into view
        const selected = items[this.mentionState.selectedIndex];
        if (selected) {
            selected.scrollIntoView({ block: 'nearest' });
        }
    },

    // Show mentions popup with filtered results
    showMentionsPopup(query) {
        const popup = Utils.$('#mentions-popup');
        let html = '';
        let items = [];
        
        // Get participants based on context
        if (Store.state.currentServer) {
            // Server context - show members and roles
            const members = Store.state.members || [];
            
            // Filter members by query (exclude self)
            let filteredMembers = members.filter(m => 
                m.username.toLowerCase().includes(query) && m.id !== Store.state.user?.id
            );
            
            // Sort: recent mentions first, then alphabetically
            const recentIds = new Set(this.recentMentions);
            
            filteredMembers.sort((a, b) => {
                const aRecent = recentIds.has(a.id) ? 0 : 1;
                const bRecent = recentIds.has(b.id) ? 0 : 1;
                if (aRecent !== bRecent) return aRecent - bRecent;
                return a.username.localeCompare(b.username);
            });
            
            // Limit to 6 members
            filteredMembers = filteredMembers.slice(0, 6);
            
            if (filteredMembers.length > 0) {
                html += '<div class="mentions-header">Участники</div>';
                filteredMembers.forEach(m => {
                    const avatarStyle = m.avatar 
                        ? `background-image: url(${m.avatar}); background-size: cover;`
                        : `background: ${Utils.getUserColor(m.id)}`;
                    html += `
                        <div class="mention-item" data-mention-id="${m.id}" data-mention-name="${Utils.escapeHtml(m.username)}" data-mention-type="user">
                            <div class="mention-item-avatar" style="${avatarStyle}">${m.avatar ? '' : Utils.getInitials(m.username)}</div>
                            <div class="mention-item-info">
                                <div class="mention-item-name">${Utils.escapeHtml(m.username)}</div>
                                <div class="mention-item-tag">${m.tag || ''}</div>
                            </div>
                        </div>
                    `;
                    items.push({ id: m.id, name: m.username, type: 'user' });
                });
            }
            
            // Add roles section
            const roles = [
                { id: 'everyone', name: 'everyone', display: '@everyone', desc: 'Уведомить всех' },
                { id: 'here', name: 'here', display: '@here', desc: 'Уведомить онлайн' }
            ];
            
            const filteredRoles = roles.filter(r => r.name.includes(query));
            
            if (filteredRoles.length > 0) {
                if (filteredMembers.length > 0) {
                    html += '<div class="mentions-divider"></div>';
                }
                html += '<div class="mentions-header">Роли</div>';
                filteredRoles.forEach(r => {
                    html += `
                        <div class="mention-item" data-mention-id="${r.id}" data-mention-name="${r.name}" data-mention-type="role">
                            <div class="mention-item-role">
                                <div class="mention-role-icon ${r.id}">@</div>
                                <div class="mention-item-info">
                                    <div class="mention-item-name">${r.display}</div>
                                    <div class="mention-item-tag">${r.desc}</div>
                                </div>
                            </div>
                        </div>
                    `;
                    items.push({ id: r.id, name: r.name, type: 'role' });
                });
            }
        } else if (Store.state.currentDM) {
            // DM context - show other user
            const otherUser = Store.state.currentDMUser;
            if (otherUser && otherUser.username.toLowerCase().includes(query)) {
                html += '<div class="mentions-header">Участники</div>';
                const avatarStyle = otherUser.avatar 
                    ? `background-image: url(${otherUser.avatar}); background-size: cover;`
                    : `background: ${Utils.getUserColor(otherUser.id)}`;
                html += `
                    <div class="mention-item" data-mention-id="${otherUser.id}" data-mention-name="${Utils.escapeHtml(otherUser.username)}" data-mention-type="user">
                        <div class="mention-item-avatar" style="${avatarStyle}">${otherUser.avatar ? '' : Utils.getInitials(otherUser.username)}</div>
                        <div class="mention-item-info">
                            <div class="mention-item-name">${Utils.escapeHtml(otherUser.username)}</div>
                            <div class="mention-item-tag">${otherUser.tag || ''}</div>
                        </div>
                    </div>
                `;
                items.push({ id: otherUser.id, name: otherUser.username, type: 'user' });
            }
        } else {
            // No context - hide popup
            this.hideMentionsPopup();
            return;
        }
        
        this.mentionState.items = items;
        
        if (items.length === 0) {
            this.hideMentionsPopup();
            return;
        }
        
        popup.innerHTML = html;
        popup.classList.add('show');
        console.log('[Mentions] Showing popup with', items.length, 'items');
        
        // Bind click events
        popup.querySelectorAll('.mention-item').forEach((item, i) => {
            item.addEventListener('click', () => {
                this.insertMention(item.dataset.mentionId, item.dataset.mentionName, item.dataset.mentionType);
            });
            item.addEventListener('mouseenter', () => {
                this.mentionState.selectedIndex = i;
                this.updateMentionSelection();
            });
        });
        
        this.updateMentionSelection();
    },

    // Hide mentions popup
    hideMentionsPopup() {
        const popup = Utils.$('#mentions-popup');
        popup.classList.remove('show');
        this.mentionState.active = false;
        this.mentionState.startPos = -1;
        this.mentionState.query = '';
        this.mentionState.items = [];
    },

    // Insert mention into input
    insertMention(id, name, type) {
        const input = Utils.$('#message-input');
        const value = input.value;
        const startPos = this.mentionState.startPos;
        const cursorPos = input.selectionStart;
        
        // Create mention text
        const mentionText = type === 'role' ? `@${name}` : `@${name}`;
        
        // Replace @query with mention
        const newValue = value.substring(0, startPos) + mentionText + ' ' + value.substring(cursorPos);
        input.value = newValue;
        
        // Set cursor position after mention
        const newCursorPos = startPos + mentionText.length + 1;
        input.setSelectionRange(newCursorPos, newCursorPos);
        input.focus();
        
        // Add to recent mentions
        if (type === 'user' && !this.recentMentions.includes(id)) {
            this.recentMentions.unshift(id);
            if (this.recentMentions.length > 5) this.recentMentions.pop();
        }
        
        this.hideMentionsPopup();
    },

    // Parse mentions in message content for display
    parseMentions(content) {
        if (!content) return content;
        
        // Replace @username with styled mention
        // Match @word patterns
        return content.replace(/@(\w+)/g, (match, name) => {
            const lowerName = name.toLowerCase();
            
            // Check for special roles
            if (lowerName === 'everyone' || lowerName === 'here') {
                return `<span class="mention" data-mention-type="role" data-mention-name="${name}">@${name}</span>`;
            }
            
            // Check if it's a user mention
            const members = Store.state.members || [];
            const member = members.find(m => m.username.toLowerCase() === lowerName);
            if (member) {
                return `<span class="mention" data-mention-type="user" data-mention-id="${member.id}">@${name}</span>`;
            }
            
            // Check DM user
            if (Store.state.currentDMUser?.username.toLowerCase() === lowerName) {
                return `<span class="mention" data-mention-type="user" data-mention-id="${Store.state.currentDMUser.id}">@${name}</span>`;
            }
            
            return match; // Return original if not a valid mention
        });
    },

    // Check if current user is mentioned in message
    isUserMentioned(content) {
        if (!content) return false;
        const username = Store.state.user?.username?.toLowerCase();
        if (!username) return false;
        
        // Check for direct mention
        if (content.toLowerCase().includes(`@${username}`)) return true;
        
        // Check for @everyone
        if (content.toLowerCase().includes('@everyone')) return true;
        
        // Check for @here (only if user was online when message was sent - simplified: always highlight)
        if (content.toLowerCase().includes('@here')) return true;
        
        return false;
    },

    // ============ SERVER CONTEXT MENU ============
    
    contextMenuServerId: null,
    mutedServers: Utils.storage.get('flash_muted_servers') || {},
    serverUnreadMessages: {},

    // Show server context menu
    showServerContextMenu(e, serverId) {
        const menu = Utils.$('#server-context-menu');
        const server = Store.state.servers.find(s => s.id === serverId);
        if (!menu || !server) return;

        this.contextMenuServerId = serverId;

        // Position menu at cursor
        menu.style.left = e.clientX + 'px';
        menu.style.top = e.clientY + 'px';

        // Check if menu would go off screen
        const menuRect = menu.getBoundingClientRect();
        if (e.clientX + 200 > window.innerWidth) {
            menu.style.left = (e.clientX - 200) + 'px';
        }
        if (e.clientY + 250 > window.innerHeight) {
            menu.style.top = (e.clientY - 250) + 'px';
        }

        // Update "Mark as read" button state
        const markReadBtn = Utils.$('#ctx-mark-read');
        const hasUnread = this.serverUnreadMessages[serverId] > 0;
        if (markReadBtn) {
            markReadBtn.classList.toggle('disabled', !hasUnread);
        }

        // Show/hide settings button based on ownership
        const settingsBtn = Utils.$('#ctx-server-settings');
        if (settingsBtn) {
            settingsBtn.style.display = server.owner_id === Store.state.user?.id ? '' : 'none';
        }

        // Show menu
        menu.classList.add('show');

        // Bind menu item clicks
        this.bindContextMenuEvents();
    },

    // Hide server context menu
    hideServerContextMenu() {
        const menu = Utils.$('#server-context-menu');
        if (menu) {
            menu.classList.remove('show');
        }
        this.contextMenuServerId = null;
    },

    // Bind context menu events
    bindContextMenuEvents() {
        const menu = Utils.$('#server-context-menu');
        if (!menu) return;

        // Mark as read
        const markReadBtn = menu.querySelector('[data-action="mark-read"]');
        markReadBtn?.addEventListener('click', () => {
            if (!markReadBtn.classList.contains('disabled')) {
                this.markServerAsRead(this.contextMenuServerId);
            }
            this.hideServerContextMenu();
        }, { once: true });

        // Invite
        const inviteBtn = menu.querySelector('[data-action="invite"]');
        inviteBtn?.addEventListener('click', () => {
            this.showServerInviteFromContext(this.contextMenuServerId);
            this.hideServerContextMenu();
        }, { once: true });

        // Mute options
        menu.querySelectorAll('[data-mute]').forEach(btn => {
            btn.addEventListener('click', () => {
                const duration = btn.dataset.mute;
                this.muteServer(this.contextMenuServerId, duration);
                this.hideServerContextMenu();
            }, { once: true });
        });

        // Settings
        const settingsBtn = menu.querySelector('[data-action="settings"]');
        settingsBtn?.addEventListener('click', () => {
            this.showServerSettings(this.contextMenuServerId);
            this.hideServerContextMenu();
        }, { once: true });
    },

    // Mark server as read
    markServerAsRead(serverId) {
        this.serverUnreadMessages[serverId] = 0;
        this.updateServerUnreadIndicator(serverId);
        console.log('[Server] Marked as read:', serverId);
    },

    // Update server unread indicator
    updateServerUnreadIndicator(serverId) {
        const serverIcon = document.querySelector(`.server-icon[data-server="${serverId}"]`);
        if (serverIcon) {
            const hasUnread = this.serverUnreadMessages[serverId] > 0;
            serverIcon.classList.toggle('has-unread', hasUnread);
        }
    },

    // Add unread message to server
    addServerUnread(serverId) {
        if (!this.serverUnreadMessages[serverId]) {
            this.serverUnreadMessages[serverId] = 0;
        }
        this.serverUnreadMessages[serverId]++;
        this.updateServerUnreadIndicator(serverId);
    },

    // Mute server
    muteServer(serverId, duration) {
        const server = Store.state.servers.find(s => s.id === serverId);
        if (!server) return;

        if (duration === 'forever') {
            this.mutedServers[serverId] = { until: 'forever' };
        } else {
            const minutes = parseInt(duration);
            const until = Date.now() + minutes * 60 * 1000;
            this.mutedServers[serverId] = { until };
        }

        Utils.storage.set('flash_muted_servers', this.mutedServers);
        this.updateServerMutedState(serverId);
        console.log('[Server] Muted:', serverId, 'for', duration);
    },

    // Unmute server
    unmuteServer(serverId) {
        delete this.mutedServers[serverId];
        Utils.storage.set('flash_muted_servers', this.mutedServers);
        this.updateServerMutedState(serverId);
    },

    // Check if server is muted
    isServerMuted(serverId) {
        const mute = this.mutedServers[serverId];
        if (!mute) return false;
        if (mute.until === 'forever') return true;
        if (Date.now() < mute.until) return true;
        // Mute expired
        delete this.mutedServers[serverId];
        Utils.storage.set('flash_muted_servers', this.mutedServers);
        return false;
    },

    // Update server muted visual state
    updateServerMutedState(serverId) {
        const serverIcon = document.querySelector(`.server-icon[data-server="${serverId}"]`);
        if (serverIcon) {
            serverIcon.classList.toggle('muted', this.isServerMuted(serverId));
        }
    },

    // Show invite modal from context menu
    async showServerInviteFromContext(serverId) {
        try {
            const response = await API.servers.createInvite(serverId);
            const code = response.invite?.code || response.code;
            
            // Generate invite link
            const baseUrl = window.location.origin;
            const inviteLink = `${baseUrl}?invite=${code}`;
            
            const modal = Utils.$('#invite-modal');
            const codeDisplay = Utils.$('#invite-code-display');
            const linkDisplay = Utils.$('#invite-link-display');
            
            if (codeDisplay) {
                codeDisplay.value = code;
            }
            
            if (linkDisplay) {
                linkDisplay.value = inviteLink;
            }
            
            // Bind copy link button
            const copyLinkBtn = Utils.$('#copy-invite-link-btn');
            const newCopyLinkBtn = copyLinkBtn.cloneNode(true);
            copyLinkBtn.parentNode.replaceChild(newCopyLinkBtn, copyLinkBtn);
            newCopyLinkBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(inviteLink);
                newCopyLinkBtn.textContent = 'Скопировано!';
                setTimeout(() => {
                    newCopyLinkBtn.textContent = 'Копировать';
                }, 2000);
            });
            
            // Bind copy code button
            const copyBtn = Utils.$('#copy-invite-btn');
            const newCopyBtn = copyBtn.cloneNode(true);
            copyBtn.parentNode.replaceChild(newCopyBtn, copyBtn);
            newCopyBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(code);
                newCopyBtn.textContent = 'Скопировано!';
                setTimeout(() => {
                    newCopyBtn.textContent = 'Копировать';
                }, 2000);
            });
            
            this.showModal('invite-modal');
        } catch (error) {
            console.error('Failed to create invite:', error);
        }
    },

    // Show server settings modal
    async showServerSettings(serverId) {
        const server = Store.state.servers.find(s => s.id === serverId);
        if (!server) return;

        // Check ownership
        if (server.owner_id !== Store.state.user?.id) {
            console.log('[Server] Not owner, cannot edit settings');
            return;
        }

        this.editingServerId = serverId;

        // Populate form
        Utils.$('#server-settings-name').value = server.name;

        // Set avatar
        const avatarEl = Utils.$('#server-settings-avatar');
        if (server.icon) {
            avatarEl.style.backgroundImage = `url(${server.icon})`;
            avatarEl.textContent = '';
        } else {
            avatarEl.style.backgroundImage = '';
            avatarEl.textContent = server.name.charAt(0).toUpperCase();
        }

        // Set banner
        const bannerEl = Utils.$('#server-settings-banner');
        if (server.banner) {
            bannerEl.style.backgroundImage = `url(${server.banner})`;
        } else {
            bannerEl.style.backgroundImage = '';
        }

        // Bind form submit
        const form = Utils.$('#server-settings-form');
        form.onsubmit = async (e) => {
            e.preventDefault();
            await this.saveServerSettings();
        };

        // Bind avatar click
        const avatarInput = Utils.$('#server-icon-input');
        avatarEl.onclick = () => avatarInput.click();
        avatarInput.onchange = (e) => this.handleServerImageUpload(e.target.files[0], 'icon');

        // Bind banner click
        const bannerInput = Utils.$('#server-banner-input');
        bannerEl.onclick = () => bannerInput.click();
        bannerInput.onchange = (e) => this.handleServerImageUpload(e.target.files[0], 'banner');

        this.showModal('server-settings-modal');
    },

    // Handle server image upload
    async handleServerImageUpload(file, type) {
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const dataUrl = e.target.result;
            
            if (type === 'icon') {
                const avatarEl = Utils.$('#server-settings-avatar');
                avatarEl.style.backgroundImage = `url(${dataUrl})`;
                avatarEl.textContent = '';
                this.pendingServerIcon = dataUrl;
            } else if (type === 'banner') {
                const bannerEl = Utils.$('#server-settings-banner');
                bannerEl.style.backgroundImage = `url(${dataUrl})`;
                this.pendingServerBanner = dataUrl;
            }
        };
        reader.readAsDataURL(file);
    },

    // Save server settings
    async saveServerSettings() {
        const serverId = this.editingServerId;
        if (!serverId) return;

        const name = Utils.$('#server-settings-name').value.trim();
        if (!name || name.length < 2) {
            alert('Название сервера должно быть не менее 2 символов');
            return;
        }

        try {
            const updateData = { name };
            
            if (this.pendingServerIcon) {
                updateData.icon = this.pendingServerIcon;
            }
            if (this.pendingServerBanner) {
                updateData.banner = this.pendingServerBanner;
            }

            const { server } = await API.servers.update(serverId, updateData);
            
            // Update local state
            const index = Store.state.servers.findIndex(s => s.id === serverId);
            if (index !== -1) {
                Store.state.servers[index] = { ...Store.state.servers[index], ...server };
            }
            
            // Update current server if it's the one being edited
            if (Store.state.currentServer?.id === serverId) {
                Store.state.currentServer = { ...Store.state.currentServer, ...server };
                Utils.$('#server-name').textContent = server.name;
            }

            this.renderServers();
            this.hideModal('server-settings-modal');
            
            // Clear pending images
            this.pendingServerIcon = null;
            this.pendingServerBanner = null;
            this.editingServerId = null;
            
            console.log('[Server] Settings saved:', serverId);
        } catch (error) {
            console.error('Failed to save server settings:', error);
            alert('Не удалось сохранить настройки сервера');
        }
    }
};

// Make App globally available for WebSocket handlers
window.App = App;
