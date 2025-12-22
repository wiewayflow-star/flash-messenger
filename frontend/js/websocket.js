/**
 * Flash WebSocket Client
 */
const WS = {
    socket: null,
    reconnectAttempts: 0,
    maxReconnectAttempts: 5,
    heartbeatInterval: null,
    audioContext: null,
    ringtoneInterval: null,

    connect() {
        if (this.socket?.readyState === WebSocket.OPEN) return;

        this.socket = new WebSocket(CONFIG.WS_URL);

        this.socket.onopen = () => {
            console.log('⚡ WebSocket connected');
            this.reconnectAttempts = 0;
            this.authenticate();
            this.startHeartbeat();
        };

        this.socket.onmessage = (event) => {
            try {
                const { type, payload } = JSON.parse(event.data);
                this.handleMessage(type, payload);
            } catch (e) {
                console.error('WS parse error:', e);
            }
        };

        this.socket.onclose = () => {
            console.log('WebSocket disconnected');
            this.stopHeartbeat();
            this.reconnect();
        };

        this.socket.onerror = (error) => {
            console.error('WebSocket error:', error);
        };
    },

    disconnect() {
        this.stopHeartbeat();
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
    },

    reconnect() {
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.log('Max reconnect attempts reached');
            return;
        }

        this.reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
        
        console.log(`Reconnecting in ${delay}ms...`);
        setTimeout(() => this.connect(), delay);
    },

    send(type, payload) {
        if (this.socket?.readyState === WebSocket.OPEN) {
            this.socket.send(JSON.stringify({ type, payload }));
        }
    },

    authenticate() {
        if (Store.state.token) {
            this.send('authenticate', { token: Store.state.token });
        }
    },

    subscribe(channelId) {
        console.log('Subscribing to channel:', channelId);
        this.send('subscribe', { channelId });
    },

    unsubscribe(channelId) {
        console.log('Unsubscribing from channel:', channelId);
        this.send('unsubscribe', { channelId });
    },

    sendTyping(channelId) {
        this.send('typing', { channelId });
    },

    startHeartbeat() {
        this.heartbeatInterval = setInterval(() => {
            this.send('heartbeat', {});
        }, 30000);
    },

    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    },

    handleMessage(type, payload) {
        // Security: Don't log message content
        if (type === 'message_create' || type === 'dm_message') {
            console.log('WS message:', type, '(content hidden for security)');
        } else {
            console.log('WS message:', type);
        }

        switch (type) {
            case 'authenticated':
                console.log('✓ WebSocket authenticated');
                break;

            case 'message_create':
                if (Store.state.currentChannel?.id === payload.channelId) {
                    Store.addMessage(payload.message);
                    if (window.App) {
                        App.renderMessages();
                        App.scrollToBottom();
                    }
                }
                break;

            case 'dm_message':
                const isCurrentDM = Store.state.currentDM?.id === payload.dmId;
                
                if (isCurrentDM) {
                    // User is in this DM chat - add message and render
                    Store.addMessage(payload.message);
                    if (window.App) {
                        App.renderMessages();
                        App.scrollToBottom();
                    }
                } else {
                    // User is not in this DM chat - show notification and increment unread counter
                    console.log('✗ User not in this DM chat - showing notification');
                    const author = payload.message.author;
                    // Don't show notification for system messages (like call_ended)
                    if (author && payload.message.type !== 'call_ended') {
                        // Increment unread counter for this user
                        Store.addUnreadDM(author.id);
                        // Update DM list to show badge
                        if (window.App) {
                            App.updateDMUnreadBadge(author.id);
                        }
                        this.showNotification(
                            `Новое сообщение от ${author.username}`,
                            payload.message.content.substring(0, 100)
                        );
                    }
                }
                // Play notification sound (but not for system messages)
                if (payload.message.type !== 'call_ended') {
                    this.playNotificationSound();
                }
                console.log('=== END DM MESSAGE ===');
                break;

            case 'message_delete':
                if (Store.state.currentChannel?.id === payload.channelId) {
                    Store.removeMessage(payload.messageId);
                    if (window.App) App.renderMessages();
                }
                break;

            case 'typing_start':
                if (Store.state.currentChannel?.id === payload.channelId) {
                    Store.state.typingUsers.add(payload.userId);
                    if (window.App) App.updateTypingIndicator();
                }
                break;

            case 'typing_stop':
                if (Store.state.currentChannel?.id === payload.channelId) {
                    Store.state.typingUsers.delete(payload.userId);
                    if (window.App) App.updateTypingIndicator();
                }
                break;

            case 'friend_request':
                // Show notification
                this.showFriendRequestNotification(payload.request);
                // Play notification sound
                this.playNotificationSound();
                // Update friend requests count if on friends page
                if (window.App) App.updateFriendRequestsBadge();
                break;

            case 'friend_request_accepted':
                this.showNotification('Запрос принят', `${payload.user.username} принял ваш запрос в друзья!`);
                this.playNotificationSound();
                break;

            case 'user_status_update':
                // Update user status in real-time
                if (window.App) App.updateUserStatus(payload.userId, payload.status);
                break;

            case 'server_created':
                // New server added
                console.log('New server created:', payload.server);
                Store.addServer(payload.server);
                if (window.App) App.renderServers();
                this.showNotification('Новый сервер', `Вы были добавлены на сервер "${payload.server.name}"`);
                break;

            case 'server_member_join':
                // New member joined server
                if (Store.state.currentServer?.id === payload.serverId) {
                    console.log('New member joined:', payload.member);
                    Store.addMember(payload.member);
                    if (window.App) App.renderMembers();
                }
                break;

            case 'server_member_leave':
                // Member left server
                if (Store.state.currentServer?.id === payload.serverId) {
                    console.log('Member left:', payload.userId);
                    Store.removeMember(payload.userId);
                    if (window.App) App.renderMembers();
                }
                break;

            case 'channel_created':
                // New channel created
                if (Store.state.currentServer?.id === payload.channel.server_id) {
                    console.log('New channel created:', payload.channel);
                    Store.addChannel(payload.channel);
                    if (window.App) App.renderChannels();
                }
                break;

            case 'channel_deleted':
                // Channel deleted
                if (Store.state.currentServer?.id === payload.serverId) {
                    console.log('Channel deleted:', payload.channelId);
                    Store.removeChannel(payload.channelId);
                    if (window.App) App.renderChannels();
                    
                    // If current channel was deleted, switch to another
                    if (Store.state.currentChannel?.id === payload.channelId) {
                        const firstChannel = Store.state.channels.find(c => c.type === 'text');
                        if (firstChannel && window.App) {
                            App.selectChannel(firstChannel.id);
                        }
                    }
                }
                break;

            case 'friend_removed':
                // Friend removed
                console.log('Friend removed:', payload.userId);
                if (window.App) {
                    // Refresh friends list if visible
                    const friendsContainer = document.querySelector('.friends-container');
                    if (friendsContainer) {
                        App.showFriends();
                    }
                }
                this.showNotification('Друг удален', 'Пользователь удалил вас из друзей');
                break;

            case 'invite_used':
                // Someone joined via invite
                if (Store.state.currentServer?.id === payload.serverId) {
                    console.log('New member via invite:', payload.member);
                    Store.addMember(payload.member);
                    if (window.App) App.renderMembers();
                }
                break;

            case 'heartbeat_ack':
                // Connection is alive
                break;

            // Voice events
            case 'voice_user_joined':
                console.log('[Voice WS] User joined:', payload);
                // Update store
                Store.addVoiceChannelUser(payload.channelId, payload.user);
                // Re-render channels to show user
                if (window.App && Store.state.currentServer) {
                    App.renderChannels();
                }
                // Handle in Voice if we're in the channel
                if (window.Voice && Voice.currentChannel === payload.channelId) {
                    Voice.handleUserJoined(payload.userId, payload.user);
                }
                break;

            case 'voice_user_left':
                console.log('[Voice WS] User left:', payload);
                console.log('[Voice WS] Current server:', Store.state.currentServer?.id);
                console.log('[Voice WS] Voice channel users before:', JSON.stringify(Array.from(Store.state.voiceChannelUsers.entries())));
                // Update store
                Store.removeVoiceChannelUser(payload.channelId, payload.userId);
                console.log('[Voice WS] Voice channel users after:', JSON.stringify(Array.from(Store.state.voiceChannelUsers.entries())));
                // Re-render channels - always try to render if App exists
                if (window.App) {
                    console.log('[Voice WS] Re-rendering channels, currentServer:', Store.state.currentServer?.id);
                    if (Store.state.currentServer) {
                        App.renderChannels();
                    }
                } else {
                    console.log('[Voice WS] window.App not available!');
                }
                // Handle in Voice if we're in the channel
                if (window.Voice && Voice.currentChannel === payload.channelId) {
                    Voice.handleUserLeft(payload.userId);
                }
                break;

            case 'voice_offer':
                console.log('[Voice WS] Received offer from:', payload.fromUserId);
                // Handle for both voice channels and DM calls
                if (window.Voice && (Voice.currentChannel || Voice.currentCall)) {
                    Voice.handleOffer(payload.fromUserId, payload.offer);
                }
                break;

            case 'voice_answer':
                console.log('[Voice WS] Received answer from:', payload.fromUserId);
                // Handle for both voice channels and DM calls
                if (window.Voice && (Voice.currentChannel || Voice.currentCall)) {
                    Voice.handleAnswer(payload.fromUserId, payload.answer);
                }
                break;

            case 'voice_ice_candidate':
                console.log('[Voice WS] Received ICE candidate from:', payload.fromUserId);
                // Handle for both voice channels and DM calls
                if (window.Voice && (Voice.currentChannel || Voice.currentCall)) {
                    Voice.handleIceCandidate(payload.fromUserId, payload.candidate);
                }
                break;

            // Screen share events
            case 'screen_share_offer':
                console.log('[Voice WS] Received screen share offer from:', payload.fromUserId);
                if (window.Voice) {
                    Voice.handleScreenShareOffer(payload.fromUserId, payload.offer);
                }
                break;

            case 'screen_share_answer':
                console.log('[Voice WS] Received screen share answer from:', payload.fromUserId);
                if (window.Voice) {
                    Voice.handleScreenShareAnswer(payload.fromUserId, payload.answer);
                }
                break;

            case 'screen_ice_candidate':
                console.log('[Voice WS] Received screen ICE candidate from:', payload.fromUserId);
                if (window.Voice) {
                    Voice.handleScreenIceCandidate(payload.fromUserId, payload.candidate);
                }
                break;

            case 'screen_share_stop':
                console.log('[Voice WS] Screen share stopped by:', payload.fromUserId);
                if (window.Voice) {
                    Voice.handleScreenShareStop(payload.fromUserId);
                }
                break;

            case 'voice_speaking':
                if (window.Voice && Voice.currentChannel === payload.channelId) {
                    Voice.handleUserSpeaking(payload.userId, payload.speaking);
                }
                break;

            case 'voice_muted':
                if (window.Voice && Voice.currentChannel === payload.channelId) {
                    Voice.handleUserMuted(payload.userId, payload.muted);
                }
                break;

            case 'voice_channel_users':
                console.log('[Voice WS] Channel users:', payload);
                // Update store with all users in channel
                Store.setVoiceChannelUsers(payload.channelId, payload.users);
                // Re-render channels
                if (window.App && Store.state.currentServer) {
                    App.renderChannels();
                }
                // Create peer connections for existing users
                // Only initiate if our ID is greater (to avoid both sides initiating)
                if (window.Voice && Voice.currentChannel === payload.channelId) {
                    const myId = Store.state.user?.id;
                    payload.users.forEach(user => {
                        if (user.id !== myId) {
                            const shouldInitiate = myId > user.id;
                            console.log('[Voice] Creating peer for existing user:', user.id, 'initiate:', shouldInitiate);
                            Voice.createPeerConnection(user.id, shouldInitiate);
                        }
                    });
                }
                break;

            // DM Call events
            case 'dm_call_incoming':
                console.log('[Voice WS] Incoming call:', payload);
                if (window.Voice) {
                    Voice.showIncomingCall(payload);
                }
                break;

            case 'dm_call_accepted':
                console.log('[Voice WS] Call accepted:', payload);
                if (window.Voice) {
                    Voice.handleCallAccepted(payload);
                }
                break;

            case 'dm_call_rejected':
                console.log('[Voice WS] Call rejected:', payload);
                if (window.Voice) {
                    Voice.handleCallRejected(payload);
                }
                break;

            case 'dm_call_ended':
                console.log('[Voice WS] Call ended:', payload);
                if (window.Voice) {
                    Voice.handleCallEnded(payload);
                }
                break;

            case 'dm_call_cancelled':
                console.log('[Voice WS] Call cancelled:', payload);
                if (window.Voice) {
                    Voice.handleCallCancelled(payload);
                }
                break;

            case 'dm_call_rejoined':
                console.log('[Voice WS] Partner rejoined call:', payload);
                if (window.Voice) {
                    Voice.handlePartnerRejoined(payload);
                }
                break;

            // Group call (Конфа) events
            case 'group_call_created':
                console.log('[Voice WS] Group call created:', payload);
                this.showNotification('Новая конфа', `Вас добавили в конфу "${payload.groupCall.name}"`);
                break;

            case 'group_call_users':
                console.log('[Voice WS] Group call users:', payload);
                if (window.Voice && Voice.currentGroupCall?.id === payload.groupId) {
                    // Create peer connections for existing users
                    const myId = Store.state.user?.id;
                    payload.users.forEach(user => {
                        if (user.id !== myId) {
                            const shouldInitiate = myId > user.id;
                            Voice.createPeerConnection(user.id, shouldInitiate);
                        }
                    });
                }
                break;

            case 'group_call_user_joined':
                console.log('[Voice WS] User joined group call:', payload);
                if (window.Voice && Voice.currentGroupCall?.id === payload.groupId) {
                    const myId = Store.state.user?.id;
                    const shouldInitiate = myId > payload.user.id;
                    Voice.createPeerConnection(payload.user.id, shouldInitiate);
                    
                    // Mark user as active (remove pending state)
                    Voice.markUserActive(payload.user.id);
                    
                    // If participant doesn't exist, add them
                    const existingParticipant = document.querySelector(`.group-call-participant[data-user-id="${payload.user.id}"]`);
                    if (!existingParticipant) {
                        const participants = document.getElementById('group-call-participants');
                        if (participants) {
                            const newParticipant = document.createElement('div');
                            newParticipant.className = 'group-call-participant active';
                            newParticipant.dataset.userId = payload.user.id;
                            newParticipant.innerHTML = `
                                <div class="group-call-avatar" style="background: ${Utils.getUserColor(payload.user.id)}">
                                    ${Utils.getInitials(payload.user.username)}
                                </div>
                                <span class="group-call-name">${Utils.escapeHtml(payload.user.username)}</span>
                            `;
                            participants.appendChild(newParticipant);
                        }
                    }
                }
                break;

            case 'group_call_user_left':
                console.log('[Voice WS] User left group call:', payload);
                if (window.Voice && Voice.currentGroupCall?.id === payload.groupId) {
                    Voice.closePeer(payload.userId);
                    
                    // Update UI
                    const participant = document.querySelector(`.group-call-participant[data-user-id="${payload.userId}"]`);
                    if (participant) participant.remove();
                }
                break;

            case 'group_call_deleted':
                console.log('[Voice WS] Group call deleted:', payload);
                if (window.Voice && Voice.currentGroupCall?.id === payload.groupId) {
                    Voice.leaveGroupCall();
                    this.showNotification('Конфа завершена', 'Владелец завершил конфу');
                }
                break;

            case 'group_call_invite':
                console.log('[Voice WS] Group call invite:', payload);
                // Show incoming call modal for group call invite
                if (window.Voice) {
                    Voice.showIncomingGroupCall(payload);
                }
                break;

            default:
                console.log('Unknown WS message type:', type);
        }
    },

    showFriendRequestNotification(request) {
        const user = request.user;
        const message = `${user.username}${user.tag} отправил вам запрос в друзья`;
        
        // Browser notification
        if ('Notification' in window && Notification.permission === 'granted') {
            new Notification('Новый запрос в друзья', {
                body: message,
                icon: user.avatar || '/assets/favicon.svg',
                tag: 'friend-request-' + request.id
            });
        }

        // In-app notification
        this.showNotification('Новый запрос в друзья', message);
    },

    showNotification(title, message) {
        // Create notification element
        const notification = document.createElement('div');
        notification.className = 'notification-toast';
        notification.innerHTML = `
            <div class="notification-title">${Utils.escapeHtml(title)}</div>
            <div class="notification-message">${Utils.escapeHtml(message)}</div>
        `;
        
        document.body.appendChild(notification);
        
        // Animate in
        setTimeout(() => notification.classList.add('show'), 10);
        
        // Remove after 5 seconds
        setTimeout(() => {
            notification.classList.remove('show');
            setTimeout(() => notification.remove(), 300);
        }, 5000);
    },

    // Play pleasant notification sound (Discord-like "pop")
    playNotificationSound() {
        try {
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            
            const ctx = this.audioContext;
            const now = ctx.currentTime;
            
            // Create a pleasant two-tone "pop" sound
            const playTone = (freq, startTime, duration, volume) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                
                osc.connect(gain);
                gain.connect(ctx.destination);
                
                osc.frequency.value = freq;
                osc.type = 'sine';
                
                // Smooth envelope
                gain.gain.setValueAtTime(0, startTime);
                gain.gain.linearRampToValueAtTime(volume, startTime + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, startTime + duration);
                
                osc.start(startTime);
                osc.stop(startTime + duration);
            };
            
            // Two pleasant tones (like Discord notification)
            playTone(880, now, 0.15, 0.15);        // A5
            playTone(1318.5, now + 0.08, 0.12, 0.12); // E6
            
        } catch (e) {
            console.error('Failed to play notification sound:', e);
        }
    },

    // Play message send sound (softer)
    playMessageSentSound() {
        try {
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            
            const ctx = this.audioContext;
            const now = ctx.currentTime;
            
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            
            osc.connect(gain);
            gain.connect(ctx.destination);
            
            osc.frequency.value = 600;
            osc.type = 'sine';
            
            gain.gain.setValueAtTime(0, now);
            gain.gain.linearRampToValueAtTime(0.08, now + 0.01);
            gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
            
            osc.start(now);
            osc.stop(now + 0.1);
        } catch (e) {
            // Silent fail
        }
    },

    // Play call ringtone
    playCallRingtone() {
        if (this.ringtoneInterval) return; // Already playing
        
        try {
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            
            const playRing = () => {
                const ctx = this.audioContext;
                const now = ctx.currentTime;
                
                // Classic phone ring pattern
                const playTone = (freq, start, dur) => {
                    const osc = ctx.createOscillator();
                    const gain = ctx.createGain();
                    osc.connect(gain);
                    gain.connect(ctx.destination);
                    osc.frequency.value = freq;
                    osc.type = 'sine';
                    gain.gain.setValueAtTime(0.15, start);
                    gain.gain.setValueAtTime(0, start + dur);
                    osc.start(start);
                    osc.stop(start + dur);
                };
                
                // Two-tone ring
                playTone(440, now, 0.15);
                playTone(480, now, 0.15);
                playTone(440, now + 0.2, 0.15);
                playTone(480, now + 0.2, 0.15);
            };
            
            playRing();
            this.ringtoneInterval = setInterval(playRing, 1500);
        } catch (e) {
            console.error('Failed to play ringtone:', e);
        }
    },

    stopCallRingtone() {
        if (this.ringtoneInterval) {
            clearInterval(this.ringtoneInterval);
            this.ringtoneInterval = null;
        }
    },

    // Play call connect sound
    playCallConnectSound() {
        try {
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            
            const ctx = this.audioContext;
            const now = ctx.currentTime;
            
            // Pleasant ascending tones
            const playTone = (freq, start, dur, vol) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.frequency.value = freq;
                osc.type = 'sine';
                gain.gain.setValueAtTime(0, start);
                gain.gain.linearRampToValueAtTime(vol, start + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
                osc.start(start);
                osc.stop(start + dur);
            };
            
            playTone(523.25, now, 0.15, 0.12);       // C5
            playTone(659.25, now + 0.1, 0.15, 0.12); // E5
            playTone(783.99, now + 0.2, 0.2, 0.15);  // G5
        } catch (e) {
            // Silent fail
        }
    },

    // Play call end sound
    playCallEndSound() {
        try {
            if (!this.audioContext) {
                this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
            }
            
            const ctx = this.audioContext;
            const now = ctx.currentTime;
            
            // Descending tones
            const playTone = (freq, start, dur, vol) => {
                const osc = ctx.createOscillator();
                const gain = ctx.createGain();
                osc.connect(gain);
                gain.connect(ctx.destination);
                osc.frequency.value = freq;
                osc.type = 'sine';
                gain.gain.setValueAtTime(0, start);
                gain.gain.linearRampToValueAtTime(vol, start + 0.02);
                gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
                osc.start(start);
                osc.stop(start + dur);
            };
            
            playTone(523.25, now, 0.2, 0.1);        // C5
            playTone(392, now + 0.15, 0.25, 0.08);  // G4
        } catch (e) {
            // Silent fail
        }
    }
};
