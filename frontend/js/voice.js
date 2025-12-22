/**
 * Flash Voice System - WebRTC Voice & Video Calls
 * Discord-like voice channels and calls
 */
const Voice = {
    // State
    currentChannel: null,
    localStream: null,
    peers: new Map(), // peerId -> { connection, stream, audioElement }
    isMuted: false,
    isDeafened: false,
    isCameraOn: false,
    isScreenSharing: false,
    
    // Audio context for voice activity detection
    audioContext: null,
    analyser: null,
    voiceActivityInterval: null,
    
    // Settings
    settings: {
        inputDevice: 'default',
        outputDevice: 'default',
        inputVolume: 100,
        outputVolume: 100,
        inputSensitivity: 50,
        noiseSuppression: true,
        echoCancellation: true,
        autoGainControl: true,
        pushToTalk: false,
        pushToTalkKey: 'KeyV'
    },

    // Initialize voice system
    async init() {
        console.log('[Voice] Initializing voice system');
        this.loadSettings();
        this.bindEvents();
        this.setupPushToTalk();
        await this.getDevices();
    },

    // Load settings from localStorage
    loadSettings() {
        const saved = Utils.storage.get('flash_voice_settings');
        if (saved) {
            this.settings = { ...this.settings, ...saved };
        }
    },

    // Save settings to localStorage
    saveSettings() {
        Utils.storage.set('flash_voice_settings', this.settings);
    },

    // Get available audio/video devices
    async getDevices() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            this.audioInputDevices = devices.filter(d => d.kind === 'audioinput');
            this.audioOutputDevices = devices.filter(d => d.kind === 'audiooutput');
            this.videoInputDevices = devices.filter(d => d.kind === 'videoinput');
            console.log('[Voice] Devices:', {
                inputs: this.audioInputDevices.length,
                outputs: this.audioOutputDevices.length,
                cameras: this.videoInputDevices.length
            });
            return { 
                audioInputs: this.audioInputDevices, 
                audioOutputs: this.audioOutputDevices,
                videoInputs: this.videoInputDevices
            };
        } catch (e) {
            console.error('[Voice] Failed to get devices:', e);
            return { audioInputs: [], audioOutputs: [], videoInputs: [] };
        }
    },

    // Bind WebSocket events for voice
    bindEvents() {
        // These will be called from WS.handleMessage
    },

    // Setup Push-to-Talk
    setupPushToTalk() {
        document.addEventListener('keydown', (e) => {
            if (this.settings.pushToTalk && e.code === this.settings.pushToTalkKey && this.currentChannel) {
                if (this.isMuted) {
                    this.unmute();
                }
            }
        });

        document.addEventListener('keyup', (e) => {
            if (this.settings.pushToTalk && e.code === this.settings.pushToTalkKey && this.currentChannel) {
                this.mute();
            }
        });
    },

    // Join voice channel
    async joinChannel(channelId, channelName) {
        if (this.currentChannel === channelId) {
            console.log('[Voice] Already in this channel');
            return;
        }

        // Leave current channel if any
        if (this.currentChannel) {
            await this.leaveChannel();
        }

        console.log('[Voice] Joining channel:', channelId);

        try {
            // Get user media with high quality audio settings
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    deviceId: this.settings.inputDevice !== 'default' ? { exact: this.settings.inputDevice } : undefined,
                    noiseSuppression: this.settings.noiseSuppression,
                    echoCancellation: this.settings.echoCancellation,
                    autoGainControl: this.settings.autoGainControl,
                    sampleRate: 48000,
                    sampleSize: 16,
                    channelCount: 1
                },
                video: false
            });

            this.currentChannel = channelId;
            this.currentChannelName = channelName;
            
            // Add self to voice channel users in Store
            const user = Store.state.user;
            Store.addVoiceChannelUser(channelId, {
                id: user.id,
                username: user.username,
                avatar: user.avatar,
                muted: this.isMuted,
                deafened: this.isDeafened
            });
            
            // Re-render channels to show self
            if (window.App && Store.state.currentServer) {
                App.renderChannels();
            }
            
            // Setup voice activity detection
            this.setupVoiceActivityDetection();

            // Apply initial mute state
            if (this.settings.pushToTalk) {
                this.mute();
            }

            // Notify server
            WS.send('voice_join', { channelId });

            // Show voice panel
            this.showVoicePanel(channelName);

            console.log('[Voice] Joined channel successfully');

        } catch (e) {
            console.error('[Voice] Failed to join channel:', e);
            this.showError('Не удалось получить доступ к микрофону');
        }
    },

    // Leave voice channel
    async leaveChannel() {
        if (!this.currentChannel) return;

        console.log('[Voice] Leaving channel:', this.currentChannel);
        
        const channelId = this.currentChannel;

        // Close all peer connections
        for (const [peerId, peer] of this.peers) {
            this.closePeer(peerId);
        }
        this.peers.clear();

        // Stop local stream
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }

        // Stop voice activity detection
        if (this.voiceActivityInterval) {
            clearInterval(this.voiceActivityInterval);
            this.voiceActivityInterval = null;
        }

        // Notify server
        WS.send('voice_leave', { channelId: this.currentChannel });

        // Remove self from Store
        Store.removeVoiceChannelUser(channelId, Store.state.user?.id);
        
        // Re-render channels
        if (window.App && Store.state.currentServer) {
            App.renderChannels();
        }

        this.currentChannel = null;
        this.currentChannelName = null;
        this.isMuted = false;
        this.isDeafened = false;
        this.isCameraOn = false;

        // Hide voice panel
        this.hideVoicePanel();

        console.log('[Voice] Left channel');
    },

    // Setup voice activity detection
    setupVoiceActivityDetection() {
        if (!this.localStream) return;

        this.audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const source = this.audioContext.createMediaStreamSource(this.localStream);
        this.analyser = this.audioContext.createAnalyser();
        this.analyser.fftSize = 256;
        source.connect(this.analyser);

        const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
        let wasSpeaking = false;

        this.voiceActivityInterval = setInterval(() => {
            if (this.isMuted || this.isDeafened) {
                if (wasSpeaking) {
                    this.updateSpeakingIndicator(false);
                    WS.send('voice_speaking', { channelId: this.currentChannel, speaking: false });
                    wasSpeaking = false;
                }
                return;
            }

            this.analyser.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
            const threshold = (100 - this.settings.inputSensitivity) * 1.5;
            const isSpeaking = average > threshold;

            if (isSpeaking !== wasSpeaking) {
                this.updateSpeakingIndicator(isSpeaking);
                WS.send('voice_speaking', { channelId: this.currentChannel, speaking: isSpeaking });
                wasSpeaking = isSpeaking;
            }
        }, 100);
    },

    // Update speaking indicator UI
    updateSpeakingIndicator(isSpeaking) {
        const avatar = document.querySelector('.voice-panel-avatar');
        if (avatar) {
            avatar.classList.toggle('speaking', isSpeaking);
        }

        // Update in participants list
        const myParticipant = document.querySelector(`[data-voice-user="${Store.state.user?.id}"]`);
        if (myParticipant) {
            myParticipant.classList.toggle('speaking', isSpeaking);
        }
    },

    // Mute microphone
    mute() {
        if (!this.localStream) return;
        this.localStream.getAudioTracks().forEach(track => track.enabled = false);
        this.isMuted = true;
        this.updateVoicePanelUI();
        if (this.currentChannel) {
            WS.send('voice_mute', { channelId: this.currentChannel, muted: true });
        }
        // Sync with App user panel
        if (window.App) {
            App.isGlobalMuted = true;
            App.updateMuteButtonUI();
        }
        console.log('[Voice] Muted');
    },

    // Unmute microphone
    unmute() {
        if (!this.localStream || this.isDeafened) return;
        this.localStream.getAudioTracks().forEach(track => track.enabled = true);
        this.isMuted = false;
        this.updateVoicePanelUI();
        if (this.currentChannel) {
            WS.send('voice_mute', { channelId: this.currentChannel, muted: false });
        }
        // Sync with App user panel
        if (window.App) {
            App.isGlobalMuted = false;
            App.updateMuteButtonUI();
        }
        console.log('[Voice] Unmuted');
    },

    // Toggle mute
    toggleMute() {
        if (this.isMuted) {
            this.unmute();
        } else {
            this.mute();
        }
    },

    // Deafen (mute all audio)
    deafen() {
        // Remember mute state before deafen
        if (window.App) {
            App.wasMutedBeforeDeafen = this.isMuted;
        }
        
        this.isDeafened = true;
        this.isMuted = true;
        if (this.localStream) {
            this.localStream.getAudioTracks().forEach(track => track.enabled = false);
        }
        
        // Mute all peer audio
        for (const [peerId, peer] of this.peers) {
            if (peer.audioElement) {
                peer.audioElement.muted = true;
            }
        }
        
        this.updateVoicePanelUI();
        if (this.currentChannel) {
            WS.send('voice_deafen', { channelId: this.currentChannel, deafened: true });
        }
        // Sync with App user panel
        if (window.App) {
            App.isGlobalMuted = true;
            App.isGlobalDeafened = true;
            App.updateMuteButtonUI();
            App.updateDeafenButtonUI();
        }
        console.log('[Voice] Deafened');
    },

    // Undeafen
    undeafen() {
        this.isDeafened = false;
        
        // Restore previous mute state
        const wasMuted = window.App ? App.wasMutedBeforeDeafen : false;
        this.isMuted = wasMuted;
        
        if (this.localStream) {
            this.localStream.getAudioTracks().forEach(track => track.enabled = !wasMuted);
        }
        
        // Unmute all peer audio
        for (const [peerId, peer] of this.peers) {
            if (peer.audioElement) {
                peer.audioElement.muted = false;
            }
        }
        
        this.updateVoicePanelUI();
        if (this.currentChannel) {
            WS.send('voice_deafen', { channelId: this.currentChannel, deafened: false });
        }
        // Sync with App user panel
        if (window.App) {
            App.isGlobalMuted = wasMuted;
            App.isGlobalDeafened = false;
            App.updateMuteButtonUI();
            App.updateDeafenButtonUI();
        }
        console.log('[Voice] Undeafened');
    },

    // Toggle deafen
    toggleDeafen() {
        if (this.isDeafened) {
            this.undeafen();
        } else {
            this.deafen();
        }
    },

    // Toggle camera
    async toggleCamera() {
        if (this.isCameraOn) {
            // Turn off camera
            if (this.localStream) {
                this.localStream.getVideoTracks().forEach(track => {
                    track.stop();
                    this.localStream.removeTrack(track);
                });
            }
            this.isCameraOn = false;
        } else {
            // Turn on camera
            try {
                const videoStream = await navigator.mediaDevices.getUserMedia({ video: true });
                const videoTrack = videoStream.getVideoTracks()[0];
                
                if (this.localStream) {
                    this.localStream.addTrack(videoTrack);
                }
                
                // Add to peer connections
                for (const [peerId, peer] of this.peers) {
                    const sender = peer.connection.getSenders().find(s => s.track?.kind === 'video');
                    if (sender) {
                        sender.replaceTrack(videoTrack);
                    } else {
                        peer.connection.addTrack(videoTrack, this.localStream);
                    }
                }
                
                this.isCameraOn = true;
            } catch (e) {
                console.error('[Voice] Failed to enable camera:', e);
                alert('Не удалось включить камеру');
            }
        }
        this.updateCallUIButtons();
    },

    // Toggle screen sharing
    async toggleScreenShare() {
        if (this.isScreenSharing) {
            // Stop screen sharing
            if (this.screenStream) {
                this.screenStream.getTracks().forEach(track => track.stop());
            }
            
            // Remove video track from peers
            for (const [peerId, peer] of this.peers) {
                if (peer.screenSender) {
                    try {
                        peer.connection.removeTrack(peer.screenSender);
                        peer.screenSender = null;
                    } catch (e) {
                        console.error('[Voice] Failed to remove screen track:', e);
                    }
                }
            }
            
            this.screenStream = null;
            this.isScreenSharing = false;
            
            // Remove screen share video element
            const screenVideo = document.getElementById('screen-share-video');
            if (screenVideo) screenVideo.remove();
            
            // Remove has-screen-share class
            const callContainer = document.getElementById('embedded-call');
            if (callContainer) {
                callContainer.classList.remove('has-screen-share');
            }
            
            this.updateCallUIButtons();
        } else {
            // Start screen sharing
            try {
                this.screenStream = await navigator.mediaDevices.getDisplayMedia({ 
                    video: {
                        cursor: 'always',
                        displaySurface: 'monitor'
                    },
                    audio: false 
                });
                
                const screenTrack = this.screenStream.getVideoTracks()[0];
                
                // Handle when user stops sharing via browser UI
                screenTrack.onended = () => {
                    this.isScreenSharing = false;
                    
                    // Remove video track from peers
                    for (const [peerId, peer] of this.peers) {
                        if (peer.screenSender) {
                            try {
                                peer.connection.removeTrack(peer.screenSender);
                                peer.screenSender = null;
                            } catch (e) {}
                        }
                    }
                    
                    this.screenStream = null;
                    const screenVideo = document.getElementById('screen-share-video');
                    if (screenVideo) screenVideo.remove();
                    const callContainer = document.getElementById('embedded-call');
                    if (callContainer) {
                        callContainer.classList.remove('has-screen-share');
                    }
                    this.updateCallUIButtons();
                };
                
                // Show local preview of screen share
                this.showScreenSharePreview(this.screenStream);
                
                // Add video track to peer connections
                for (const [peerId, peer] of this.peers) {
                    try {
                        // Add screen track
                        peer.screenSender = peer.connection.addTrack(screenTrack, this.screenStream);
                        console.log('[Voice] Added screen track to peer:', peerId);
                    } catch (e) {
                        console.error('[Voice] Failed to add screen track:', e);
                    }
                }
                
                this.isScreenSharing = true;
                this.updateCallUIButtons();
                
            } catch (e) {
                console.error('[Voice] Failed to share screen:', e);
                if (e.name !== 'NotAllowedError') {
                    alert('Не удалось начать демонстрацию экрана');
                }
            }
        }
    },

    // Show screen share preview
    showScreenSharePreview(stream) {
        // Remove existing
        const existing = document.getElementById('screen-share-video');
        if (existing) existing.remove();
        
        const callContainer = document.getElementById('embedded-call');
        if (!callContainer) return;
        
        callContainer.classList.add('has-screen-share');
        
        const videoContainer = document.createElement('div');
        videoContainer.className = 'screen-share-container';
        videoContainer.id = 'screen-share-video';
        videoContainer.innerHTML = `
            <video autoplay muted playsinline></video>
            <div class="screen-share-label">
                <svg viewBox="0 0 24 24"><path fill="currentColor" d="M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"/></svg>
                Ваш экран
            </div>
        `;
        
        const video = videoContainer.querySelector('video');
        video.srcObject = stream;
        
        const participants = document.getElementById('call-participants');
        if (participants) {
            callContainer.insertBefore(videoContainer, participants);
        }
    },

    // Create peer connection for a user
    async createPeerConnection(peerId, isInitiator = false) {
        // Check if already exists
        if (this.peers.has(peerId)) {
            console.log('[Voice] Peer connection already exists for:', peerId);
            return this.peers.get(peerId).connection;
        }

        console.log('[Voice] Creating peer connection for:', peerId, 'initiator:', isInitiator);

        // Use ICE servers from config (includes TURN for NAT traversal)
        const config = {
            iceServers: CONFIG.ICE_SERVERS || [
                { urls: 'stun:stun.l.google.com:19302' },
                { urls: 'stun:stun1.l.google.com:19302' }
            ],
            iceCandidatePoolSize: 10
        };

        console.log('[Voice] Using ICE servers:', config.iceServers.length, 'servers');

        const connection = new RTCPeerConnection(config);

        // Add local stream tracks with high quality settings
        if (this.localStream) {
            console.log('[Voice] Adding local tracks to peer connection');
            this.localStream.getTracks().forEach(track => {
                console.log('[Voice] Adding track:', track.kind, track.enabled);
                const sender = connection.addTrack(track, this.localStream);
                
                // Set audio encoding parameters for better quality
                if (track.kind === 'audio' && sender.setParameters) {
                    const params = sender.getParameters();
                    if (!params.encodings) {
                        params.encodings = [{}];
                    }
                    params.encodings[0].maxBitrate = 128000; // 128 kbps for high quality audio
                    sender.setParameters(params).catch(e => console.log('[Voice] Could not set audio params:', e));
                }
            });
        } else {
            console.warn('[Voice] No local stream available!');
        }

        // Handle ICE candidates
        connection.onicecandidate = (event) => {
            if (event.candidate) {
                console.log('[Voice] Sending ICE candidate to:', peerId);
                WS.send('voice_ice_candidate', {
                    channelId: this.currentChannel || null,
                    targetUserId: peerId,
                    candidate: event.candidate
                });
            }
        };

        // Handle ICE connection state
        connection.oniceconnectionstatechange = () => {
            console.log('[Voice] ICE connection state:', connection.iceConnectionState, 'for peer:', peerId);
        };

        // Handle remote stream
        connection.ontrack = (event) => {
            console.log('[Voice] *** Received remote track from:', peerId, '***');
            console.log('[Voice] Track kind:', event.track.kind, 'enabled:', event.track.enabled);
            const stream = event.streams[0];
            if (stream) {
                console.log('[Voice] Stream has', stream.getTracks().length, 'tracks');
                this.handleRemoteStream(peerId, stream);
            }
        };

        // Handle connection state changes
        connection.onconnectionstatechange = () => {
            console.log('[Voice] Connection state:', connection.connectionState, 'for peer:', peerId);
            if (connection.connectionState === 'connected') {
                console.log('[Voice] *** CONNECTED to peer:', peerId, '***');
            }
            if (connection.connectionState === 'disconnected' || connection.connectionState === 'failed') {
                this.closePeer(peerId);
            }
        };

        // Handle negotiation needed (for adding screen share track)
        connection.onnegotiationneeded = async () => {
            console.log('[Voice] Negotiation needed for peer:', peerId);
            // Only renegotiate if we're already connected
            if (connection.signalingState === 'stable') {
                try {
                    const offer = await connection.createOffer();
                    await connection.setLocalDescription(offer);
                    WS.send('voice_offer', {
                        channelId: this.currentChannel || null,
                        targetUserId: peerId,
                        offer: connection.localDescription
                    });
                } catch (e) {
                    console.error('[Voice] Renegotiation failed:', e);
                }
            }
        };

        // Store peer with ICE candidate buffer
        this.peers.set(peerId, { 
            connection, 
            stream: null, 
            audioElement: null,
            iceCandidateBuffer: [],
            remoteDescriptionSet: false
        });

        // If initiator, create and send offer
        if (isInitiator) {
            try {
                console.log('[Voice] Creating offer for:', peerId);
                const offer = await connection.createOffer();
                await connection.setLocalDescription(offer);
                console.log('[Voice] Sending offer to:', peerId);
                WS.send('voice_offer', {
                    channelId: this.currentChannel || null,
                    targetUserId: peerId,
                    offer: connection.localDescription
                });
            } catch (e) {
                console.error('[Voice] Failed to create offer:', e);
            }
        }

        return connection;
    },

    // Handle incoming offer
    async handleOffer(fromUserId, offer) {
        console.log('[Voice] *** Received offer from:', fromUserId, '***');

        let peer = this.peers.get(fromUserId);
        if (!peer) {
            await this.createPeerConnection(fromUserId, false);
            peer = this.peers.get(fromUserId);
        }

        try {
            console.log('[Voice] Setting remote description (offer)');
            await peer.connection.setRemoteDescription(new RTCSessionDescription(offer));
            peer.remoteDescriptionSet = true;
            
            // Process buffered ICE candidates
            if (peer.iceCandidateBuffer && peer.iceCandidateBuffer.length > 0) {
                console.log('[Voice] Processing', peer.iceCandidateBuffer.length, 'buffered ICE candidates');
                for (const candidate of peer.iceCandidateBuffer) {
                    await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
                }
                peer.iceCandidateBuffer = [];
            }
            
            console.log('[Voice] Creating answer');
            const answer = await peer.connection.createAnswer();
            await peer.connection.setLocalDescription(answer);

            console.log('[Voice] Sending answer to:', fromUserId);
            WS.send('voice_answer', {
                channelId: this.currentChannel || null,
                targetUserId: fromUserId,
                answer: peer.connection.localDescription
            });
        } catch (e) {
            console.error('[Voice] Failed to handle offer:', e);
        }
    },

    // Handle incoming answer
    async handleAnswer(fromUserId, answer) {
        console.log('[Voice] *** Received answer from:', fromUserId, '***');

        const peer = this.peers.get(fromUserId);
        if (!peer) {
            console.error('[Voice] No peer connection for:', fromUserId);
            return;
        }

        // Check if we're in the right state to receive an answer
        const signalingState = peer.connection.signalingState;
        console.log('[Voice] Current signaling state:', signalingState);
        
        if (signalingState !== 'have-local-offer') {
            console.log('[Voice] Ignoring answer - not in have-local-offer state');
            return;
        }

        try {
            console.log('[Voice] Setting remote description (answer)');
            await peer.connection.setRemoteDescription(new RTCSessionDescription(answer));
            peer.remoteDescriptionSet = true;
            
            // Process buffered ICE candidates
            if (peer.iceCandidateBuffer && peer.iceCandidateBuffer.length > 0) {
                console.log('[Voice] Processing', peer.iceCandidateBuffer.length, 'buffered ICE candidates');
                for (const candidate of peer.iceCandidateBuffer) {
                    await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
                }
                peer.iceCandidateBuffer = [];
            }
        } catch (e) {
            console.error('[Voice] Failed to handle answer:', e);
        }
    },

    // Handle incoming ICE candidate
    async handleIceCandidate(fromUserId, candidate) {
        let peer = this.peers.get(fromUserId);
        
        // If no peer yet, create one (non-initiator)
        if (!peer) {
            console.log('[Voice] Creating peer connection for incoming ICE candidate');
            await this.createPeerConnection(fromUserId, false);
            peer = this.peers.get(fromUserId);
        }

        // If remote description not set yet, buffer the candidate
        if (!peer.remoteDescriptionSet) {
            console.log('[Voice] Buffering ICE candidate from:', fromUserId);
            peer.iceCandidateBuffer = peer.iceCandidateBuffer || [];
            peer.iceCandidateBuffer.push(candidate);
            return;
        }

        try {
            console.log('[Voice] Adding ICE candidate from:', fromUserId);
            await peer.connection.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (e) {
            console.error('[Voice] Failed to add ICE candidate:', e);
        }
    },

    // Handle remote stream
    handleRemoteStream(peerId, stream) {
        console.log('[Voice] Handling remote stream from:', peerId);
        console.log('[Voice] Stream tracks:', stream.getTracks().map(t => ({ kind: t.kind, enabled: t.enabled, muted: t.muted })));

        const peer = this.peers.get(peerId);
        if (!peer) return;

        peer.stream = stream;

        // Check for video track (screen share)
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
            console.log('[Voice] Received video track (screen share) from:', peerId);
            this.showRemoteScreenShare(peerId, stream);
            
            // Handle track ended
            videoTrack.onended = () => {
                console.log('[Voice] Remote screen share ended');
                this.hideRemoteScreenShare();
            };
        }

        // Create audio element for playback
        let audioElement = peer.audioElement;
        if (!audioElement) {
            audioElement = document.createElement('audio');
            audioElement.autoplay = true;
            audioElement.playsInline = true;
            audioElement.id = `voice-audio-${peerId}`;
            // Important: don't set muted initially
            document.body.appendChild(audioElement);
            peer.audioElement = audioElement;
        }

        audioElement.srcObject = stream;
        audioElement.volume = this.settings.outputVolume / 100;
        audioElement.muted = this.isDeafened;

        // Force play (handle autoplay policy)
        audioElement.play().then(() => {
            console.log('[Voice] Audio playing for peer:', peerId);
        }).catch(e => {
            console.error('[Voice] Failed to play audio:', e);
            // Try to play on user interaction
            document.addEventListener('click', () => {
                audioElement.play().catch(() => {});
            }, { once: true });
        });

        // Set output device if supported
        if (audioElement.setSinkId && this.settings.outputDevice !== 'default') {
            audioElement.setSinkId(this.settings.outputDevice).catch(e => {
                console.error('[Voice] Failed to set output device:', e);
            });
        }

        // Setup voice activity detection for remote stream
        this.setupRemoteVoiceActivityDetection(peerId, stream);
    },

    // Show remote screen share
    showRemoteScreenShare(peerId, stream) {
        // Remove existing
        this.hideRemoteScreenShare();
        
        const callContainer = document.getElementById('embedded-call');
        if (!callContainer) return;
        
        callContainer.classList.add('has-screen-share');
        
        const videoContainer = document.createElement('div');
        videoContainer.className = 'screen-share-container';
        videoContainer.id = 'remote-screen-share';
        
        // Get username
        const peer = this.peers.get(peerId);
        const username = peer?.username || 'Участник';
        
        videoContainer.innerHTML = `
            <video autoplay playsinline></video>
            <div class="screen-share-label">
                <svg viewBox="0 0 24 24"><path fill="currentColor" d="M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"/></svg>
                Экран ${username}
            </div>
        `;
        
        const video = videoContainer.querySelector('video');
        video.srcObject = stream;
        
        const participants = document.getElementById('call-participants');
        if (participants) {
            callContainer.insertBefore(videoContainer, participants);
        }
    },

    // Hide remote screen share
    hideRemoteScreenShare() {
        const existing = document.getElementById('remote-screen-share');
        if (existing) existing.remove();
        
        const callContainer = document.getElementById('embedded-call');
        if (callContainer) {
            callContainer.classList.remove('has-screen-share');
        }
    },

    // Setup voice activity detection for remote peer
    setupRemoteVoiceActivityDetection(peerId, stream) {
        try {
            const audioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = audioContext.createMediaStreamSource(stream);
            const analyser = audioContext.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);

            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            let wasSpeaking = false;

            const peer = this.peers.get(peerId);
            if (peer) {
                peer.voiceActivityInterval = setInterval(() => {
                    analyser.getByteFrequencyData(dataArray);
                    const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
                    const isSpeaking = average > 15; // Lower threshold for remote audio

                    if (isSpeaking !== wasSpeaking) {
                        wasSpeaking = isSpeaking;
                        // Update UI for this peer
                        const participant = document.querySelector(`[data-voice-user="${peerId}"]`);
                        if (participant) {
                            participant.classList.toggle('speaking', isSpeaking);
                        }
                        // Also update voice user in channel list
                        const voiceUser = document.querySelector(`.voice-user[data-user-id="${peerId}"]`);
                        if (voiceUser) {
                            voiceUser.classList.toggle('speaking', isSpeaking);
                        }
                    }
                }, 100);
                peer.audioContext = audioContext;
            }
        } catch (e) {
            console.error('[Voice] Failed to setup remote voice activity detection:', e);
        }
    },

    // Close peer connection
    closePeer(peerId) {
        const peer = this.peers.get(peerId);
        if (!peer) return;

        if (peer.connection) {
            peer.connection.close();
        }

        if (peer.audioElement) {
            peer.audioElement.srcObject = null;
            peer.audioElement.remove();
        }

        // Clean up voice activity detection
        if (peer.voiceActivityInterval) {
            clearInterval(peer.voiceActivityInterval);
        }
        if (peer.audioContext) {
            peer.audioContext.close().catch(() => {});
        }

        this.peers.delete(peerId);
        this.updateParticipantsList();
        console.log('[Voice] Closed peer:', peerId);
    },

    // Handle user joined voice channel
    handleUserJoined(userId, userData) {
        console.log('[Voice] User joined:', userId);
        
        // Only one peer should be initiator - use ID comparison
        // The peer with "greater" ID initiates the connection
        const myId = Store.state.user?.id;
        const shouldInitiate = myId > userId;
        
        console.log('[Voice] My ID:', myId, 'Their ID:', userId, 'Should initiate:', shouldInitiate);
        
        // Create peer connection
        this.createPeerConnection(userId, shouldInitiate);
        
        // Update participants list
        this.updateParticipantsList();
    },

    // Handle user left voice channel
    handleUserLeft(userId) {
        console.log('[Voice] User left:', userId);
        this.closePeer(userId);
    },

    // Handle user speaking state
    handleUserSpeaking(userId, speaking) {
        const participant = document.querySelector(`[data-voice-user="${userId}"]`);
        if (participant) {
            participant.classList.toggle('speaking', speaking);
        }
    },

    // Handle user mute state
    handleUserMuted(userId, muted) {
        const participant = document.querySelector(`[data-voice-user="${userId}"]`);
        if (participant) {
            const muteIcon = participant.querySelector('.voice-mute-icon');
            if (muteIcon) {
                muteIcon.classList.toggle('muted', muted);
            }
        }
    },

    // Show voice panel at bottom
    showVoicePanel(channelName) {
        // Remove existing panel
        this.hideVoicePanel();

        const user = Store.state.user;
        const panel = document.createElement('div');
        panel.className = 'voice-panel';
        panel.id = 'voice-panel';
        panel.innerHTML = `
            <div class="voice-panel-info">
                <div class="voice-panel-avatar ${this.isMuted ? '' : 'can-speak'}" style="background: ${Utils.getUserColor(user.id)}">
                    ${Utils.getInitials(user.username)}
                </div>
                <div class="voice-panel-details">
                    <div class="voice-panel-status">
                        <span class="voice-status-dot"></span>
                        Голосовой канал
                    </div>
                    <div class="voice-panel-channel">${Utils.escapeHtml(channelName)}</div>
                </div>
            </div>
            <div class="voice-panel-controls">
                <button class="voice-btn ${this.isMuted ? 'active' : ''}" id="voice-mute-btn" title="Микрофон">
                    <svg viewBox="0 0 24 24" width="20" height="20">
                        ${this.isMuted ? 
                            '<path fill="currentColor" d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/>' :
                            '<path fill="currentColor" d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/>'
                        }
                    </svg>
                </button>
                <button class="voice-btn ${this.isDeafened ? 'active' : ''}" id="voice-deafen-btn" title="Звук">
                    <svg viewBox="0 0 24 24" width="20" height="20">
                        ${this.isDeafened ?
                            '<path fill="currentColor" d="M4.34 2.93L2.93 4.34 7.29 8.7 7 9H3v6h4l5 5v-6.59l4.18 4.18c-.65.49-1.38.88-2.18 1.11v2.06c1.34-.3 2.57-.92 3.61-1.75l2.05 2.05 1.41-1.41L4.34 2.93zM19 12c0 .82-.15 1.61-.41 2.34l1.53 1.53c.56-1.17.88-2.48.88-3.87 0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zm-7-8l-1.88 1.88L12 7.76zm4.5 8c0-1.77-1.02-3.29-2.5-4.03v1.79l2.48 2.48c.01-.08.02-.16.02-.24z"/>' :
                            '<path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>'
                        }
                    </svg>
                </button>
                <button class="voice-btn" id="voice-settings-btn" title="Настройки">
                    <svg viewBox="0 0 24 24" width="20" height="20">
                        <path fill="currentColor" d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
                    </svg>
                </button>
                <button class="voice-btn voice-btn-disconnect" id="voice-disconnect-btn" title="Отключиться">
                    <svg viewBox="0 0 24 24" width="20" height="20">
                        <path fill="currentColor" d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>
                    </svg>
                </button>
            </div>
        `;

        // Insert before user panel
        const userPanel = document.querySelector('.user-panel');
        if (userPanel) {
            userPanel.parentNode.insertBefore(panel, userPanel);
        }

        // Bind events
        document.getElementById('voice-mute-btn').addEventListener('click', () => this.toggleMute());
        document.getElementById('voice-deafen-btn').addEventListener('click', () => this.toggleDeafen());
        document.getElementById('voice-settings-btn').addEventListener('click', () => this.showSettingsModal());
        document.getElementById('voice-disconnect-btn').addEventListener('click', () => this.leaveChannel());
    },

    // Hide voice panel
    hideVoicePanel() {
        const panel = document.getElementById('voice-panel');
        if (panel) {
            panel.remove();
        }
    },

    // Update voice panel UI
    updateVoicePanelUI() {
        const muteBtn = document.getElementById('voice-mute-btn');
        const deafenBtn = document.getElementById('voice-deafen-btn');
        const avatar = document.querySelector('.voice-panel-avatar');

        if (muteBtn) {
            muteBtn.classList.toggle('active', this.isMuted);
            muteBtn.innerHTML = `
                <svg viewBox="0 0 24 24" width="20" height="20">
                    ${this.isMuted ? 
                        '<path fill="currentColor" d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/>' :
                        '<path fill="currentColor" d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/>'
                    }
                </svg>
            `;
        }

        if (deafenBtn) {
            deafenBtn.classList.toggle('active', this.isDeafened);
            deafenBtn.innerHTML = `
                <svg viewBox="0 0 24 24" width="20" height="20">
                    ${this.isDeafened ?
                        '<path fill="currentColor" d="M4.34 2.93L2.93 4.34 7.29 8.7 7 9H3v6h4l5 5v-6.59l4.18 4.18c-.65.49-1.38.88-2.18 1.11v2.06c1.34-.3 2.57-.92 3.61-1.75l2.05 2.05 1.41-1.41L4.34 2.93zM19 12c0 .82-.15 1.61-.41 2.34l1.53 1.53c.56-1.17.88-2.48.88-3.87 0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zm-7-8l-1.88 1.88L12 7.76zm4.5 8c0-1.77-1.02-3.29-2.5-4.03v1.79l2.48 2.48c.01-.08.02-.16.02-.24z"/>' :
                        '<path fill="currentColor" d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/>'
                    }
                </svg>
            `;
        }

        if (avatar) {
            avatar.classList.toggle('can-speak', !this.isMuted && !this.isDeafened);
        }
    },

    // Update call UI buttons (for DM calls)
    updateCallUIButtons() {
        const muteBtn = document.getElementById('call-mute-btn');
        if (muteBtn) {
            muteBtn.classList.toggle('active', this.isMuted);
            muteBtn.innerHTML = `
                <svg viewBox="0 0 24 24" width="20" height="20">
                    ${this.isMuted ? 
                        '<path fill="currentColor" d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/>' :
                        '<path fill="currentColor" d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/>'
                    }
                </svg>
            `;
        }
        
        const cameraBtn = document.getElementById('call-camera-btn');
        if (cameraBtn) {
            cameraBtn.classList.toggle('active', this.isCameraOn);
        }
        
        const screenBtn = document.getElementById('call-screen-btn');
        if (screenBtn) {
            screenBtn.classList.toggle('active', this.isScreenSharing);
        }
    },

    // Update participants list in voice channel
    updateParticipantsList() {
        // This will be called when participants change
        // Implementation depends on where the list is displayed
    },

    // Show voice settings modal
    showSettingsModal() {
        // Remove existing modal
        const existing = document.getElementById('voice-settings-modal');
        if (existing) existing.remove();

        const modal = document.createElement('div');
        modal.className = 'modal show';
        modal.id = 'voice-settings-modal';
        modal.innerHTML = `
            <div class="modal-content modal-large">
                <div class="modal-header">
                    <h2>Настройки голоса</h2>
                    <button class="modal-close" onclick="document.getElementById('voice-settings-modal').remove()">&times;</button>
                </div>
                <div class="voice-settings-container">
                    <div class="voice-settings-section">
                        <h3>Устройство ввода</h3>
                        <select id="voice-input-device" class="voice-select">
                            <option value="default">По умолчанию</option>
                        </select>
                        <div class="voice-meter-container">
                            <label>Тест микрофона</label>
                            <div class="voice-meter">
                                <div class="voice-meter-bar" id="voice-meter-bar"></div>
                            </div>
                        </div>
                        <div class="voice-checkbox" style="margin-bottom: 16px;">
                            <input type="checkbox" id="voice-loopback">
                            <label for="voice-loopback">Прослушать себя (loopback)</label>
                        </div>
                        <div class="voice-slider-container">
                            <label>Громкость ввода: <span id="input-volume-value">${this.settings.inputVolume}%</span></label>
                            <input type="range" id="voice-input-volume" min="0" max="200" value="${this.settings.inputVolume}">
                        </div>
                        <div class="voice-slider-container">
                            <label>Чувствительность: <span id="sensitivity-value">${this.settings.inputSensitivity}%</span></label>
                            <input type="range" id="voice-sensitivity" min="0" max="100" value="${this.settings.inputSensitivity}">
                        </div>
                    </div>
                    
                    <div class="voice-settings-section">
                        <h3>Устройство вывода</h3>
                        <select id="voice-output-device" class="voice-select">
                            <option value="default">По умолчанию</option>
                        </select>
                        <div class="voice-slider-container">
                            <label>Громкость вывода: <span id="output-volume-value">${this.settings.outputVolume}%</span></label>
                            <input type="range" id="voice-output-volume" min="0" max="200" value="${this.settings.outputVolume}">
                        </div>
                        <button class="btn btn-secondary" id="voice-test-sound">Тест звука</button>
                    </div>
                    
                    <div class="voice-settings-section">
                        <h3>Дополнительно</h3>
                        <div class="voice-checkbox">
                            <input type="checkbox" id="voice-noise-suppression" ${this.settings.noiseSuppression ? 'checked' : ''}>
                            <label for="voice-noise-suppression">Шумоподавление</label>
                        </div>
                        <div class="voice-checkbox">
                            <input type="checkbox" id="voice-echo-cancellation" ${this.settings.echoCancellation ? 'checked' : ''}>
                            <label for="voice-echo-cancellation">Эхоподавление</label>
                        </div>
                        <div class="voice-checkbox">
                            <input type="checkbox" id="voice-auto-gain" ${this.settings.autoGainControl ? 'checked' : ''}>
                            <label for="voice-auto-gain">Автоматическая регулировка громкости</label>
                        </div>
                        <div class="voice-checkbox">
                            <input type="checkbox" id="voice-push-to-talk" ${this.settings.pushToTalk ? 'checked' : ''}>
                            <label for="voice-push-to-talk">Push-to-Talk (клавиша V)</label>
                        </div>
                    </div>
                </div>
                <div class="modal-actions">
                    <button class="btn btn-secondary" onclick="document.getElementById('voice-settings-modal').remove()">Закрыть</button>
                    <button class="btn btn-primary" id="voice-save-settings">Сохранить</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Populate device lists
        this.populateDeviceLists();

        // Start mic test
        this.startMicTest();

        // Bind events
        this.bindSettingsEvents();
    },

    // Populate device select lists
    async populateDeviceLists() {
        const devices = await this.getDevices();

        const inputSelect = document.getElementById('voice-input-device');
        const outputSelect = document.getElementById('voice-output-device');

        if (inputSelect) {
            devices.audioInputs.forEach(device => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.textContent = device.label || `Микрофон ${inputSelect.options.length}`;
                if (device.deviceId === this.settings.inputDevice) option.selected = true;
                inputSelect.appendChild(option);
            });
        }

        if (outputSelect) {
            devices.audioOutputs.forEach(device => {
                const option = document.createElement('option');
                option.value = device.deviceId;
                option.textContent = device.label || `Динамик ${outputSelect.options.length}`;
                if (device.deviceId === this.settings.outputDevice) option.selected = true;
                outputSelect.appendChild(option);
            });
        }
    },

    // Start microphone test
    startMicTest() {
        // Store test stream and audio context for cleanup
        this.testStream = null;
        this.testAudioContext = null;
        this.loopbackAudio = null;

        navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
            this.testStream = stream;
            this.testAudioContext = new (window.AudioContext || window.webkitAudioContext)();
            const source = this.testAudioContext.createMediaStreamSource(stream);
            const analyser = this.testAudioContext.createAnalyser();
            analyser.fftSize = 256;
            source.connect(analyser);

            // Store for loopback
            this.testSource = source;
            this.testAnalyser = analyser;

            const dataArray = new Uint8Array(analyser.frequencyBinCount);
            const meterBar = document.getElementById('voice-meter-bar');

            const updateMeter = () => {
                if (!document.getElementById('voice-settings-modal')) {
                    // Cleanup when modal closes
                    if (this.testStream) {
                        this.testStream.getTracks().forEach(t => t.stop());
                        this.testStream = null;
                    }
                    if (this.loopbackAudio) {
                        this.loopbackAudio.srcObject = null;
                        this.loopbackAudio.remove();
                        this.loopbackAudio = null;
                    }
                    return;
                }
                analyser.getByteFrequencyData(dataArray);
                const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
                const percent = Math.min(100, (average / 128) * 100);
                if (meterBar) meterBar.style.width = percent + '%';
                requestAnimationFrame(updateMeter);
            };
            updateMeter();
        }).catch(e => console.error('[Voice] Mic test failed:', e));
    },

    // Toggle loopback (hear yourself)
    toggleLoopback(enabled) {
        if (enabled) {
            if (this.testStream && !this.loopbackAudio) {
                this.loopbackAudio = document.createElement('audio');
                this.loopbackAudio.srcObject = this.testStream;
                this.loopbackAudio.volume = 0.5;
                this.loopbackAudio.play().catch(e => console.error('[Voice] Loopback play failed:', e));
            }
        } else {
            if (this.loopbackAudio) {
                this.loopbackAudio.srcObject = null;
                this.loopbackAudio.remove();
                this.loopbackAudio = null;
            }
        }
    },

    // Bind settings modal events
    bindSettingsEvents() {
        // Loopback checkbox
        const loopbackCheckbox = document.getElementById('voice-loopback');
        if (loopbackCheckbox) {
            loopbackCheckbox.addEventListener('change', (e) => {
                this.toggleLoopback(e.target.checked);
            });
        }

        // Input volume
        const inputVolume = document.getElementById('voice-input-volume');
        if (inputVolume) {
            inputVolume.addEventListener('input', (e) => {
                this.settings.inputVolume = parseInt(e.target.value);
                document.getElementById('input-volume-value').textContent = this.settings.inputVolume + '%';
            });
        }

        // Output volume
        const outputVolume = document.getElementById('voice-output-volume');
        if (outputVolume) {
            outputVolume.addEventListener('input', (e) => {
                this.settings.outputVolume = parseInt(e.target.value);
                document.getElementById('output-volume-value').textContent = this.settings.outputVolume + '%';
                // Apply to all peer audio elements
                for (const [peerId, peer] of this.peers) {
                    if (peer.audioElement) {
                        peer.audioElement.volume = this.settings.outputVolume / 100;
                    }
                }
            });
        }

        // Sensitivity
        const sensitivity = document.getElementById('voice-sensitivity');
        if (sensitivity) {
            sensitivity.addEventListener('input', (e) => {
                this.settings.inputSensitivity = parseInt(e.target.value);
                document.getElementById('sensitivity-value').textContent = this.settings.inputSensitivity + '%';
            });
        }

        // Test sound
        const testSound = document.getElementById('voice-test-sound');
        if (testSound) {
            testSound.addEventListener('click', () => {
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                const oscillator = audioContext.createOscillator();
                const gainNode = audioContext.createGain();
                oscillator.connect(gainNode);
                gainNode.connect(audioContext.destination);
                oscillator.frequency.value = 440;
                gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
                gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
                oscillator.start(audioContext.currentTime);
                oscillator.stop(audioContext.currentTime + 0.5);
            });
        }

        // Checkboxes
        ['noise-suppression', 'echo-cancellation', 'auto-gain', 'push-to-talk'].forEach(id => {
            const checkbox = document.getElementById(`voice-${id}`);
            if (checkbox) {
                checkbox.addEventListener('change', (e) => {
                    const key = id.replace(/-([a-z])/g, (g) => g[1].toUpperCase());
                    this.settings[key] = e.target.checked;
                });
            }
        });

        // Device selects
        const inputDevice = document.getElementById('voice-input-device');
        if (inputDevice) {
            inputDevice.addEventListener('change', (e) => {
                this.settings.inputDevice = e.target.value;
            });
        }

        const outputDevice = document.getElementById('voice-output-device');
        if (outputDevice) {
            outputDevice.addEventListener('change', (e) => {
                this.settings.outputDevice = e.target.value;
            });
        }

        // Save button
        const saveBtn = document.getElementById('voice-save-settings');
        if (saveBtn) {
            saveBtn.addEventListener('click', () => {
                this.saveSettings();
                document.getElementById('voice-settings-modal').remove();
            });
        }
    },

    // Show error notification
    showError(message) {
        if (window.WS && WS.showNotification) {
            WS.showNotification('Ошибка', message);
        } else {
            alert(message);
        }
    },

    // DM Call Methods
    
    // Show incoming call UI
    showIncomingCall(payload) {
        console.log('[Voice] Showing incoming call from:', payload);
        
        // If we're waiting for partner to rejoin, auto-accept the call
        if (this.waitingForPartner && this.currentCall && this.currentCall.dmId === payload.dmId) {
            console.log('[Voice] Partner is calling back, auto-accepting');
            this.pendingCall = payload;
            this.acceptCall();
            return;
        }
        
        // Remove existing call modal
        const existing = document.getElementById('incoming-call-modal');
        if (existing) existing.remove();

        const caller = payload.caller || { username: 'Пользователь' };
        
        const modal = document.createElement('div');
        modal.className = 'modal show';
        modal.id = 'incoming-call-modal';
        modal.innerHTML = `
            <div class="modal-content incoming-call-modal">
                <div class="call-avatar" style="background: ${Utils.getUserColor(caller.id)}">
                    ${Utils.getInitials(caller.username)}
                </div>
                <h2>${Utils.escapeHtml(caller.username)}</h2>
                <p class="call-status">Входящий звонок...</p>
                <div class="call-actions">
                    <button class="call-btn call-accept" id="accept-call-btn">
                        <svg viewBox="0 0 24 24" width="24" height="24">
                            <path fill="currentColor" d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/>
                        </svg>
                    </button>
                    <button class="call-btn call-reject" id="reject-call-btn">
                        <svg viewBox="0 0 24 24" width="24" height="24">
                            <path fill="currentColor" d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>
                        </svg>
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Store call info
        this.pendingCall = payload;

        // Play ringtone
        this.playRingtone();

        // Bind events
        document.getElementById('accept-call-btn').addEventListener('click', () => {
            this.acceptCall();
        });

        document.getElementById('reject-call-btn').addEventListener('click', () => {
            this.rejectCall();
        });
    },

    // Accept incoming call
    async acceptCall() {
        if (!this.pendingCall) return;

        this.stopRingtone();
        
        // Play connect sound
        if (window.WS) WS.playCallConnectSound();
        
        const modal = document.getElementById('incoming-call-modal');
        if (modal) modal.remove();

        // Check if we're already in a call (waiting for partner to rejoin)
        const isRejoining = this.waitingForPartner && this.currentCall;

        // Get user media and setup call
        try {
            // Only get new media if we don't have it already
            if (!this.localStream) {
                this.localStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        noiseSuppression: this.settings.noiseSuppression,
                        echoCancellation: this.settings.echoCancellation,
                        autoGainControl: this.settings.autoGainControl,
                        sampleRate: 48000,
                        sampleSize: 16,
                        channelCount: 1
                    },
                    video: false
                });
            }

            // Send accept message
            WS.send('dm_call_accept', {
                dmId: this.pendingCall.dmId,
                callerId: this.pendingCall.callerId
            });

            if (isRejoining) {
                // Partner is rejoining - clear timeout and update UI
                console.log('[Voice] Partner rejoining, clearing timeout');
                this.clearDMAloneTimeout();
                this.waitingForPartner = false;
                
                // Update UI
                const status = document.querySelector('.embedded-call-title');
                if (status) {
                    status.textContent = 'Звонок';
                }
                
                // Remove disconnected state
                const participants = document.querySelectorAll('.embedded-call-participant.disconnected');
                participants.forEach(p => p.classList.remove('disconnected'));
            } else {
                // Normal accept - setup call UI
                this.showCallUI(this.pendingCall.caller);
                this.currentCall = { dmId: this.pendingCall.dmId, targetUser: this.pendingCall.caller };
            }
            
            // Create peer connection - acceptor waits for offer from caller
            // The caller will initiate after receiving dm_call_accepted
            console.log('[Voice] Call accepted, waiting for offer from caller:', this.pendingCall.callerId);
            
            this.pendingCall = null;

        } catch (e) {
            console.error('[Voice] Failed to accept call:', e);
            this.showError('Не удалось получить доступ к микрофону');
            this.rejectCall();
        }
    },

    // Reject incoming call
    rejectCall() {
        if (!this.pendingCall) return;

        this.stopRingtone();

        WS.send('dm_call_reject', {
            dmId: this.pendingCall.dmId,
            callerId: this.pendingCall.callerId
        });

        const modal = document.getElementById('incoming-call-modal');
        if (modal) modal.remove();

        this.pendingCall = null;
    },

    // Handle call accepted by other party
    handleCallAccepted(payload) {
        console.log('[Voice] Call accepted:', payload);
        
        // Play connect sound
        if (window.WS) WS.playCallConnectSound();
        
        // If we were disconnected and rejoining, restore UI
        if (this.isDisconnected) {
            this.clearSelfDisconnectTimeout();
            this.isDisconnected = false;
            this.restoreCallUI();
        }
        
        // Update call UI
        const title = document.querySelector('.embedded-call-title');
        if (title) {
            title.textContent = 'Звонок';
        }
        
        const avatar = document.querySelector('.call-avatar');
        if (avatar) {
            avatar.classList.add('connected');
        }
        
        // Remove disconnected state from partner
        const participants = document.querySelectorAll('.embedded-call-participant.disconnected');
        participants.forEach(p => p.classList.remove('disconnected'));
        
        // Start timer
        this.startCallTimer();
        
        // Create peer connection and send offer (caller initiates)
        this.createPeerConnection(payload.userId, true);
    },

    // Handle call rejected by other party
    handleCallRejected(payload) {
        console.log('[Voice] Call rejected:', payload);
        
        this.endCall();
        WS.showNotification('Звонок отклонён', 'Пользователь отклонил звонок');
    },

    // Handle call ended
    handleCallEnded(payload) {
        console.log('[Voice] Call ended:', payload);
        
        // Always try to close incoming call modal if it exists
        const modal = document.getElementById('incoming-call-modal');
        if (modal) {
            console.log('[Voice] Closing incoming call modal');
            this.stopRingtone();
            modal.remove();
            this.pendingCall = null;
        }
        
        // If we had a pending call for this DM, we're done
        if (this.pendingCall && this.pendingCall.dmId === payload.dmId) {
            this.stopRingtone();
            this.pendingCall = null;
            return;
        }
        
        // If we're disconnected (already left) and partner also leaves - end call completely
        if (this.isDisconnected && this.currentCall && this.currentCall.dmId === payload.dmId) {
            console.log('[Voice] Both users left, ending call completely');
            this.clearSelfDisconnectTimeout();
            this.hideCallUI();
            this.currentCall = null;
            this.isDisconnected = false;
            return;
        }
        
        // For DM calls - don't end immediately, start 3 minute timeout
        if (this.currentCall && this.currentCall.dmId === payload.dmId) {
            this.handleDMPartnerLeft();
            return;
        }
        
        this.endCall(true);
    },

    // Handle when DM call partner leaves - start 3 minute timeout
    handleDMPartnerLeft() {
        console.log('[Voice] DM partner left, starting 3 minute timeout');
        
        // Close peer connections since partner left
        for (const [peerId, peer] of this.peers) {
            this.closePeer(peerId);
        }
        this.peers.clear();
        
        // Mark that we're waiting for partner
        this.waitingForPartner = true;
        
        // Update UI to show waiting state
        const status = document.querySelector('.embedded-call-title');
        if (status) {
            status.textContent = 'Ожидание...';
        }
        
        // Remove partner from participants UI
        const participants = document.querySelectorAll('.embedded-call-participant:not(.me)');
        participants.forEach(p => p.classList.add('disconnected'));
        
        // Start 3 minute (180 second) timeout
        this.dmAloneTimeout = setTimeout(() => {
            console.log('[Voice] 3 minute timeout reached, ending call');
            WS.showNotification('Звонок завершён', 'Время ожидания истекло');
            this.endCall(true);
        }, 180000); // 3 minutes
        
        // Show countdown in UI
        this.dmAloneStartTime = Date.now();
        this.dmAloneInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - this.dmAloneStartTime) / 1000);
            const remaining = 180 - elapsed;
            if (remaining <= 0) {
                clearInterval(this.dmAloneInterval);
                return;
            }
            const mins = Math.floor(remaining / 60);
            const secs = remaining % 60;
            const status = document.querySelector('.embedded-call-title');
            if (status) {
                status.textContent = `Ожидание... ${mins}:${secs.toString().padStart(2, '0')}`;
            }
        }, 1000);
    },

    // Handle partner rejoining the call
    handlePartnerRejoined(payload) {
        console.log('[Voice] Partner rejoined:', payload);
        
        // Clear the timeout
        this.clearDMAloneTimeout();
        this.waitingForPartner = false;
        
        // Update UI
        const status = document.querySelector('.embedded-call-title');
        if (status) {
            status.textContent = 'Звонок';
        }
        
        // Remove disconnected state from partner
        const participants = document.querySelectorAll('.embedded-call-participant.disconnected');
        participants.forEach(p => p.classList.remove('disconnected'));
        
        // Create peer connection with rejoined partner
        const myId = Store.state.user?.id;
        const shouldInitiate = myId > payload.userId;
        this.createPeerConnection(payload.userId, shouldInitiate);
    },

    // Rejoin a DM call (when partner is still waiting)
    async rejoinCall(dmId, targetUser) {
        console.log('[Voice] Rejoining call:', dmId);
        
        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    noiseSuppression: this.settings.noiseSuppression,
                    echoCancellation: this.settings.echoCancellation,
                    autoGainControl: this.settings.autoGainControl,
                    sampleRate: 48000,
                    sampleSize: 16,
                    channelCount: 1
                },
                video: false
            });

            // Send rejoin request
            WS.send('dm_call_rejoin', {
                dmId: dmId,
                targetUserId: targetUser.id
            });

            // Show call UI
            this.showCallUI(targetUser, false);
            this.currentCall = { dmId, targetUser };
            this.startCallTimer();

        } catch (e) {
            console.error('[Voice] Failed to rejoin call:', e);
            this.showError('Не удалось получить доступ к микрофону');
        }
    },

    // Clear DM alone timeout (when partner rejoins or call ends)
    clearDMAloneTimeout() {
        if (this.dmAloneTimeout) {
            clearTimeout(this.dmAloneTimeout);
            this.dmAloneTimeout = null;
        }
        if (this.dmAloneInterval) {
            clearInterval(this.dmAloneInterval);
            this.dmAloneInterval = null;
        }
        this.dmAloneStartTime = null;
    },

    // Start a DM call
    async startCall(dmId, targetUser) {
        console.log('[Voice] Starting call to:', targetUser);

        try {
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    noiseSuppression: this.settings.noiseSuppression,
                    echoCancellation: this.settings.echoCancellation,
                    autoGainControl: this.settings.autoGainControl,
                    sampleRate: 48000,
                    sampleSize: 16,
                    channelCount: 1
                },
                video: false
            });

            // Send call request
            WS.send('dm_call_start', {
                dmId: dmId,
                targetUserId: targetUser.id
            });

            // Show calling UI
            this.showCallUI(targetUser, true);
            this.currentCall = { dmId, targetUser };

        } catch (e) {
            console.error('[Voice] Failed to start call:', e);
            this.showError('Не удалось получить доступ к микрофону');
        }
    },

    // Show call UI
    showCallUI(user, isCalling = false) {
        // Remove existing
        this.hideCallUI();

        // Create embedded call container
        const container = document.createElement('div');
        container.className = 'embedded-call-container';
        container.id = 'embedded-call';
        container.style.height = '280px'; // Default height
        
        const participants = [
            { id: Store.state.user?.id, username: Store.state.user?.username, avatar: Store.state.user?.avatar, isMe: true },
            { id: user.id, username: user.username, avatar: user.avatar, isMe: false }
        ];

        container.innerHTML = `
            <div class="embedded-call-header">
                <div class="embedded-call-info">
                    <div class="embedded-call-status">
                        <span class="embedded-call-status-dot"></span>
                        <span class="embedded-call-title">${isCalling ? 'Вызов...' : 'Звонок'}</span>
                    </div>
                    <span class="embedded-call-timer" id="call-timer">00:00</span>
                </div>
                <div class="embedded-call-size-controls">
                    <button class="size-btn" id="call-fullscreen-btn" title="На весь экран">
                        <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M5 5h5V3H3v7h2V5zm9-2v2h5v5h2V3h-7zm7 14h-2v5h-5v2h7v-7zM5 19v-5H3v7h7v-2H5z"/></svg>
                    </button>
                </div>
            </div>
            <div class="embedded-call-participants" id="call-participants">
                ${participants.map(p => `
                    <div class="embedded-call-participant ${p.isMe ? 'me' : ''}" data-user-id="${p.id}">
                        <div class="embedded-call-avatar" style="${p.avatar ? `background-image: url(${p.avatar}); background-size: cover; background-position: center;` : `background: ${Utils.getUserColor(p.id)};`}">
                            ${p.avatar ? '' : Utils.getInitials(p.username)}
                        </div>
                    </div>
                `).join('')}
            </div>
            <div class="embedded-call-controls-bar" id="call-controls-bar">
                <div class="call-controls-group">
                    <button class="call-control-button ${this.isMuted ? 'active' : ''}" id="call-mute-btn" title="Микрофон">
                        <svg viewBox="0 0 24 24" width="20" height="20">
                            ${this.isMuted ? 
                                '<path fill="currentColor" d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/>' :
                                '<path fill="currentColor" d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/>'
                            }
                        </svg>
                    </button>
                    <button class="call-control-button ${this.isCameraOn ? 'active' : ''}" id="call-camera-btn" title="Камера">
                        <svg viewBox="0 0 24 24" width="20" height="20">
                            ${this.isCameraOn ?
                                '<path fill="currentColor" d="M21 6.5l-4 4V7c0-.55-.45-1-1-1H9.82L21 17.18V6.5zM3.27 2L2 3.27 4.73 6H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.21 0 .39-.08.54-.18L19.73 21 21 19.73 3.27 2z"/>' :
                                '<path fill="currentColor" d="M17 10.5V7c0-.55-.45-1-1-1H4c-.55 0-1 .45-1 1v10c0 .55.45 1 1 1h12c.55 0 1-.45 1-1v-3.5l4 4v-11l-4 4z"/>'
                            }
                        </svg>
                    </button>
                </div>
                <div class="call-controls-group">
                    <button class="call-control-button ${this.isScreenSharing ? 'active' : ''}" id="call-screen-btn" title="Демонстрация экрана">
                        <svg viewBox="0 0 24 24" width="20" height="20">
                            <path fill="currentColor" d="M20 18c1.1 0 1.99-.9 1.99-2L22 6c0-1.1-.9-2-2-2H4c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2H0v2h24v-2h-4zM4 6h16v10H4V6z"/>
                        </svg>
                    </button>
                </div>
                <button class="call-control-button end-call" id="call-end-btn" title="Завершить звонок">
                    <svg viewBox="0 0 24 24" width="20" height="20">
                        <path fill="currentColor" d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>
                    </svg>
                </button>
            </div>
            <div class="embedded-call-resize-handle" id="call-resize-handle"></div>
        `;

        // Insert into content-body
        const contentBody = document.querySelector('.content-body');
        if (contentBody) {
            contentBody.insertBefore(container, contentBody.firstChild);
            document.querySelector('.main-content')?.classList.add('has-call');
        }

        // Start timer if connected
        if (!isCalling) {
            this.startCallTimer();
        }

        // Bind events
        this.bindCallUIEvents();
        
        // Setup controls auto-hide
        this.setupControlsAutoHide();
        
        // Restore screen share preview if active
        if (this.isScreenSharing && this.screenStream) {
            this.showScreenSharePreview(this.screenStream);
        }
    },

    // Setup auto-hide for call controls
    setupControlsAutoHide() {
        const container = document.getElementById('embedded-call');
        const controlsBar = document.getElementById('call-controls-bar');
        if (!container || !controlsBar) return;

        // Store timeout reference on the element
        container._hideTimeout = null;
        
        const showControls = () => {
            controlsBar.classList.remove('hidden');
            controlsBar.classList.add('visible');
            
            // Clear existing timeout
            if (container._hideTimeout) {
                clearTimeout(container._hideTimeout);
                container._hideTimeout = null;
            }
            
            // Set new timeout to hide after 4 seconds
            container._hideTimeout = setTimeout(() => {
                if (!controlsBar.matches(':hover')) {
                    controlsBar.classList.remove('visible');
                    controlsBar.classList.add('hidden');
                }
            }, 4000);
        };

        const hideControls = () => {
            if (container._hideTimeout) {
                clearTimeout(container._hideTimeout);
            }
            container._hideTimeout = setTimeout(() => {
                if (!controlsBar.matches(':hover') && !container.matches(':hover')) {
                    controlsBar.classList.remove('visible');
                    controlsBar.classList.add('hidden');
                }
            }, 4000);
        };

        // Show controls on any mouse activity in container
        container.addEventListener('mouseenter', showControls);
        container.addEventListener('mousemove', showControls);
        container.addEventListener('mouseleave', hideControls);
        
        // Keep controls visible when directly hovering them
        controlsBar.addEventListener('mouseenter', () => {
            if (container._hideTimeout) {
                clearTimeout(container._hideTimeout);
                container._hideTimeout = null;
            }
            controlsBar.classList.remove('hidden');
            controlsBar.classList.add('visible');
        });

        // Initially show controls (visible by default)
        controlsBar.classList.add('visible');
        showControls();
    },

    // Bind call UI events
    bindCallUIEvents() {
        // Mute button
        document.getElementById('call-mute-btn')?.addEventListener('click', () => {
            this.toggleMute();
            this.updateCallUIButtons();
        });

        // Camera button
        document.getElementById('call-camera-btn')?.addEventListener('click', () => {
            this.toggleCamera();
        });

        // Screen share button
        document.getElementById('call-screen-btn')?.addEventListener('click', () => {
            this.toggleScreenShare();
        });

        // End call button
        document.getElementById('call-end-btn')?.addEventListener('click', () => {
            if (this.currentGroupCall) {
                this.leaveGroupCall();
            } else {
                this.endCall();
            }
        });

        // Fullscreen button
        document.getElementById('call-fullscreen-btn')?.addEventListener('click', () => {
            this.toggleCallFullscreen();
        });

        // Resize handle
        this.setupCallResize();
    },

    // Setup drag resize for call container
    setupCallResize() {
        const handle = document.getElementById('call-resize-handle');
        const container = document.getElementById('embedded-call');
        if (!handle || !container) return;

        let isResizing = false;
        let startY = 0;
        let startHeight = 0;
        const minHeight = 200; // Minimum height to fit avatars and buttons
        const maxHeight = window.innerHeight * 0.7;

        const onMouseDown = (e) => {
            if (container.classList.contains('fullscreen')) return;
            
            isResizing = true;
            startY = e.clientY;
            startHeight = container.offsetHeight;
            handle.classList.add('dragging');
            document.body.style.cursor = 'ns-resize';
            document.body.style.userSelect = 'none';
            
            e.preventDefault();
        };

        const onMouseMove = (e) => {
            if (!isResizing) return;
            
            const deltaY = e.clientY - startY;
            const newHeight = Math.max(60, Math.min(startHeight + deltaY, window.innerHeight * 0.8));
            container.style.height = newHeight + 'px';
        };

        const onMouseUp = () => {
            if (!isResizing) return;
            
            isResizing = false;
            handle.classList.remove('dragging');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            
            // Save height preference
            this.savedCallHeight = container.offsetHeight;
        };

        handle.addEventListener('mousedown', onMouseDown);
        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);

        // Store cleanup function
        this.cleanupResize = () => {
            handle.removeEventListener('mousedown', onMouseDown);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
        };
    },

    // Toggle fullscreen mode
    toggleCallFullscreen() {
        const container = document.getElementById('embedded-call');
        const btn = document.getElementById('call-fullscreen-btn');
        if (!container) return;

        const isFullscreen = container.classList.toggle('fullscreen');
        
        if (btn) {
            btn.classList.toggle('active', isFullscreen);
            btn.innerHTML = isFullscreen 
                ? '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/></svg>'
                : '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M5 5h5V3H3v7h2V5zm9-2v2h5v5h2V3h-7zm7 14h-2v5h-5v2h7v-7zM5 19v-5H3v7h7v-2H5z"/></svg>';
        }
    },

    // Hide call UI
    hideCallUI() {
        // Cleanup resize listeners
        if (this.cleanupResize) {
            this.cleanupResize();
            this.cleanupResize = null;
        }
        
        const container = document.getElementById('embedded-call');
        if (container) container.remove();
        document.querySelector('.main-content')?.classList.remove('has-call');
    },

    // Show modal to add people to call (create конфа)
    async showAddPeopleModal() {
        if (!this.currentCall) return;

        try {
            const { friends } = await API.users.getFriends();
            const currentCallUserId = this.currentCall.targetUser?.id;

            const modal = document.createElement('div');
            modal.className = 'modal show';
            modal.id = 'add-people-modal';
            modal.innerHTML = `
                <div class="modal-content">
                    <h2>Создать конфу</h2>
                    <p class="modal-subtitle">Выберите друзей для добавления (макс. 10 человек)</p>
                    <div class="friends-select-list" id="friends-select-list">
                        ${friends.map(friend => {
                            const isInCall = friend.id === currentCallUserId;
                            return `
                                <div class="friend-select-item ${isInCall ? 'disabled' : ''}" data-user-id="${friend.id}">
                                    <div class="friend-select-avatar" style="background: ${Utils.getUserColor(friend.id)}">
                                        ${Utils.getInitials(friend.username)}
                                    </div>
                                    <div class="friend-select-info">
                                        <span class="friend-select-name">${Utils.escapeHtml(friend.username)}</span>
                                        ${isInCall ? '<span class="friend-select-status">Уже в войсе</span>' : ''}
                                    </div>
                                    <div class="friend-select-checkbox ${isInCall ? 'checked disabled' : ''}">
                                        ${isInCall ? '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>' : ''}
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                    <div class="modal-actions">
                        <button class="btn btn-secondary" onclick="Voice.hideAddPeopleModal()">Отмена</button>
                        <button class="btn btn-primary" id="create-group-call-btn" disabled>Создать конфу</button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            const selectedUsers = new Set();
            // Pre-select current call user
            if (currentCallUserId) {
                selectedUsers.add(currentCallUserId);
            }

            // Bind selection events
            modal.querySelectorAll('.friend-select-item:not(.disabled)').forEach(item => {
                item.addEventListener('click', () => {
                    const userId = item.dataset.userId;
                    const checkbox = item.querySelector('.friend-select-checkbox');
                    
                    if (selectedUsers.has(userId)) {
                        selectedUsers.delete(userId);
                        checkbox.innerHTML = '';
                        checkbox.classList.remove('checked');
                    } else {
                        if (selectedUsers.size >= 9) { // 9 + current user = 10 max
                            alert('Максимум 10 участников в конфе');
                            return;
                        }
                        selectedUsers.add(userId);
                        checkbox.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>';
                        checkbox.classList.add('checked');
                    }

                    // Enable/disable create button (need at least 2 people besides current call user)
                    const createBtn = document.getElementById('create-group-call-btn');
                    const newUsersCount = Array.from(selectedUsers).filter(id => id !== currentCallUserId).length;
                    createBtn.disabled = newUsersCount < 1;
                });
            });

            // Create group call button
            document.getElementById('create-group-call-btn').addEventListener('click', async () => {
                const memberIds = Array.from(selectedUsers);
                if (memberIds.length < 2) return;

                try {
                    const { groupCall } = await API.groupCalls.create(memberIds);
                    this.hideAddPeopleModal();
                    
                    // End current DM call
                    this.endCall();
                    
                    // Join group call
                    this.joinGroupCall(groupCall);
                } catch (error) {
                    console.error('Failed to create group call:', error);
                    alert(error.message || 'Ошибка создания конфы');
                }
            });

        } catch (error) {
            console.error('Failed to load friends:', error);
        }
    },

    hideAddPeopleModal() {
        const modal = document.getElementById('add-people-modal');
        if (modal) modal.remove();
    },

    // Join group call
    async joinGroupCall(groupCall) {
        console.log('[Voice] Joining group call:', groupCall.id);

        try {
            // Get user media
            if (!this.localStream) {
                this.localStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        noiseSuppression: this.settings.noiseSuppression,
                        echoCancellation: this.settings.echoCancellation,
                        autoGainControl: this.settings.autoGainControl,
                        sampleRate: 48000
                    },
                    video: false
                });
            }

            this.currentGroupCall = groupCall;

            // Notify server
            WS.send('group_call_join', { groupId: groupCall.id });

            // Show group call UI
            this.showGroupCallUI(groupCall);

        } catch (e) {
            console.error('[Voice] Failed to join group call:', e);
            this.showError('Не удалось получить доступ к микрофону');
        }
    },

    // Show group call UI
    showGroupCallUI(groupCall, activeUsers = []) {
        // Remove existing
        this.hideCallUI();

        const myId = Store.state.user?.id;
        // Active users includes self and anyone who joined
        const activeUserIds = new Set([myId, ...activeUsers.map(u => u.id || u)]);
        
        // Track pending invites with timeout
        this.pendingInvites = new Map();

        // Build participants list
        const participants = groupCall.members.map(member => {
            const isActive = activeUserIds.has(member.id);
            const isPending = member.pending === true || (!isActive && member.id !== myId);
            
            if (isPending) {
                this.pendingInvites.set(member.id, Date.now());
            }
            
            return { ...member, isActive, isPending };
        });

        // Create embedded call container
        const container = document.createElement('div');
        container.className = 'embedded-call-container';
        container.id = 'embedded-call';
        container.style.height = (this.savedCallHeight || 200) + 'px';
        
        container.innerHTML = `
            <div class="embedded-call-header">
                <div class="embedded-call-info">
                    <div class="embedded-call-status">
                        <span class="embedded-call-status-dot"></span>
                        <span class="embedded-call-title">${Utils.escapeHtml(groupCall.name)}</span>
                    </div>
                    <span class="embedded-call-timer" id="call-timer">00:00</span>
                    <span id="group-call-status" style="font-size: 12px; color: var(--text-muted); margin-left: 8px;">${participants.length} участников</span>
                    <div class="embedded-call-mini-avatars">
                        ${participants.slice(0, 5).map(p => `
                            <div class="embedded-call-mini-avatar" data-user-id="${p.id}" style="background: ${p.isPending ? '#4a4a4a' : Utils.getUserColor(p.id)}">
                                ${Utils.getInitials(p.username)}
                            </div>
                        `).join('')}
                        ${participants.length > 5 ? `<div class="embedded-call-mini-avatar" style="background: var(--bg-tertiary); color: var(--text-muted);">+${participants.length - 5}</div>` : ''}
                    </div>
                </div>
                <div class="embedded-call-actions">
                    <div class="embedded-call-size-controls">
                        <button class="size-btn" id="call-fullscreen-btn" title="На весь экран">
                            <svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M5 5h5V3H3v7h2V5zm9-2v2h5v5h2V3h-7zm7 14h-2v5h-5v2h7v-7zM5 19v-5H3v7h7v-2H5z"/></svg>
                        </button>
                    </div>
                    <button class="embedded-call-btn ${this.isMuted ? 'active' : ''}" id="call-mute-btn" title="Микрофон">
                        <svg viewBox="0 0 24 24" width="18" height="18">
                            <path fill="currentColor" d="M12 14c1.66 0 2.99-1.34 2.99-3L15 5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.3-3c0 3-2.54 5.1-5.3 5.1S6.7 14 6.7 11H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c3.28-.48 6-3.3 6-6.72h-1.7z"/>
                        </svg>
                    </button>
                    <button class="embedded-call-btn end-call" id="call-end-btn" title="Выйти">
                        <svg viewBox="0 0 24 24" width="18" height="18">
                            <path fill="currentColor" d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>
                        </svg>
                    </button>
                </div>
            </div>
            <div class="embedded-call-participants" id="call-participants">
                ${participants.map(p => `
                    <div class="embedded-call-participant ${p.isActive ? 'active' : ''} ${p.isPending ? 'pending' : ''}" data-user-id="${p.id}">
                        <div class="embedded-call-avatar" style="background: ${p.isPending ? '#4a4a4a' : Utils.getUserColor(p.id)}">
                            ${Utils.getInitials(p.username)}
                        </div>
                        <span class="embedded-call-participant-name">${Utils.escapeHtml(p.username)}</span>
                        ${p.isPending ? '<span class="embedded-call-participant-status">Вызов...</span>' : ''}
                    </div>
                `).join('')}
            </div>
            <div class="embedded-call-resize-handle" id="call-resize-handle"></div>
        `;

        // Insert into content-body
        const contentBody = document.querySelector('.content-body');
        if (contentBody) {
            contentBody.insertBefore(container, contentBody.firstChild);
            document.querySelector('.main-content')?.classList.add('has-call');
        }

        this.startCallTimer();

        // Start pending invite timeout checker
        this.startPendingInviteChecker();

        // Bind events
        this.bindCallUIEvents();
    },

    // Check and remove pending invites after 30 seconds
    startPendingInviteChecker() {
        if (this.pendingInviteInterval) {
            clearInterval(this.pendingInviteInterval);
        }
        
        this.pendingInviteInterval = setInterval(() => {
            const now = Date.now();
            for (const [userId, startTime] of this.pendingInvites) {
                if (now - startTime > 30000) { // 30 seconds
                    // Remove pending participant
                    const participant = document.querySelector(`.embedded-call-participant[data-user-id="${userId}"]`);
                    if (participant && participant.classList.contains('pending')) {
                        participant.remove();
                    }
                    this.pendingInvites.delete(userId);
                }
            }
            
            // Update participant count
            const participants = document.querySelectorAll('.group-call-participant');
            const statusEl = document.getElementById('group-call-status');
            if (statusEl) {
                statusEl.textContent = `Конфа • ${participants.length} участников`;
            }
        }, 1000);
    },

    // Mark user as active in group call
    markUserActive(userId) {
        const participant = document.querySelector(`.embedded-call-participant[data-user-id="${userId}"]`);
        if (participant) {
            participant.classList.remove('pending');
            participant.classList.add('active');
            
            const avatar = participant.querySelector('.embedded-call-avatar');
            if (avatar) {
                avatar.style.background = Utils.getUserColor(userId);
            }
            
            const statusText = participant.querySelector('.embedded-call-participant-status');
            if (statusText) statusText.remove();
        }
        
        if (this.pendingInvites) {
            this.pendingInvites.delete(userId);
        }
    },

    // Leave group call
    leaveGroupCall() {
        if (!this.currentGroupCall) return;

        console.log('[Voice] Leaving group call:', this.currentGroupCall.id);

        WS.send('group_call_leave', { groupId: this.currentGroupCall.id });

        // Close peer connections
        for (const [peerId, peer] of this.peers) {
            this.closePeer(peerId);
        }
        this.peers.clear();

        // Stop timer
        if (this.callTimerInterval) {
            clearInterval(this.callTimerInterval);
            this.callTimerInterval = null;
        }

        // Stop pending invite checker
        if (this.pendingInviteInterval) {
            clearInterval(this.pendingInviteInterval);
            this.pendingInviteInterval = null;
        }
        this.pendingInvites = null;

        // Stop local stream
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }

        this.currentGroupCall = null;

        // Hide call UI
        this.hideCallUI();
    },

    // Start call timer
    startCallTimer() {
        this.callStartTime = Date.now();
        this.callTimerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - this.callStartTime) / 1000);
            const minutes = Math.floor(elapsed / 60).toString().padStart(2, '0');
            const seconds = (elapsed % 60).toString().padStart(2, '0');
            const timer = document.getElementById('call-timer');
            if (timer) timer.textContent = `${minutes}:${seconds}`;
        }, 1000);
    },

    // End call
    endCall(forceClose = false) {
        console.log('[Voice] Ending call, forceClose:', forceClose);

        // Play end call sound
        if (window.WS) WS.playCallEndSound();

        // Clear DM alone timeout if exists
        this.clearDMAloneTimeout();
        
        // Clear self disconnect timeout if exists
        this.clearSelfDisconnectTimeout();

        // Stop timer
        if (this.callTimerInterval) {
            clearInterval(this.callTimerInterval);
            this.callTimerInterval = null;
        }

        // Close peer connections
        for (const [peerId, peer] of this.peers) {
            this.closePeer(peerId);
        }
        this.peers.clear();

        // Stop local stream
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
        }

        // For DM calls - show "disconnected" UI with rejoin button instead of closing
        // Unless:
        // - forceClose is true (timeout expired or partner's call ended completely)
        // - we're already waiting for partner (partner already left, so close completely)
        // - call was never connected (callStartTime is null - partner never answered)
        // - we're already in disconnected state (user clicked exit again)
        if (this.currentCall && this.currentCall.dmId && !forceClose && !this.waitingForPartner && this.callStartTime && !this.isDisconnected) {
            // Notify server that we left
            WS.send('dm_call_end', {
                dmId: this.currentCall.dmId
            });
            
            // Show disconnected state with rejoin button
            this.showDisconnectedUI();
            
            // Start 3 minute timeout for self
            this.startSelfDisconnectTimeout();
            
            this.callStartTime = null;
            this.waitingForPartner = false;
            this.isMuted = false;
            this.isDisconnected = true;
            return;
        }

        // Notify server - check if call was connected or still ringing
        if (this.currentCall) {
            // If call was never connected (no timer started), it's a cancel
            if (!this.callStartTime) {
                console.log('[Voice] Call was not connected, sending cancel');
                console.log('[Voice] currentCall:', this.currentCall);
                // Send both cancel and end to ensure the incoming call modal is closed
                WS.send('dm_call_cancel', {
                    dmId: this.currentCall.dmId,
                    targetUserId: this.currentCall.targetUser?.id
                });
                // Also send dm_call_end as backup - it will trigger dm_call_cancelled on the other side
                WS.send('dm_call_end', {
                    dmId: this.currentCall.dmId
                });
            } else {
                WS.send('dm_call_end', {
                    dmId: this.currentCall.dmId
                });
            }
        }

        // Hide call UI
        this.hideCallUI();

        this.currentCall = null;
        this.callStartTime = null;
        this.waitingForPartner = false;
        this.isDisconnected = false;
        this.isMuted = false;
    },

    // Show disconnected UI with rejoin button
    showDisconnectedUI() {
        console.log('[Voice] Showing disconnected UI');
        
        // Update title
        const title = document.querySelector('.embedded-call-title');
        if (title) {
            title.textContent = 'Отключено';
        }
        
        // Mark self as disconnected
        const myParticipant = document.querySelector('.embedded-call-participant.me');
        if (myParticipant) {
            myParticipant.classList.add('disconnected');
        }
        
        // Hide mute button
        const muteBtn = document.getElementById('call-mute-btn');
        if (muteBtn) muteBtn.style.display = 'none';
        
        const addPeopleBtn = document.getElementById('call-add-people-btn');
        if (addPeopleBtn) addPeopleBtn.style.display = 'none';
        
        // Hide end button (user already left, no need to end again)
        const endBtn = document.getElementById('call-end-btn');
        if (endBtn) endBtn.style.display = 'none';
        
        // Hide fullscreen button
        const fullscreenBtn = document.getElementById('call-fullscreen-btn');
        if (fullscreenBtn) fullscreenBtn.style.display = 'none';
        
        // Add rejoin and close buttons
        const actions = document.querySelector('.embedded-call-actions');
        if (actions && !document.getElementById('call-rejoin-btn')) {
            // Rejoin button
            const rejoinBtn = document.createElement('button');
            rejoinBtn.className = 'embedded-call-btn rejoin-btn';
            rejoinBtn.id = 'call-rejoin-btn';
            rejoinBtn.title = 'Вернуться в звонок';
            rejoinBtn.innerHTML = `
                <svg viewBox="0 0 24 24" width="18" height="18">
                    <path fill="currentColor" d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/>
                </svg>
            `;
            rejoinBtn.onclick = () => this.rejoinCurrentCall();
            actions.appendChild(rejoinBtn);
            
            // Close button (to fully exit)
            const closeBtn = document.createElement('button');
            closeBtn.className = 'embedded-call-btn close-btn';
            closeBtn.id = 'call-close-btn';
            closeBtn.title = 'Закрыть';
            closeBtn.innerHTML = `
                <svg viewBox="0 0 24 24" width="18" height="18">
                    <path fill="currentColor" d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
                </svg>
            `;
            closeBtn.onclick = () => this.closeDisconnectedCall();
            actions.appendChild(closeBtn);
        }
    },
    
    // Close disconnected call completely
    closeDisconnectedCall() {
        console.log('[Voice] Closing disconnected call');
        
        // Clear timeout
        this.clearSelfDisconnectTimeout();
        
        // Hide UI
        this.hideCallUI();
        
        // Reset state
        this.currentCall = null;
        this.callStartTime = null;
        this.waitingForPartner = false;
        this.isDisconnected = false;
        this.isMuted = false;
    },

    // Rejoin current call
    async rejoinCurrentCall() {
        if (!this.currentCall) return;
        
        console.log('[Voice] Rejoining call');
        
        try {
            // Get media again
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    noiseSuppression: this.settings.noiseSuppression,
                    echoCancellation: this.settings.echoCancellation,
                    autoGainControl: this.settings.autoGainControl,
                    sampleRate: 48000,
                    sampleSize: 16,
                    channelCount: 1
                },
                video: false
            });
            
            // Clear self disconnect timeout
            this.clearSelfDisconnectTimeout();
            
            // Set callStartTime to mark that we're in a call (will be updated when partner accepts)
            // This prevents the window from closing immediately if user exits during "Вызов..."
            this.callStartTime = Date.now();
            
            // Send rejoin/call request
            WS.send('dm_call_start', {
                dmId: this.currentCall.dmId,
                targetUserId: this.currentCall.targetUser?.id
            });
            
            // Restore UI
            this.restoreCallUI();
            
            this.isDisconnected = false;
            
        } catch (e) {
            console.error('[Voice] Failed to rejoin call:', e);
            this.showError('Не удалось получить доступ к микрофону');
        }
    },

    // Restore call UI after rejoin
    restoreCallUI() {
        // Update title
        const title = document.querySelector('.embedded-call-title');
        if (title) {
            title.textContent = 'Вызов...';
        }
        
        // Remove disconnected state
        const myParticipant = document.querySelector('.embedded-call-participant.me');
        if (myParticipant) {
            myParticipant.classList.remove('disconnected');
        }
        
        // Show mute button
        const muteBtn = document.getElementById('call-mute-btn');
        if (muteBtn) muteBtn.style.display = '';
        
        const addPeopleBtn = document.getElementById('call-add-people-btn');
        if (addPeopleBtn) addPeopleBtn.style.display = '';
        
        // Show end button
        const endBtn = document.getElementById('call-end-btn');
        if (endBtn) endBtn.style.display = '';
        
        // Show fullscreen button
        const fullscreenBtn = document.getElementById('call-fullscreen-btn');
        if (fullscreenBtn) fullscreenBtn.style.display = '';
        
        // Remove rejoin and close buttons
        const rejoinBtn = document.getElementById('call-rejoin-btn');
        if (rejoinBtn) rejoinBtn.remove();
        
        const closeBtn = document.getElementById('call-close-btn');
        if (closeBtn) closeBtn.remove();
    },

    // Start timeout for self when disconnected (3 minutes)
    startSelfDisconnectTimeout() {
        this.selfDisconnectTimeout = setTimeout(() => {
            console.log('[Voice] Self disconnect timeout reached');
            WS.showNotification('Звонок завершён', 'Время ожидания истекло');
            this.endCall(true);
        }, 180000); // 3 minutes
        
        // Show countdown
        this.selfDisconnectStartTime = Date.now();
        this.selfDisconnectInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - this.selfDisconnectStartTime) / 1000);
            const remaining = 180 - elapsed;
            if (remaining <= 0) {
                clearInterval(this.selfDisconnectInterval);
                return;
            }
            const mins = Math.floor(remaining / 60);
            const secs = remaining % 60;
            const title = document.querySelector('.embedded-call-title');
            if (title && this.isDisconnected) {
                title.textContent = `Отключено ${mins}:${secs.toString().padStart(2, '0')}`;
            }
        }, 1000);
    },

    // Clear self disconnect timeout
    clearSelfDisconnectTimeout() {
        if (this.selfDisconnectTimeout) {
            clearTimeout(this.selfDisconnectTimeout);
            this.selfDisconnectTimeout = null;
        }
        if (this.selfDisconnectInterval) {
            clearInterval(this.selfDisconnectInterval);
            this.selfDisconnectInterval = null;
        }
        this.selfDisconnectStartTime = null;
    },

    // Handle call cancelled by caller (before it was accepted)
    handleCallCancelled(payload) {
        console.log('[Voice] Call cancelled by caller:', payload);
        
        // Stop ringtone
        this.stopRingtone();
        
        // Remove incoming call modal
        const modal = document.getElementById('incoming-call-modal');
        if (modal) modal.remove();
        
        // Clear pending call
        this.pendingCall = null;
    },

    // Play ringtone (pleasant two-tone ring)
    playRingtone() {
        try {
            if (!this.ringtoneContext) {
                this.ringtoneContext = new (window.AudioContext || window.webkitAudioContext)();
            }

            const playRing = () => {
                if (!this.pendingCall && !this.pendingGroupCall) return;
                
                const ctx = this.ringtoneContext;
                const now = ctx.currentTime;
                
                // Pleasant two-tone ring pattern
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
                
                // Ring pattern: two quick tones
                playTone(523.25, now, 0.2, 0.15);        // C5
                playTone(659.25, now + 0.15, 0.2, 0.15); // E5
                playTone(523.25, now + 0.4, 0.2, 0.15);  // C5
                playTone(659.25, now + 0.55, 0.2, 0.15); // E5
            };

            playRing();
            this.ringtoneInterval = setInterval(playRing, 1800);
        } catch (e) {
            console.error('[Voice] Failed to play ringtone:', e);
        }
    },

    // Stop ringtone
    stopRingtone() {
        if (this.ringtoneInterval) {
            clearInterval(this.ringtoneInterval);
            this.ringtoneInterval = null;
        }
    },

    // Show incoming group call (конфа) invite
    showIncomingGroupCall(payload) {
        console.log('[Voice] Showing incoming group call invite:', payload);
        
        // Remove existing call modal
        const existing = document.getElementById('incoming-call-modal');
        if (existing) existing.remove();

        const inviter = payload.inviter || { username: 'Пользователь' };
        const groupName = payload.groupCall?.name || payload.groupName || 'Конфа';
        
        const modal = document.createElement('div');
        modal.className = 'modal show';
        modal.id = 'incoming-call-modal';
        modal.innerHTML = `
            <div class="modal-content incoming-call-modal">
                <div class="call-avatar" style="background: ${Utils.getUserColor(inviter.id)}">
                    ${Utils.getInitials(inviter.username)}
                </div>
                <h2>${Utils.escapeHtml(groupName)}</h2>
                <p class="call-status">${Utils.escapeHtml(inviter.username)} приглашает в конфу...</p>
                <div class="call-actions">
                    <button class="call-btn call-accept" id="accept-group-call-btn">
                        <svg viewBox="0 0 24 24" width="24" height="24">
                            <path fill="currentColor" d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/>
                        </svg>
                    </button>
                    <button class="call-btn call-reject" id="reject-group-call-btn">
                        <svg viewBox="0 0 24 24" width="24" height="24">
                            <path fill="currentColor" d="M12 9c-1.6 0-3.15.25-4.6.72v3.1c0 .39-.23.74-.56.9-.98.49-1.87 1.12-2.66 1.85-.18.18-.43.28-.7.28-.28 0-.53-.11-.71-.29L.29 13.08c-.18-.17-.29-.42-.29-.7 0-.28.11-.53.29-.71C3.34 8.78 7.46 7 12 7s8.66 1.78 11.71 4.67c.18.18.29.43.29.71 0 .28-.11.53-.29.71l-2.48 2.48c-.18.18-.43.29-.71.29-.27 0-.52-.11-.7-.28-.79-.74-1.69-1.36-2.67-1.85-.33-.16-.56-.5-.56-.9v-3.1C15.15 9.25 13.6 9 12 9z"/>
                        </svg>
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        // Store pending group call info
        this.pendingGroupCall = payload;

        // Play ringtone
        this.playRingtone();

        // Auto-decline after 30 seconds
        this.groupCallInviteTimeout = setTimeout(() => {
            this.declineGroupCall();
        }, 30000);

        // Bind events
        document.getElementById('accept-group-call-btn').addEventListener('click', () => {
            this.acceptGroupCall();
        });

        document.getElementById('reject-group-call-btn').addEventListener('click', () => {
            this.declineGroupCall();
        });
    },

    // Accept group call invite
    async acceptGroupCall() {
        if (!this.pendingGroupCall) return;

        this.stopRingtone();
        
        if (this.groupCallInviteTimeout) {
            clearTimeout(this.groupCallInviteTimeout);
            this.groupCallInviteTimeout = null;
        }
        
        const modal = document.getElementById('incoming-call-modal');
        if (modal) modal.remove();

        try {
            // Get user media
            this.localStream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    noiseSuppression: this.settings.noiseSuppression,
                    echoCancellation: this.settings.echoCancellation,
                    autoGainControl: this.settings.autoGainControl,
                    sampleRate: 48000,
                    sampleSize: 16,
                    channelCount: 1
                },
                video: false
            });

            // Accept invite via API (adds user to members)
            const groupId = this.pendingGroupCall.groupId;
            await API.groupCalls.accept(groupId);
            
            // Fetch full group call info
            const { groupCall } = await API.groupCalls.get(groupId);
            
            this.pendingGroupCall = null;
            
            // Join group call
            this.joinGroupCall(groupCall);

        } catch (e) {
            console.error('[Voice] Failed to accept group call:', e);
            this.showError('Не удалось получить доступ к микрофону');
            this.pendingGroupCall = null;
        }
    },

    // Decline group call invite
    declineGroupCall() {
        this.stopRingtone();
        
        if (this.groupCallInviteTimeout) {
            clearTimeout(this.groupCallInviteTimeout);
            this.groupCallInviteTimeout = null;
        }

        const modal = document.getElementById('incoming-call-modal');
        if (modal) modal.remove();

        this.pendingGroupCall = null;
    }
};

// Make Voice globally available
window.Voice = Voice;
