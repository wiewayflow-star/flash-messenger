/**
 * Flash Server - Standalone (In-Memory Database)
 * Работает без MySQL - все данные в памяти
 * Использует изолированный модуль базы данных для безопасного хранения аккаунтов
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const path = require('path');

// Secure database module
const Database = require('../database');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'flash-secret-key';

// ============ IN-MEMORY DATABASE ============
const DB = {
    users: new Map(),
    servers: new Map(),
    channels: new Map(),
    messages: new Map(),
    serverMembers: new Map(),
    invites: new Map(),
    friendRequests: new Map(), // { id, from_user_id, to_user_id, status: 'pending'|'accepted'|'rejected', created_at }
    friends: new Map(), // { id, user1_id, user2_id, created_at }
    dmChannels: new Map(), // { id, user1_id, user2_id, created_at }
    groupCalls: new Map(), // { id, name, owner_id, members: [userId], created_at } - Конфы (макс 10 человек)
    activeCalls: new Map(), // dmId -> { starterId, starterUsername, startTime, participants: Set }
    trustedDevices: new Map() // visitorId -> { visitorId, userId, ip, userAgent, createdAt, lastUsed }
};

// ============ MIDDLEWARE ============
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname, '../frontend')));

const authenticate = (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
        return res.status(401).json({ error: true, message: 'Требуется авторизация' });
    }
    try {
        const decoded = jwt.verify(auth.split(' ')[1], JWT_SECRET);
        const user = DB.users.get(decoded.userId);
        if (!user) return res.status(401).json({ error: true, message: 'Пользователь не найден' });
        req.user = user;
        next();
    } catch (e) {
        res.status(401).json({ error: true, message: 'Недействительный токен' });
    }
};

// ============ HELPERS ============
const generateUniqueTag = (username) => {
    // Собираем ВСЕ существующие теги (глобально)
    const existingTags = new Set();
    for (const user of DB.users.values()) {
        existingTags.add(user.tag);
    }
    
    // Ищем первый свободный тег
    for (let i = 1; i <= 9999; i++) {
        const tag = '#' + i.toString().padStart(4, '0');
        if (!existingTags.has(tag)) return tag;
    }
    
    // Если все заняты (маловероятно), генерируем случайный
    return '#' + Math.floor(Math.random() * 10000).toString().padStart(4, '0');
};

// ============ AUTH ROUTES ============
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, username, password } = req.body;
        
        // Get client IP for rate limiting
        const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
        
        // Check rate limit
        const rateLimitCheck = Database.RateLimiter.isBlocked(clientIp);
        if (rateLimitCheck.blocked) {
            return res.status(429).json({ 
                error: true, 
                message: `Слишком много попыток. Подождите ${rateLimitCheck.remainingTime} сек.` 
            });
        }

        // Use secure database module for registration
        const account = await Database.Accounts.register(email, username, password);
        
        // Generate unique tag
        const tag = generateUniqueTag(username);
        
        // Update account with tag
        await Database.Accounts.update(account.id, { tag });
        
        // Create in-memory user for runtime (without sensitive data)
        const user = {
            id: account.id,
            email: email, // Keep for session only, not stored in plain text
            username: username,
            tag: tag,
            avatar: null,
            banner: null,
            bio: null,
            status: 'online',
            custom_status: null,
            created_at: account.createdAt
        };

        DB.users.set(account.id, user);
        const token = jwt.sign({ userId: account.id }, JWT_SECRET, { expiresIn: '7d' });

        // Clear rate limit on success
        Database.RateLimiter.clearRecord(clientIp);

        console.log(`✓ Новый пользователь: ${username}${tag} (пароль защищён)`);

        res.status(201).json({
            user: { id: user.id, email: user.email, username: user.username, tag: user.tag, avatar: user.avatar, status: user.status },
            token
        });
    } catch (error) {
        console.error('Register error:', error.message);
        res.status(400).json({ error: true, message: error.message || 'Ошибка регистрации' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        // Get client IP for rate limiting
        const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
        const emailHash = Database.Security.hashEmail(email || '');
        const rateLimitKey = `${clientIp}:${emailHash}`;
        
        // Check rate limit
        const rateLimitCheck = Database.RateLimiter.isBlocked(rateLimitKey);
        if (rateLimitCheck.blocked) {
            return res.status(429).json({ 
                error: true, 
                message: `Слишком много попыток. Подождите ${rateLimitCheck.remainingTime} сек.` 
            });
        }

        // Use secure database module for authentication
        let account;
        try {
            account = await Database.Accounts.login(email, password);
        } catch (loginError) {
            // Record failed attempt
            const result = Database.RateLimiter.recordFailure(rateLimitKey);
            
            if (result.blocked) {
                return res.status(429).json({ 
                    error: true, 
                    message: `Слишком много попыток. Подождите ${result.blockedFor} сек.` 
                });
            }
            
            return res.status(401).json({ 
                error: true, 
                message: `Неверный email или пароль. Осталось попыток: ${result.attemptsLeft}` 
            });
        }

        // Clear rate limit on success
        Database.RateLimiter.clearRecord(rateLimitKey);

        // Get or create in-memory user
        let user = DB.users.get(account.id);
        if (!user) {
            user = {
                id: account.id,
                email: email,
                username: account.username,
                tag: account.tag,
                avatar: account.avatar,
                banner: account.banner,
                bio: account.bio,
                status: 'online',
                custom_status: null,
                publicKey: account.publicKey,
                created_at: account.createdAt
            };
            DB.users.set(account.id, user);
        } else {
            user.status = 'online';
        }

        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

        // Save trusted device if visitorId provided
        const visitorId = req.body.visitorId;
        if (visitorId) {
            const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
            DB.trustedDevices.set(visitorId, {
                visitorId,
                userId: user.id,
                ip: clientIp,
                userAgent: req.headers['user-agent'] || '',
                createdAt: new Date().toISOString(),
                lastUsed: new Date().toISOString()
            });
            console.log(`✓ Устройство сохранено для ${user.username}${user.tag}`);
        }

        console.log(`✓ Вход: ${user.username}${user.tag} (пароль проверен безопасно)`);

        res.json({
            user: { id: user.id, email: user.email, username: user.username, tag: user.tag, avatar: user.avatar, status: user.status },
            token
        });
    } catch (error) {
        console.error('Login error:', error.message);
        res.status(500).json({ error: true, message: 'Ошибка входа' });
    }
});

// Auto-login by trusted device
app.post('/api/auth/auto-login', async (req, res) => {
    try {
        const { visitorId } = req.body;
        const clientIp = req.ip || req.connection.remoteAddress || 'unknown';
        
        if (!visitorId) {
            return res.status(400).json({ error: true, message: 'Требуется идентификатор устройства' });
        }
        
        // Check if device is trusted
        const device = DB.trustedDevices.get(visitorId);
        if (!device) {
            return res.status(401).json({ error: true, message: 'Устройство не найдено' });
        }
        
        // Verify IP matches (security check)
        if (device.ip !== clientIp) {
            return res.status(401).json({ error: true, message: 'IP адрес изменился, требуется повторный вход' });
        }
        
        // Get user
        let user = DB.users.get(device.userId);
        if (!user) {
            // Try to load from database
            const account = await Database.Accounts.getById(device.userId);
            if (!account) {
                DB.trustedDevices.delete(visitorId);
                return res.status(401).json({ error: true, message: 'Пользователь не найден' });
            }
            
            user = {
                id: account.id,
                email: account.email,
                username: account.username,
                tag: account.tag,
                avatar: account.avatar,
                banner: account.banner,
                bio: account.bio,
                status: 'online',
                custom_status: null,
                publicKey: account.publicKey,
                created_at: account.createdAt
            };
            DB.users.set(account.id, user);
        } else {
            user.status = 'online';
        }
        
        // Update last used
        device.lastUsed = new Date().toISOString();
        
        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });
        
        console.log(`✓ Автовход: ${user.username}${user.tag} (доверенное устройство)`);
        
        res.json({
            user: { id: user.id, email: user.email, username: user.username, tag: user.tag, avatar: user.avatar, status: user.status },
            token
        });
    } catch (error) {
        console.error('Auto-login error:', error.message);
        res.status(500).json({ error: true, message: 'Ошибка автоматического входа' });
    }
});

app.post('/api/auth/logout', authenticate, (req, res) => {
    req.user.status = 'offline';
    res.json({ success: true });
});

// Change password
app.post('/api/auth/change-password', authenticate, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        
        if (!currentPassword || !newPassword) {
            return res.status(400).json({ error: true, message: 'Заполните все поля' });
        }
        
        await Database.Accounts.changePassword(req.user.id, currentPassword, newPassword);
        
        console.log(`✓ Пароль изменён: ${req.user.username}`);
        res.json({ success: true, message: 'Пароль успешно изменён' });
    } catch (error) {
        console.error('Change password error:', error.message);
        res.status(400).json({ error: true, message: error.message || 'Ошибка смены пароля' });
    }
});

app.get('/api/auth/me', authenticate, (req, res) => {
    const u = req.user;
    res.json({ user: { id: u.id, email: u.email, username: u.username, tag: u.tag, avatar: u.avatar, status: u.status } });
});

// ============ SERVERS ROUTES ============
app.get('/api/servers', authenticate, (req, res) => {
    const userServers = [];
    for (const member of DB.serverMembers.values()) {
        if (member.user_id === req.user.id) {
            const server = DB.servers.get(member.server_id);
            if (server) userServers.push(server);
        }
    }
    res.json({ servers: userServers });
});

app.post('/api/servers', authenticate, (req, res) => {
    const { name, description } = req.body;
    if (!name || name.length < 2) {
        return res.status(400).json({ error: true, message: 'Название минимум 2 символа' });
    }

    const serverId = uuidv4();
    const server = {
        id: serverId, name, icon: null, description: description || null,
        owner_id: req.user.id, energy: 0, created_at: new Date().toISOString()
    };
    DB.servers.set(serverId, server);

    DB.serverMembers.set(uuidv4(), { server_id: serverId, user_id: req.user.id });

    const textChannelId = uuidv4();
    DB.channels.set(textChannelId, {
        id: textChannelId, server_id: serverId, name: 'общий', type: 'text', topic: 'Общий чат', position: 0
    });
    
    const voiceChannelId = uuidv4();
    DB.channels.set(voiceChannelId, {
        id: voiceChannelId, server_id: serverId, name: 'Голосовой', type: 'voice', position: 1
    });

    console.log(`✓ Создан сервер: ${name}`);
    res.status(201).json({ server });
});

app.get('/api/servers/:serverId', authenticate, (req, res) => {
    const server = DB.servers.get(req.params.serverId);
    if (!server) return res.status(404).json({ error: true, message: 'Сервер не найден' });
    res.json({ server });
});

app.get('/api/servers/:serverId/members', authenticate, (req, res) => {
    const members = [];
    for (const m of DB.serverMembers.values()) {
        if (m.server_id === req.params.serverId) {
            const user = DB.users.get(m.user_id);
            if (user) members.push({ id: user.id, username: user.username, tag: user.tag, avatar: user.avatar, status: user.status });
        }
    }
    res.json({ members });
});

app.delete('/api/servers/:serverId', authenticate, (req, res) => {
    const server = DB.servers.get(req.params.serverId);
    if (!server) return res.status(404).json({ error: true, message: 'Сервер не найден' });
    if (server.owner_id !== req.user.id) return res.status(403).json({ error: true, message: 'Нет прав' });
    DB.servers.delete(req.params.serverId);
    res.json({ success: true });
});

// ============ CHANNELS ROUTES ============
app.get('/api/channels/server/:serverId', authenticate, (req, res) => {
    const channels = Array.from(DB.channels.values()).filter(c => c.server_id === req.params.serverId);
    res.json({ channels, categories: [] });
});

app.post('/api/channels/server/:serverId', authenticate, (req, res) => {
    const { name, type = 'text', topic } = req.body;
    const server = DB.servers.get(req.params.serverId);
    if (!server) return res.status(404).json({ error: true, message: 'Сервер не найден' });
    if (server.owner_id !== req.user.id) return res.status(403).json({ error: true, message: 'Нет прав' });

    const channelId = uuidv4();
    const channel = { id: channelId, server_id: req.params.serverId, name, type, topic: topic || null, position: 0 };
    DB.channels.set(channelId, channel);
    
    // Notify all server members about new channel
    notifyServerMembers(req.params.serverId, 'channel_created', { channel }, req.user.id);
    
    res.status(201).json({ channel });
});

app.get('/api/channels/:channelId', authenticate, (req, res) => {
    const channel = DB.channels.get(req.params.channelId);
    if (!channel) return res.status(404).json({ error: true, message: 'Канал не найден' });
    res.json({ channel });
});

app.delete('/api/channels/:channelId', authenticate, (req, res) => {
    const channel = DB.channels.get(req.params.channelId);
    if (!channel) return res.status(404).json({ error: true, message: 'Канал не найден' });
    const server = DB.servers.get(channel.server_id);
    if (server?.owner_id !== req.user.id) return res.status(403).json({ error: true, message: 'Нет прав' });
    
    const serverId = channel.server_id;
    DB.channels.delete(req.params.channelId);
    
    // Notify all server members about channel deletion
    notifyServerMembers(serverId, 'channel_deleted', { channelId: req.params.channelId, serverId }, req.user.id);
    
    res.json({ success: true });
});


// ============ MESSAGES ROUTES ============
app.get('/api/messages/channel/:channelId', authenticate, (req, res) => {
    const channel = DB.channels.get(req.params.channelId);
    if (!channel) return res.status(404).json({ error: true, message: 'Канал не найден' });

    const messages = Array.from(DB.messages.values())
        .filter(m => m.channel_id === req.params.channelId)
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        .map(m => {
            const author = DB.users.get(m.author_id);
            return {
                ...m,
                author: author ? { id: author.id, username: author.username, tag: author.tag, avatar: author.avatar } : null,
                reactions: m.reactions || []
            };
        });

    res.json({ messages });
});

app.post('/api/messages/channel/:channelId', authenticate, (req, res) => {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: true, message: 'Сообщение не может быть пустым' });

    const channel = DB.channels.get(req.params.channelId);
    if (!channel) return res.status(404).json({ error: true, message: 'Канал не найден' });

    const messageId = uuidv4();
    const message = {
        id: messageId, channel_id: req.params.channelId, author_id: req.user.id,
        content, reactions: [], created_at: new Date().toISOString()
    };
    DB.messages.set(messageId, message);

    // Update server energy
    const server = DB.servers.get(channel.server_id);
    if (server) server.energy = (server.energy || 0) + 1;

    const responseMessage = {
        ...message,
        author: { id: req.user.id, username: req.user.username, tag: req.user.tag, avatar: req.user.avatar }
    };

    console.log(`[Message] Broadcasting message to channel ${req.params.channelId} from user ${req.user.id}`);
    broadcastToChannel(req.params.channelId, {
        type: 'message_create',
        payload: { channelId: req.params.channelId, message: responseMessage }
    }, req.user.id);

    res.status(201).json({ message: responseMessage });
});

app.patch('/api/messages/:messageId', authenticate, (req, res) => {
    const { content } = req.body;
    const message = DB.messages.get(req.params.messageId);
    if (!message) return res.status(404).json({ error: true, message: 'Сообщение не найдено' });
    if (message.author_id !== req.user.id) return res.status(403).json({ error: true, message: 'Нет прав' });

    message.content = content;
    message.edited_at = new Date().toISOString();
    res.json({ message });
});

app.delete('/api/messages/:messageId', authenticate, (req, res) => {
    const message = DB.messages.get(req.params.messageId);
    if (!message) return res.status(404).json({ error: true, message: 'Сообщение не найдено' });
    if (message.author_id !== req.user.id) return res.status(403).json({ error: true, message: 'Нет прав' });

    DB.messages.delete(req.params.messageId);
    broadcastToChannel(message.channel_id, {
        type: 'message_delete',
        payload: { channelId: message.channel_id, messageId: req.params.messageId }
    });
    res.json({ success: true });
});

app.put('/api/messages/:messageId/reactions/:emoji', authenticate, (req, res) => {
    const message = DB.messages.get(req.params.messageId);
    if (!message) return res.status(404).json({ error: true, message: 'Сообщение не найдено' });

    const emoji = decodeURIComponent(req.params.emoji);
    if (!message.reactions) message.reactions = [];
    
    const existing = message.reactions.find(r => r.emoji === emoji);
    if (existing) {
        if (!existing.users?.includes(req.user.id)) {
            existing.users = existing.users || [];
            existing.users.push(req.user.id);
            existing.count = (existing.count || 1) + 1;
        }
    } else {
        message.reactions.push({ emoji, count: 1, users: [req.user.id] });
    }
    res.json({ success: true });
});

// ============ USERS ROUTES ============
// ВАЖНО: /api/users/search должен быть ПЕРЕД /api/users/:userId
app.get('/api/users/search', authenticate, (req, res) => {
    const { q } = req.query;
    console.log(`[Search] Query: "${q}"`);
    
    if (!q || q.length < 2) return res.json({ users: [] });

    const query = q.toLowerCase().replace('@', '');
    const results = [];

    for (const user of DB.users.values()) {
        if (user.id === req.user.id) continue;
        const fullTag = `${user.username}${user.tag}`.toLowerCase();
        if (fullTag.includes(query) || user.username.toLowerCase().includes(query)) {
            results.push({ id: user.id, username: user.username, tag: user.tag, avatar: user.avatar, status: user.status });
            if (results.length >= 10) break;
        }
    }
    
    console.log(`[Search] Found ${results.length} users`);
    res.json({ users: results });
});

app.patch('/api/users/me', authenticate, async (req, res) => {
    const { username, bio, status, avatar, banner } = req.body;
    const oldStatus = req.user.status;
    
    if (username) req.user.username = username;
    if (bio !== undefined) req.user.bio = bio;
    if (status) req.user.status = status;
    if (avatar !== undefined) req.user.avatar = avatar;
    if (banner !== undefined) req.user.banner = banner;
    
    // Sync with secure database
    try {
        await Database.Accounts.update(req.user.id, { username, bio, status, avatar, banner });
    } catch (e) {
        // Continue even if DB sync fails - in-memory is primary
    }
    
    // Broadcast status change to all friends
    if (status && status !== oldStatus) {
        broadcastStatusUpdate(req.user.id, status);
    }
    
    res.json({ user: { id: req.user.id, username: req.user.username, tag: req.user.tag, avatar: req.user.avatar, banner: req.user.banner, bio: req.user.bio, status: req.user.status } });
});

// Update user status
app.post('/api/users/me/status', authenticate, async (req, res) => {
    const { status } = req.body;
    if (!status || !['online', 'idle', 'dnd', 'offline'].includes(status)) {
        return res.status(400).json({ error: true, message: 'Неверный статус' });
    }
    
    const oldStatus = req.user.status;
    req.user.status = status;
    
    // Sync with secure database
    try {
        await Database.Accounts.update(req.user.id, { status });
    } catch (e) {
        // Continue even if DB sync fails
    }
    
    // Broadcast status change to all friends
    if (status !== oldStatus) {
        broadcastStatusUpdate(req.user.id, status);
    }
    
    res.json({ success: true, status });
});

// E2EE Public Key endpoints
app.post('/api/users/me/public-key', authenticate, async (req, res) => {
    const { publicKey } = req.body;
    if (!publicKey) return res.status(400).json({ error: true, message: 'Публичный ключ обязателен' });
    
    // Store public key (server never sees private key)
    req.user.publicKey = publicKey;
    
    // Sync with secure database
    try {
        await Database.Accounts.update(req.user.id, { publicKey });
    } catch (e) {
        // Continue even if DB sync fails
    }
    
    res.json({ success: true });
});

app.get('/api/users/:userId/public-key', authenticate, (req, res) => {
    const user = DB.users.get(req.params.userId);
    if (!user) return res.status(404).json({ error: true, message: 'Пользователь не найден' });
    if (!user.publicKey) return res.status(404).json({ error: true, message: 'Публичный ключ не найден' });
    
    res.json({ publicKey: user.publicKey });
});

app.get('/api/users/:userId', authenticate, (req, res) => {
    const user = DB.users.get(req.params.userId);
    if (!user) return res.status(404).json({ error: true, message: 'Пользователь не найден' });
    res.json({ user: { id: user.id, username: user.username, tag: user.tag, avatar: user.avatar, banner: user.banner, bio: user.bio, status: user.status, created_at: user.created_at } });
});

app.post('/api/users/find', authenticate, (req, res) => {
    const { username, tag } = req.body;
    if (!username || !tag) return res.status(400).json({ error: true, message: 'Укажите username и tag' });

    const normalizedTag = tag.startsWith('#') ? tag : `#${tag}`;
    for (const user of DB.users.values()) {
        if (user.username.toLowerCase() === username.toLowerCase() && user.tag === normalizedTag) {
            return res.json({ user: { id: user.id, username: user.username, tag: user.tag, avatar: user.avatar, status: user.status } });
        }
    }
    res.status(404).json({ error: true, message: 'Пользователь не найден' });
});

// ============ FRIENDS ROUTES ============
app.post('/api/friends/request/:userId', authenticate, (req, res) => {
    const targetUser = DB.users.get(req.params.userId);
    if (!targetUser) return res.status(404).json({ error: true, message: 'Пользователь не найден' });
    if (targetUser.id === req.user.id) return res.status(400).json({ error: true, message: 'Нельзя добавить себя в друзья' });

    // Проверяем, не друзья ли уже
    for (const friendship of DB.friends.values()) {
        if ((friendship.user1_id === req.user.id && friendship.user2_id === targetUser.id) ||
            (friendship.user1_id === targetUser.id && friendship.user2_id === req.user.id)) {
            return res.status(400).json({ error: true, message: 'Уже в друзьях' });
        }
    }

    // Проверяем, нет ли уже запроса
    for (const request of DB.friendRequests.values()) {
        if (request.from_user_id === req.user.id && request.to_user_id === targetUser.id && request.status === 'pending') {
            return res.status(400).json({ error: true, message: 'Запрос уже отправлен' });
        }
    }

    const requestId = uuidv4();
    const friendRequest = {
        id: requestId,
        from_user_id: req.user.id,
        to_user_id: targetUser.id,
        status: 'pending',
        created_at: new Date().toISOString()
    };
    DB.friendRequests.set(requestId, friendRequest);

    // Send WebSocket notification to target user
    notifyUser(targetUser.id, {
        type: 'friend_request',
        payload: {
            request: {
                ...friendRequest,
                user: {
                    id: req.user.id,
                    username: req.user.username,
                    tag: req.user.tag,
                    avatar: req.user.avatar,
                    status: req.user.status
                }
            }
        }
    });

    console.log(`✓ Запрос в друзья: ${req.user.username} → ${targetUser.username}`);
    res.status(201).json({ request: friendRequest });
});

app.get('/api/friends/requests', authenticate, (req, res) => {
    const incoming = [];
    const outgoing = [];

    for (const request of DB.friendRequests.values()) {
        if (request.status !== 'pending') continue;

        if (request.to_user_id === req.user.id) {
            const fromUser = DB.users.get(request.from_user_id);
            if (fromUser) {
                incoming.push({
                    ...request,
                    user: { id: fromUser.id, username: fromUser.username, tag: fromUser.tag, avatar: fromUser.avatar, status: fromUser.status }
                });
            }
        } else if (request.from_user_id === req.user.id) {
            const toUser = DB.users.get(request.to_user_id);
            if (toUser) {
                outgoing.push({
                    ...request,
                    user: { id: toUser.id, username: toUser.username, tag: toUser.tag, avatar: toUser.avatar, status: toUser.status }
                });
            }
        }
    }

    res.json({ incoming, outgoing });
});

app.post('/api/friends/requests/:requestId/accept', authenticate, (req, res) => {
    const request = DB.friendRequests.get(req.params.requestId);
    if (!request) return res.status(404).json({ error: true, message: 'Запрос не найден' });
    if (request.to_user_id !== req.user.id) return res.status(403).json({ error: true, message: 'Нет прав' });
    if (request.status !== 'pending') return res.status(400).json({ error: true, message: 'Запрос уже обработан' });

    request.status = 'accepted';

    const friendshipId = uuidv4();
    DB.friends.set(friendshipId, {
        id: friendshipId,
        user1_id: request.from_user_id,
        user2_id: request.to_user_id,
        created_at: new Date().toISOString()
    });

    // Notify the user who sent the request
    notifyUser(request.from_user_id, {
        type: 'friend_request_accepted',
        payload: {
            user: {
                id: req.user.id,
                username: req.user.username,
                tag: req.user.tag,
                avatar: req.user.avatar,
                status: req.user.status
            }
        }
    });

    console.log(`✓ Дружба создана: ${request.from_user_id} ↔ ${request.to_user_id}`);
    res.json({ success: true });
});

app.post('/api/friends/requests/:requestId/reject', authenticate, (req, res) => {
    const request = DB.friendRequests.get(req.params.requestId);
    if (!request) return res.status(404).json({ error: true, message: 'Запрос не найден' });
    if (request.to_user_id !== req.user.id) return res.status(403).json({ error: true, message: 'Нет прав' });
    if (request.status !== 'pending') return res.status(400).json({ error: true, message: 'Запрос уже обработан' });

    request.status = 'rejected';
    res.json({ success: true });
});

app.delete('/api/friends/:userId', authenticate, (req, res) => {
    let friendshipId = null;
    for (const [id, friendship] of DB.friends.entries()) {
        if ((friendship.user1_id === req.user.id && friendship.user2_id === req.params.userId) ||
            (friendship.user1_id === req.params.userId && friendship.user2_id === req.user.id)) {
            friendshipId = id;
            break;
        }
    }

    if (!friendshipId) return res.status(404).json({ error: true, message: 'Не в друзьях' });
    DB.friends.delete(friendshipId);
    
    // Notify the other user that they were removed
    notifyUser(req.params.userId, {
        type: 'friend_removed',
        payload: { userId: req.user.id }
    });
    
    res.json({ success: true });
});

app.get('/api/users/me/friends', authenticate, (req, res) => {
    const friends = [];
    
    for (const friendship of DB.friends.values()) {
        let friendId = null;
        if (friendship.user1_id === req.user.id) friendId = friendship.user2_id;
        else if (friendship.user2_id === req.user.id) friendId = friendship.user1_id;

        if (friendId) {
            const friend = DB.users.get(friendId);
            if (friend) {
                friends.push({
                    id: friend.id,
                    username: friend.username,
                    tag: friend.tag,
                    avatar: friend.avatar,
                    status: friend.status
                });
            }
        }
    }

    res.json({ friends });
});

// ============ DM CHANNELS ============
app.post('/api/dm/create/:userId', authenticate, (req, res) => {
    const targetUserId = req.params.userId;
    const targetUser = DB.users.get(targetUserId);
    
    if (!targetUser) return res.status(404).json({ error: true, message: 'Пользователь не найден' });
    if (targetUserId === req.user.id) return res.status(400).json({ error: true, message: 'Нельзя создать DM с самим собой' });

    // Check if DM channel already exists
    for (const dm of DB.dmChannels.values()) {
        if ((dm.user1_id === req.user.id && dm.user2_id === targetUserId) ||
            (dm.user1_id === targetUserId && dm.user2_id === req.user.id)) {
            return res.json({ dmChannel: dm });
        }
    }

    // Create new DM channel
    const dmId = uuidv4();
    const dmChannel = {
        id: dmId,
        user1_id: req.user.id,
        user2_id: targetUserId,
        created_at: new Date().toISOString()
    };
    DB.dmChannels.set(dmId, dmChannel);

    console.log(`✓ DM канал создан: ${req.user.username} ↔ ${targetUser.username}`);
    res.status(201).json({ dmChannel });
});

app.get('/api/dm/:dmId', authenticate, (req, res) => {
    const dm = DB.dmChannels.get(req.params.dmId);
    if (!dm) return res.status(404).json({ error: true, message: 'DM канал не найден' });
    
    // Check if user is part of this DM
    if (dm.user1_id !== req.user.id && dm.user2_id !== req.user.id) {
        return res.status(403).json({ error: true, message: 'Нет доступа' });
    }

    // Get other user info
    const otherUserId = dm.user1_id === req.user.id ? dm.user2_id : dm.user1_id;
    const otherUser = DB.users.get(otherUserId);

    res.json({ 
        dmChannel: dm,
        otherUser: otherUser ? {
            id: otherUser.id,
            username: otherUser.username,
            tag: otherUser.tag,
            avatar: otherUser.avatar,
            status: otherUser.status
        } : null
    });
});

app.get('/api/dm/:dmId/messages', authenticate, (req, res) => {
    const dm = DB.dmChannels.get(req.params.dmId);
    if (!dm) return res.status(404).json({ error: true, message: 'DM канал не найден' });
    
    // Check if user is part of this DM
    if (dm.user1_id !== req.user.id && dm.user2_id !== req.user.id) {
        return res.status(403).json({ error: true, message: 'Нет доступа' });
    }

    const messages = Array.from(DB.messages.values())
        .filter(m => m.dm_id === req.params.dmId)
        .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
        .map(m => {
            const author = DB.users.get(m.author_id);
            return {
                ...m,
                author: author ? { id: author.id, username: author.username, tag: author.tag, avatar: author.avatar } : null,
                reactions: m.reactions || []
            };
        });

    res.json({ messages });
});

app.post('/api/dm/:dmId/messages', authenticate, (req, res) => {
    const { content } = req.body;
    if (!content) return res.status(400).json({ error: true, message: 'Сообщение не может быть пустым' });

    const dm = DB.dmChannels.get(req.params.dmId);
    if (!dm) return res.status(404).json({ error: true, message: 'DM канал не найден' });
    
    // Check if user is part of this DM
    if (dm.user1_id !== req.user.id && dm.user2_id !== req.user.id) {
        return res.status(403).json({ error: true, message: 'Нет доступа' });
    }

    const messageId = uuidv4();
    const message = {
        id: messageId,
        dm_id: req.params.dmId,
        author_id: req.user.id,
        content,
        reactions: [],
        created_at: new Date().toISOString()
    };
    DB.messages.set(messageId, message);

    const responseMessage = {
        ...message,
        author: { id: req.user.id, username: req.user.username, tag: req.user.tag, avatar: req.user.avatar }
    };

    // Broadcast to DM channel - notify the other user
    const otherUserId = dm.user1_id === req.user.id ? dm.user2_id : dm.user1_id;
    console.log(`[DM] Sending message from ${req.user.id} to ${otherUserId} in DM ${req.params.dmId}`);
    
    notifyUser(otherUserId, {
        type: 'dm_message',
        payload: { dmId: req.params.dmId, message: responseMessage }
    });

    res.status(201).json({ message: responseMessage });
});

// ============ INVITES ============
app.post('/api/servers/:serverId/invites', authenticate, (req, res) => {
    const server = DB.servers.get(req.params.serverId);
    if (!server) return res.status(404).json({ error: true, message: 'Сервер не найден' });

    const code = Math.random().toString(36).substring(2, 10).toUpperCase();
    DB.invites.set(code, { server_id: req.params.serverId, creator_id: req.user.id, uses: 0 });
    res.json({ invite: { code, server_id: req.params.serverId } });
});

app.post('/api/invites/:code/join', authenticate, (req, res) => {
    const invite = DB.invites.get(req.params.code);
    if (!invite) return res.status(404).json({ error: true, message: 'Приглашение не найдено' });

    for (const m of DB.serverMembers.values()) {
        if (m.server_id === invite.server_id && m.user_id === req.user.id) {
            return res.status(400).json({ error: true, message: 'Вы уже на этом сервере' });
        }
    }

    DB.serverMembers.set(uuidv4(), { server_id: invite.server_id, user_id: req.user.id });
    invite.uses++;

    const server = DB.servers.get(invite.server_id);
    
    // Notify all existing members about new member (exclude the new member - they get server in API response)
    const newMember = {
        id: req.user.id,
        username: req.user.username,
        tag: req.user.tag,
        avatar: req.user.avatar,
        status: req.user.status
    };
    notifyServerMembers(invite.server_id, 'server_member_join', { serverId: invite.server_id, member: newMember }, req.user.id);
    
    res.json({ server });
});


// ============ GROUP CALLS (КОНФЫ) ============
// Create group call from DM call
app.post('/api/group-calls', authenticate, (req, res) => {
    const { memberIds, name } = req.body;
    
    if (!memberIds || !Array.isArray(memberIds)) {
        return res.status(400).json({ error: true, message: 'Укажите участников' });
    }
    
    // All invited members (for sending invites)
    const invitedMembers = memberIds.filter(id => id !== req.user.id);
    
    // Max 10 members total
    if (invitedMembers.length + 1 > 10) {
        return res.status(400).json({ error: true, message: 'Максимум 10 участников в конфе' });
    }
    
    // Verify all members are friends
    for (const memberId of invitedMembers) {
        let isFriend = false;
        for (const friendship of DB.friends.values()) {
            if ((friendship.user1_id === req.user.id && friendship.user2_id === memberId) ||
                (friendship.user1_id === memberId && friendship.user2_id === req.user.id)) {
                isFriend = true;
                break;
            }
        }
        if (!isFriend) {
            return res.status(400).json({ error: true, message: 'Можно добавлять только друзей' });
        }
    }
    
    const groupId = uuidv4();
    // Only creator is a member initially, others are invited
    const groupCall = {
        id: groupId,
        name: name || `Конфа`,
        owner_id: req.user.id,
        members: [req.user.id], // Only creator initially
        invited: invitedMembers, // Track who is invited
        created_at: new Date().toISOString()
    };
    
    DB.groupCalls.set(groupId, groupCall);
    
    // Get all user details (members + invited) for UI
    const allUserIds = [req.user.id, ...invitedMembers];
    const allUsersWithDetails = allUserIds.map(id => {
        const user = DB.users.get(id);
        return user ? { 
            id: user.id, 
            username: user.username, 
            tag: user.tag, 
            avatar: user.avatar, 
            status: user.status,
            pending: id !== req.user.id // Mark invited users as pending
        } : null;
    }).filter(Boolean);
    
    const creator = DB.users.get(req.user.id);
    
    // Send invite to all invited members
    invitedMembers.forEach(memberId => {
        notifyUser(memberId, {
            type: 'group_call_invite',
            payload: { 
                groupId: groupId,
                groupCall: { ...groupCall, members: allUsersWithDetails },
                groupName: groupCall.name,
                inviterId: req.user.id,
                inviter: { id: req.user.id, username: creator?.username, avatar: creator?.avatar }
            }
        });
    });
    
    console.log(`✓ Создана конфа: ${groupCall.name} (1 участник, ${invitedMembers.length} приглашено)`);
    res.status(201).json({ groupCall: { ...groupCall, members: allUsersWithDetails } });
});

// Accept group call invite
app.post('/api/group-calls/:groupId/accept', authenticate, (req, res) => {
    const groupCall = DB.groupCalls.get(req.params.groupId);
    if (!groupCall) {
        return res.status(404).json({ error: true, message: 'Конфа не найдена' });
    }
    
    // Check if user was invited
    if (!groupCall.invited?.includes(req.user.id) && !groupCall.members.includes(req.user.id)) {
        return res.status(403).json({ error: true, message: 'Вы не приглашены в эту конфу' });
    }
    
    // Add user to members if not already
    if (!groupCall.members.includes(req.user.id)) {
        groupCall.members.push(req.user.id);
    }
    
    // Remove from invited list
    if (groupCall.invited) {
        groupCall.invited = groupCall.invited.filter(id => id !== req.user.id);
    }
    
    // Get member details
    const membersWithDetails = groupCall.members.map(id => {
        const user = DB.users.get(id);
        return user ? { id: user.id, username: user.username, tag: user.tag, avatar: user.avatar, status: user.status } : null;
    }).filter(Boolean);
    
    res.json({ groupCall: { ...groupCall, members: membersWithDetails } });
});

// Get user's group calls
app.get('/api/group-calls', authenticate, (req, res) => {
    const userGroupCalls = [];
    
    for (const groupCall of DB.groupCalls.values()) {
        if (groupCall.members.includes(req.user.id)) {
            // Get member details
            const membersWithDetails = groupCall.members.map(id => {
                const user = DB.users.get(id);
                return user ? { id: user.id, username: user.username, tag: user.tag, avatar: user.avatar, status: user.status } : null;
            }).filter(Boolean);
            
            userGroupCalls.push({ ...groupCall, members: membersWithDetails });
        }
    }
    
    res.json({ groupCalls: userGroupCalls });
});

// Get specific group call
app.get('/api/group-calls/:groupId', authenticate, (req, res) => {
    const groupCall = DB.groupCalls.get(req.params.groupId);
    if (!groupCall) {
        return res.status(404).json({ error: true, message: 'Конфа не найдена' });
    }
    
    // Allow access if user is member or invited
    if (!groupCall.members.includes(req.user.id) && !groupCall.invited?.includes(req.user.id)) {
        return res.status(403).json({ error: true, message: 'Нет доступа' });
    }
    
    // Get member details (actual members + invited as pending)
    const allUserIds = [...groupCall.members, ...(groupCall.invited || [])];
    const membersWithDetails = allUserIds.map(id => {
        const user = DB.users.get(id);
        const isPending = !groupCall.members.includes(id);
        return user ? { 
            id: user.id, 
            username: user.username, 
            tag: user.tag, 
            avatar: user.avatar, 
            status: user.status,
            pending: isPending
        } : null;
    }).filter(Boolean);
    
    res.json({ groupCall: { ...groupCall, members: membersWithDetails } });
});

// Leave group call
app.post('/api/group-calls/:groupId/leave', authenticate, (req, res) => {
    const groupCall = DB.groupCalls.get(req.params.groupId);
    if (!groupCall) {
        return res.status(404).json({ error: true, message: 'Конфа не найдена' });
    }
    
    if (!groupCall.members.includes(req.user.id)) {
        return res.status(403).json({ error: true, message: 'Вы не в этой конфе' });
    }
    
    // Remove user from members
    groupCall.members = groupCall.members.filter(id => id !== req.user.id);
    
    // If no members left or owner left, delete group call
    if (groupCall.members.length === 0 || groupCall.owner_id === req.user.id) {
        DB.groupCalls.delete(req.params.groupId);
        
        // Notify remaining members
        groupCall.members.forEach(memberId => {
            notifyUser(memberId, {
                type: 'group_call_deleted',
                payload: { groupId: req.params.groupId }
            });
        });
    } else {
        // Notify remaining members about user leaving
        groupCall.members.forEach(memberId => {
            notifyUser(memberId, {
                type: 'group_call_member_left',
                payload: { groupId: req.params.groupId, userId: req.user.id }
            });
        });
    }
    
    res.json({ success: true });
});


// ============ VOICE CHANNEL USERS API ============
app.get('/api/voice/:channelId/users', authenticate, (req, res) => {
    const channelId = req.params.channelId;
    const users = voiceChannelUsers.get(channelId);
    
    if (!users) {
        return res.json({ users: [] });
    }
    
    const userList = Array.from(users.values());
    res.json({ users: userList });
});


// ============ WEBSOCKET ============
const wsClients = new Map();
const channelSubscriptions = new Map();
const dmSubscriptions = new Map();
const voiceChannelUsers = new Map(); // channelId -> Map(userId -> userData)

function broadcastToChannel(channelId, message, excludeUserId = null) {
    const subscribers = channelSubscriptions.get(channelId);
    console.log(`[Broadcast] Channel ${channelId}, subscribers:`, subscribers ? Array.from(subscribers) : 'none', 'exclude:', excludeUserId);
    
    if (!subscribers) {
        console.log(`[Broadcast] No subscribers for channel ${channelId}`);
        return;
    }

    const data = JSON.stringify(message);
    let sentCount = 0;
    subscribers.forEach(userId => {
        if (userId !== excludeUserId) {
            const clients = wsClients.get(userId);
            if (clients) {
                clients.forEach(ws => {
                    if (ws.readyState === WebSocket.OPEN) {
                        ws.send(data);
                        sentCount++;
                    }
                });
            }
        }
    });
    console.log(`[Broadcast] Sent to ${sentCount} clients`);
}

function broadcastToVoiceChannel(channelId, message, excludeUserId = null) {
    const users = voiceChannelUsers.get(channelId);
    if (!users) return;

    const data = JSON.stringify(message);
    users.forEach((userData, odUserId) => {
        if (odUserId !== excludeUserId) {
            const clients = wsClients.get(odUserId);
            if (clients) {
                clients.forEach(ws => {
                    if (ws.readyState === WebSocket.OPEN) ws.send(data);
                });
            }
        }
    });
}

function broadcastToDM(dmId, message, excludeUserId = null) {
    const dm = DB.dmChannels.get(dmId);
    if (!dm) return;

    const data = JSON.stringify(message);
    const userIds = [dm.user1_id, dm.user2_id];

    userIds.forEach(userId => {
        if (userId !== excludeUserId) {
            const clients = wsClients.get(userId);
            if (clients) {
                clients.forEach(ws => {
                    if (ws.readyState === WebSocket.OPEN) ws.send(data);
                });
            }
        }
    });
}

function notifyUser(userId, message) {
    const clients = wsClients.get(userId);
    console.log(`[Notify] Notifying user ${userId}, has clients:`, !!clients);
    
    if (!clients) {
        console.log(`[Notify] No WebSocket clients for user ${userId}`);
        return;
    }

    const data = JSON.stringify(message);
    let sentCount = 0;
    clients.forEach(ws => {
        if (ws.readyState === WebSocket.OPEN) {
            ws.send(data);
            sentCount++;
        }
    });
    console.log(`[Notify] Sent to ${sentCount} clients for user ${userId}`);
}

function broadcastStatusUpdate(userId, status) {
    // Find all friends of this user
    const friendIds = new Set();
    for (const friendship of DB.friends.values()) {
        if (friendship.user1_id === userId) {
            friendIds.add(friendship.user2_id);
        } else if (friendship.user2_id === userId) {
            friendIds.add(friendship.user1_id);
        }
    }

    // Notify all friends about status change
    const message = {
        type: 'user_status_update',
        payload: { userId, status }
    };

    friendIds.forEach(friendId => {
        notifyUser(friendId, message);
    });

    // Also broadcast to all servers where user is a member
    const notifiedServerMembers = new Set();
    for (const member of DB.serverMembers.values()) {
        if (member.user_id === userId) {
            // Get all members of this server
            for (const serverMember of DB.serverMembers.values()) {
                if (serverMember.server_id === member.server_id && serverMember.user_id !== userId) {
                    if (!notifiedServerMembers.has(serverMember.user_id)) {
                        notifiedServerMembers.add(serverMember.user_id);
                        notifyUser(serverMember.user_id, message);
                    }
                }
            }
        }
    }
}

function broadcastToServer(serverId, message, excludeUserId = null) {
    // Get all members of the server
    const memberIds = [];
    for (const member of DB.serverMembers.values()) {
        if (member.server_id === serverId && member.user_id !== excludeUserId) {
            memberIds.push(member.user_id);
        }
    }

    console.log(`[Broadcast] Broadcasting to server ${serverId}, ${memberIds.length} members:`, memberIds);
    console.log(`[Broadcast] Message type:`, message.type);
    
    // Notify all members
    memberIds.forEach(userId => {
        console.log(`[Broadcast] Sending to user ${userId}`);
        notifyUser(userId, message);
    });
}

function notifyServerMembers(serverId, type, payload, excludeUserId = null) {
    broadcastToServer(serverId, { type, payload }, excludeUserId);
}

wss.on('connection', (ws) => {
    let userId = null;

    ws.on('message', (data) => {
        try {
            const { type, payload } = JSON.parse(data);
            
            // Log ALL incoming messages
            console.log(`[WS IN] type=${type} from userId=${userId}`);

            switch (type) {
                case 'authenticate':
                    try {
                        const decoded = jwt.verify(payload.token, JWT_SECRET);
                        userId = decoded.userId;
                        
                        if (!wsClients.has(userId)) wsClients.set(userId, new Set());
                        wsClients.get(userId).add(ws);

                        const user = DB.users.get(userId);
                        if (user) {
                            const oldStatus = user.status;
                            user.status = 'online';
                            
                            // Broadcast status change
                            if (oldStatus !== 'online') {
                                broadcastStatusUpdate(userId, 'online');
                            }
                        }

                        ws.send(JSON.stringify({ type: 'authenticated', payload: { userId } }));
                        console.log(`⚡ WebSocket: ${user?.username || userId} подключён`);
                    } catch (e) {
                        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Auth failed' } }));
                    }
                    break;

                case 'subscribe':
                    if (userId && payload.channelId) {
                        if (!channelSubscriptions.has(payload.channelId)) {
                            channelSubscriptions.set(payload.channelId, new Set());
                        }
                        channelSubscriptions.get(payload.channelId).add(userId);
                        console.log(`[Subscribe] User ${userId} subscribed to channel ${payload.channelId}`);
                        console.log(`[Subscribe] Channel ${payload.channelId} now has ${channelSubscriptions.get(payload.channelId).size} subscribers`);
                    }
                    break;

                case 'unsubscribe':
                    if (userId && payload.channelId) {
                        channelSubscriptions.get(payload.channelId)?.delete(userId);
                    }
                    break;

                case 'typing':
                    if (userId && payload.channelId) {
                        broadcastToChannel(payload.channelId, {
                            type: 'typing_start',
                            payload: { channelId: payload.channelId, userId }
                        }, userId);

                        setTimeout(() => {
                            broadcastToChannel(payload.channelId, {
                                type: 'typing_stop',
                                payload: { channelId: payload.channelId, userId }
                            }, userId);
                        }, 3000);
                    }
                    break;

                case 'heartbeat':
                    ws.send(JSON.stringify({ type: 'heartbeat_ack', payload: { timestamp: Date.now() } }));
                    break;

                // Voice channel events
                case 'voice_join':
                    if (userId && payload.channelId) {
                        // Add user to voice channel
                        if (!voiceChannelUsers.has(payload.channelId)) {
                            voiceChannelUsers.set(payload.channelId, new Map());
                        }
                        const user = DB.users.get(userId);
                        voiceChannelUsers.get(payload.channelId).set(userId, {
                            id: userId,
                            username: user?.username,
                            avatar: user?.avatar,
                            muted: false,
                            deafened: false
                        });

                        console.log(`[Voice] User ${user?.username} joined voice channel ${payload.channelId}`);

                        // Send current users to the joining user
                        const currentUsers = Array.from(voiceChannelUsers.get(payload.channelId).values());
                        ws.send(JSON.stringify({
                            type: 'voice_channel_users',
                            payload: { channelId: payload.channelId, users: currentUsers }
                        }));

                        // Get the server ID for this channel
                        const voiceChannel = DB.channels.get(payload.channelId);
                        const serverId = voiceChannel?.server_id;
                        console.log(`[Voice Join] Channel:`, payload.channelId, 'Server ID:', serverId);

                        // Notify ALL server members about voice join (for UI update)
                        if (serverId) {
                            console.log(`[Voice Join] Notifying all members of server ${serverId}`);
                            notifyServerMembers(serverId, 'voice_user_joined', {
                                channelId: payload.channelId,
                                userId,
                                user: { id: userId, username: user?.username, avatar: user?.avatar }
                            }, null); // Don't exclude anyone - everyone should see
                        } else {
                            console.log(`[Voice Join] No server ID found for channel!`);
                        }
                    }
                    break;

                case 'voice_leave':
                    if (userId && payload.channelId) {
                        const channelUsers = voiceChannelUsers.get(payload.channelId);
                        if (channelUsers) {
                            channelUsers.delete(userId);
                            if (channelUsers.size === 0) {
                                voiceChannelUsers.delete(payload.channelId);
                            }
                        }

                        console.log(`[Voice] User ${userId} left voice channel ${payload.channelId}`);
                        console.log(`[Voice Leave] All channels in DB:`, Array.from(DB.channels.keys()));

                        // Get the server ID for this channel
                        const leaveChannel = DB.channels.get(payload.channelId);
                        const leaveServerId = leaveChannel?.server_id;
                        console.log(`[Voice Leave] Channel found:`, !!leaveChannel, 'Server ID:', leaveServerId);

                        // Notify ALL server members about voice leave (for UI update)
                        if (leaveServerId) {
                            console.log(`[Voice Leave] Notifying all members of server ${leaveServerId}`);
                            notifyServerMembers(leaveServerId, 'voice_user_left', {
                                channelId: payload.channelId,
                                userId
                            }, null); // Don't exclude anyone
                        } else {
                            console.log(`[Voice Leave] No server ID found for channel ${payload.channelId}`);
                        }
                    }
                    break;

                case 'voice_offer':
                    if (userId && payload.targetUserId && payload.offer) {
                        console.log(`[Voice] Forwarding offer from ${userId} to ${payload.targetUserId}`);
                        notifyUser(payload.targetUserId, {
                            type: 'voice_offer',
                            payload: { fromUserId: userId, offer: payload.offer }
                        });
                    }
                    break;

                case 'voice_answer':
                    if (userId && payload.targetUserId && payload.answer) {
                        console.log(`[Voice] Forwarding answer from ${userId} to ${payload.targetUserId}`);
                        notifyUser(payload.targetUserId, {
                            type: 'voice_answer',
                            payload: { fromUserId: userId, answer: payload.answer }
                        });
                    }
                    break;

                case 'voice_ice_candidate':
                    if (userId && payload.targetUserId && payload.candidate) {
                        notifyUser(payload.targetUserId, {
                            type: 'voice_ice_candidate',
                            payload: { fromUserId: userId, candidate: payload.candidate }
                        });
                    }
                    break;

                // Screen share events
                case 'screen_share_offer':
                    if (userId && payload.targetUserId && payload.offer) {
                        console.log(`[Screen] Forwarding screen share offer from ${userId} to ${payload.targetUserId}`);
                        const targetWs = userConnections.get(payload.targetUserId);
                        console.log(`[Screen] Target user WS exists: ${!!targetWs}`);
                        notifyUser(payload.targetUserId, {
                            type: 'screen_share_offer',
                            payload: { fromUserId: userId, offer: payload.offer }
                        });
                    } else {
                        console.log(`[Screen] Missing data: userId=${userId}, targetUserId=${payload.targetUserId}, offer=${!!payload.offer}`);
                    }
                    break;

                case 'screen_share_answer':
                    if (userId && payload.targetUserId && payload.answer) {
                        console.log(`[Screen] Forwarding screen share answer from ${userId} to ${payload.targetUserId}`);
                        notifyUser(payload.targetUserId, {
                            type: 'screen_share_answer',
                            payload: { fromUserId: userId, answer: payload.answer }
                        });
                    }
                    break;

                case 'screen_ice_candidate':
                    if (userId && payload.targetUserId && payload.candidate) {
                        notifyUser(payload.targetUserId, {
                            type: 'screen_ice_candidate',
                            payload: { fromUserId: userId, candidate: payload.candidate }
                        });
                    }
                    break;

                case 'screen_share_stop':
                    if (userId && payload.targetUserId) {
                        console.log(`[Screen] Screen share stopped by ${userId}`);
                        notifyUser(payload.targetUserId, {
                            type: 'screen_share_stop',
                            payload: { fromUserId: userId }
                        });
                    }
                    break;

                case 'voice_speaking':
                    if (userId && payload.channelId) {
                        broadcastToVoiceChannel(payload.channelId, {
                            type: 'voice_speaking',
                            payload: { channelId: payload.channelId, userId, speaking: payload.speaking }
                        }, userId);
                    }
                    break;

                case 'voice_mute':
                    if (userId && payload.channelId) {
                        const channelUsers = voiceChannelUsers.get(payload.channelId);
                        if (channelUsers && channelUsers.has(userId)) {
                            channelUsers.get(userId).muted = payload.muted;
                        }
                        broadcastToVoiceChannel(payload.channelId, {
                            type: 'voice_muted',
                            payload: { channelId: payload.channelId, userId, muted: payload.muted }
                        }, userId);
                    }
                    break;

                case 'voice_deafen':
                    if (userId && payload.channelId) {
                        const channelUsers = voiceChannelUsers.get(payload.channelId);
                        if (channelUsers && channelUsers.has(userId)) {
                            channelUsers.get(userId).deafened = payload.deafened;
                        }
                    }
                    break;

                // DM Call events
                case 'dm_call_start':
                    if (userId && payload.dmId && payload.targetUserId) {
                        const caller = DB.users.get(userId);
                        console.log(`[DM Call] ${caller?.username} calling ${payload.targetUserId}`);
                        
                        // Store call info if not already active
                        if (!DB.activeCalls.has(payload.dmId)) {
                            DB.activeCalls.set(payload.dmId, {
                                starterId: userId,
                                starterUsername: caller?.username,
                                startTime: null, // Will be set when call is accepted
                                participants: new Set([userId])
                            });
                        }
                        
                        notifyUser(payload.targetUserId, {
                            type: 'dm_call_incoming',
                            payload: {
                                dmId: payload.dmId,
                                callerId: userId,
                                caller: {
                                    id: userId,
                                    username: caller?.username,
                                    avatar: caller?.avatar
                                }
                            }
                        });
                    }
                    break;

                case 'dm_call_accept':
                    if (userId && payload.dmId && payload.callerId) {
                        console.log(`[DM Call] ${userId} accepted call from ${payload.callerId}`);
                        
                        // Set call start time when accepted
                        const activeCall = DB.activeCalls.get(payload.dmId);
                        if (activeCall) {
                            activeCall.startTime = Date.now();
                            activeCall.participants.add(userId);
                        }
                        
                        notifyUser(payload.callerId, {
                            type: 'dm_call_accepted',
                            payload: {
                                dmId: payload.dmId,
                                userId: userId
                            }
                        });
                    }
                    break;

                case 'dm_call_reject':
                    if (userId && payload.dmId && payload.callerId) {
                        console.log(`[DM Call] ${userId} rejected call from ${payload.callerId}`);
                        
                        // Remove call from active calls (call was never connected)
                        DB.activeCalls.delete(payload.dmId);
                        
                        notifyUser(payload.callerId, {
                            type: 'dm_call_rejected',
                            payload: {
                                dmId: payload.dmId,
                                userId: userId
                            }
                        });
                    }
                    break;

                case 'dm_call_end':
                    if (userId && payload.dmId) {
                        const dm = DB.dmChannels.get(payload.dmId);
                        if (dm) {
                            const otherUserId = dm.user1_id === userId ? dm.user2_id : dm.user1_id;
                            console.log(`[DM Call] ${userId} ended call with ${otherUserId}`);
                            
                            // Check if call was active and create system message
                            const activeCall = DB.activeCalls.get(payload.dmId);
                            if (activeCall) {
                                // Remove user from participants
                                activeCall.participants.delete(userId);
                                
                                // If no participants left, end the call and create system message
                                if (activeCall.participants.size === 0 && activeCall.startTime) {
                                    const duration = Date.now() - activeCall.startTime;
                                    const starter = DB.users.get(activeCall.starterId);
                                    
                                    // Create system message about call
                                    const messageId = uuidv4();
                                    const systemMessage = {
                                        id: messageId,
                                        dm_id: payload.dmId,
                                        author_id: activeCall.starterId,
                                        content: '',
                                        type: 'call_ended',
                                        call_duration: duration,
                                        call_starter_id: activeCall.starterId,
                                        call_starter_username: activeCall.starterUsername || starter?.username,
                                        reactions: [],
                                        created_at: new Date().toISOString()
                                    };
                                    DB.messages.set(messageId, systemMessage);
                                    
                                    const responseMessage = {
                                        ...systemMessage,
                                        author: starter ? { 
                                            id: starter.id, 
                                            username: starter.username, 
                                            tag: starter.tag, 
                                            avatar: starter.avatar 
                                        } : null
                                    };
                                    
                                    // Notify both users about the system message
                                    notifyUser(dm.user1_id, {
                                        type: 'dm_message',
                                        payload: { dmId: payload.dmId, message: responseMessage }
                                    });
                                    notifyUser(dm.user2_id, {
                                        type: 'dm_message',
                                        payload: { dmId: payload.dmId, message: responseMessage }
                                    });
                                    
                                    // Remove call from active calls
                                    DB.activeCalls.delete(payload.dmId);
                                }
                            }
                            
                            notifyUser(otherUserId, {
                                type: 'dm_call_ended',
                                payload: {
                                    dmId: payload.dmId,
                                    userId: userId
                                }
                            });
                        }
                    }
                    break;

                case 'dm_call_cancel':
                    if (userId && payload.dmId) {
                        // Find target user from DM channel if not provided
                        let targetUserId = payload.targetUserId;
                        if (!targetUserId) {
                            const dm = DB.dmChannels.get(payload.dmId);
                            if (dm) {
                                targetUserId = dm.user1_id === userId ? dm.user2_id : dm.user1_id;
                            }
                        }
                        
                        // Remove call from active calls (call was never connected)
                        DB.activeCalls.delete(payload.dmId);
                        
                        if (targetUserId) {
                            console.log(`[DM Call] ${userId} cancelled call to ${targetUserId}`);
                            
                            notifyUser(targetUserId, {
                                type: 'dm_call_cancelled',
                                payload: {
                                    dmId: payload.dmId,
                                    callerId: userId
                                }
                            });
                        }
                    }
                    break;

                case 'dm_call_rejoin':
                    if (userId && payload.dmId && payload.targetUserId) {
                        const user = DB.users.get(userId);
                        console.log(`[DM Call] ${user?.username} rejoining call with ${payload.targetUserId}`);
                        
                        notifyUser(payload.targetUserId, {
                            type: 'dm_call_rejoined',
                            payload: {
                                dmId: payload.dmId,
                                userId: userId,
                                user: {
                                    id: userId,
                                    username: user?.username,
                                    avatar: user?.avatar
                                }
                            }
                        });
                    }
                    break;

                // Group call (Конфа) events
                case 'group_call_join':
                    if (userId && payload.groupId) {
                        const groupCall = DB.groupCalls.get(payload.groupId);
                        if (groupCall && groupCall.members.includes(userId)) {
                            // Add to voice users for this group
                            if (!voiceChannelUsers.has(`group_${payload.groupId}`)) {
                                voiceChannelUsers.set(`group_${payload.groupId}`, new Map());
                            }
                            const user = DB.users.get(userId);
                            voiceChannelUsers.get(`group_${payload.groupId}`).set(userId, {
                                id: userId,
                                username: user?.username,
                                avatar: user?.avatar,
                                muted: false
                            });
                            
                            console.log(`[Group Call] User ${user?.username} joined group ${payload.groupId}`);
                            
                            // Notify all group members
                            groupCall.members.forEach(memberId => {
                                if (memberId !== userId) {
                                    notifyUser(memberId, {
                                        type: 'group_call_user_joined',
                                        payload: {
                                            groupId: payload.groupId,
                                            user: { id: userId, username: user?.username, avatar: user?.avatar }
                                        }
                                    });
                                }
                            });
                            
                            // Send current users to joining user
                            const currentUsers = Array.from(voiceChannelUsers.get(`group_${payload.groupId}`).values());
                            ws.send(JSON.stringify({
                                type: 'group_call_users',
                                payload: { groupId: payload.groupId, users: currentUsers }
                            }));
                        }
                    }
                    break;

                case 'group_call_leave':
                    if (userId && payload.groupId) {
                        const groupUsers = voiceChannelUsers.get(`group_${payload.groupId}`);
                        if (groupUsers) {
                            groupUsers.delete(userId);
                            if (groupUsers.size === 0) {
                                voiceChannelUsers.delete(`group_${payload.groupId}`);
                            }
                        }
                        
                        const groupCall = DB.groupCalls.get(payload.groupId);
                        if (groupCall) {
                            console.log(`[Group Call] User ${userId} left group ${payload.groupId}`);
                            
                            // Notify all group members
                            groupCall.members.forEach(memberId => {
                                if (memberId !== userId) {
                                    notifyUser(memberId, {
                                        type: 'group_call_user_left',
                                        payload: { groupId: payload.groupId, userId }
                                    });
                                }
                            });
                        }
                    }
                    break;

                case 'group_call_invite':
                    if (userId && payload.groupId && payload.targetUserId) {
                        const groupCall = DB.groupCalls.get(payload.groupId);
                        const caller = DB.users.get(userId);
                        
                        if (groupCall && groupCall.members.includes(userId)) {
                            console.log(`[Group Call] ${caller?.username} inviting ${payload.targetUserId} to group ${payload.groupId}`);
                            
                            notifyUser(payload.targetUserId, {
                                type: 'group_call_invite',
                                payload: {
                                    groupId: payload.groupId,
                                    groupName: groupCall.name,
                                    inviterId: userId,
                                    inviter: { id: userId, username: caller?.username, avatar: caller?.avatar }
                                }
                            });
                        }
                    }
                    break;
            }
        } catch (e) {
            console.error('WS error:', e);
        }
    });

    ws.on('close', () => {
        if (userId) {
            const clients = wsClients.get(userId);
            if (clients) {
                clients.delete(ws);
                if (clients.size === 0) {
                    wsClients.delete(userId);
                    const user = DB.users.get(userId);
                    if (user) {
                        user.status = 'offline';
                        // Broadcast status change
                        broadcastStatusUpdate(userId, 'offline');
                    }

                    // Remove from all voice channels
                    for (const [channelId, users] of voiceChannelUsers.entries()) {
                        if (users.has(userId)) {
                            console.log(`[Voice Close] User ${userId} disconnected from voice channel ${channelId}`);
                            users.delete(userId);
                            
                            // Get the server ID for this channel to notify ALL server members
                            const voiceChannel = DB.channels.get(channelId);
                            const serverId = voiceChannel?.server_id;
                            console.log(`[Voice Close] Channel server ID: ${serverId}`);
                            
                            if (serverId) {
                                // Notify ALL server members about voice leave (for UI update)
                                console.log(`[Voice Close] Notifying all server members about voice_user_left`);
                                notifyServerMembers(serverId, 'voice_user_left', {
                                    channelId,
                                    userId
                                }, null);
                            } else {
                                // Fallback to voice channel broadcast if no server found
                                console.log(`[Voice Close] No server found, using broadcastToVoiceChannel`);
                                broadcastToVoiceChannel(channelId, {
                                    type: 'voice_user_left',
                                    payload: { channelId, userId }
                                });
                            }
                            
                            if (users.size === 0) {
                                voiceChannelUsers.delete(channelId);
                            }
                        }
                    }
                }
            }
            channelSubscriptions.forEach(subscribers => subscribers.delete(userId));
        }
    });
});

// ============ HEALTH & STATIC ============
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', database: 'in-memory', users: DB.users.size, servers: DB.servers.size });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ============ START SERVER ============
// Initialize database and start server
(async () => {
    try {
        await Database.init();
        console.log('  💾 Secure database module loaded');
    } catch (e) {
        console.error('  ⚠️ Database init warning:', e.message);
    }

    server.listen(PORT, '0.0.0.0', () => {
        console.log('');
        console.log('  ⚡ Flash Server (Standalone)');
        console.log('  ────────────────────────────────');
        console.log(`  🌐 Port: ${PORT}`);
        console.log('  💾 База данных: In-Memory + Secure Storage');
        console.log('  🔐 Пароли: PBKDF2 + SHA-512 (не читаемы)');
        console.log('  ────────────────────────────────');
        console.log('  Готов к работе!');
        console.log('');
    });
})();
