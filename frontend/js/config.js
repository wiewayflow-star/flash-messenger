/**
 * Flash Configuration
 */
const CONFIG = {
    API_URL: window.location.origin + '/api',
    WS_URL: (window.location.protocol === 'https:' ? 'wss://' : 'ws://') + window.location.host,
    APP_NAME: 'Flash',
    VERSION: '1.0.0',
    
    // ICE Servers for WebRTC (STUN + TURN)
    // Get free TURN credentials at https://www.metered.ca/tools/openrelay/
    ICE_SERVERS: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        // Free OpenRelay TURN servers from Metered
        {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        },
        {
            urls: 'turn:openrelay.metered.ca:443?transport=tcp',
            username: 'openrelayproject',
            credential: 'openrelayproject'
        }
    ]
};
