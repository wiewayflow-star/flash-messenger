/**
 * Flash Server - MySQL Version
 * Полнофункциональный сервер с реальной базой данных
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const { pool, testConnection, initDatabase } = require('./database/connection');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'flash-secret-key';

// ============ MIDDLEWARE ============
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '../frontend')));

const authenticate = async (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
        return res.status(401).json({ error: true, message: 'Требуется авторизация' });
    }
    try {
        const decoded = jwt.verify(auth.split(' ')[1], JWT_SECRET);
        const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [decoded.userId]);
        if (!rows.length) return res.status(401).json({ error: true, message: 'Пользователь не найден' });
        req.user = rows[0];
        next();
    } catch (e) {
        res.status(401).json({ error: true, message: 'Недействительный токен' });
    }
};

// ============ HELPERS ============
const generateUniqueTag = async (username) => {
    const [rows] = await pool.query(
        'SELECT tag FROM users WHERE LOWER(username) = LOWER(?)',
        [username]
    );
    const existingTags = new Set(rows.map(r => r.tag));
    
    for (let i = 1; i <= 9999; i++) {
        const tag = '#' + i.toString().padStart(4, '0');
        if (!existingTags.has(tag)) return tag;
    }
    return '#' + Math.floor(Math.random() * 10000).toString().padStart(4, '0');
};


// ============ AUTH ROUTES ============
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, username, password } = req.body;
        
        if (!email || !username || !password) {
            return res.status(400).json({ error: true, message: 'Заполните все поля' });
        }

        // Check email exists
        const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
        if (existing.length) {
            return res.status(400).json({ error: true, message: 'Email уже зарегистрирован' });
        }

        const userId = uuidv4();
        const passwordHash = await bcrypt.hash(password, 10);
        const tag = await generateUniqueTag(username);

        await pool.query(
            'INSERT INTO users (id, email, username, tag, password_hash, status) VALUES (?, ?, ?, ?, ?, ?)',
            [userId, email, username, tag, passwordHash, 'online']
        );

        const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '7d' });
        console.log(`✓ Новый пользователь: ${username}${tag}`);

        res.status(201).json({
            user: { id: userId, email, username, tag, avatar: null, status: 'online' },
            token
        });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: true, message: 'Ошибка регистрации' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);

        if (!rows.length) {
            return res.status(401).json({ error: true, message: 'Неверный email или пароль' });
        }

        const user = rows[0];
        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: true, message: 'Неверный email или пароль' });
        }

        await pool.query('UPDATE users SET status = ? WHERE id = ?', ['online', user.id]);
        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '7d' });

        console.log(`✓ Вход: ${user.username}${user.tag}`);

        res.json({
            user: { id: user.id, email: user.email, username: user.username, tag: user.tag, avatar: user.avatar, status: 'online' },
            token
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: true, message: 'Ошибка входа' });
    }
});

app.post('/api/auth/logout', authenticate, async (req, res) => {
    await pool.query('UPDATE users SET status = ? WHERE id = ?', ['offline', req.user.id]);
    res.json({ success: true });
});

app.get('/api/auth/me', authenticate, (req, res) => {
    const u = req.user;
    res.json({ user: { id: u.id, email: u.email, username: u.username, tag: u.tag, avatar: u.avatar, status: u.status } });
});

// ============ SERVERS ROUTES ============
app.get('/api/servers', authenticate, async (req, res) => {
    try {
        const [rows] = await pool.query(`
            SELECT s.* FROM servers s
            JOIN server_members sm ON s.id = sm.server_id
            WHERE sm.user_id = ?
        `, [req.user.id]);
        res.json({ servers: rows });
    } catch (error) {
        res.status(500).json({ error: true, message: 'Ошибка загрузки серверов' });
    }
});

app.post('/api/servers', authenticate, async (req, res) => {
    try {
        const { name, icon, description } = req.body;
        
        if (!name || name.length < 2) {
            return res.status(400).json({ error: true, message: 'Название минимум 2 символа' });
        }

        const serverId = uuidv4();
        const memberId = uuidv4();
        const channelId = uuidv4();
        const voiceChannelId = uuidv4();

        await pool.query(
            'INSERT INTO servers (id, name, icon, description, owner_id) VALUES (?, ?, ?, ?, ?)',
            [serverId, name, icon || null, description || null, req.user.id]
        );

        await pool.query(
            'INSERT INTO server_members (id, server_id, user_id) VALUES (?, ?, ?)',
            [memberId, serverId, req.user.id]
        );

        await pool.query(
            'INSERT INTO channels (id, server_id, name, type, topic, position) VALUES (?, ?, ?, ?, ?, ?)',
            [channelId, serverId, 'общий', 'text', 'Общий чат', 0]
        );

        await pool.query(
            'INSERT INTO channels (id, server_id, name, type, position) VALUES (?, ?, ?, ?, ?)',
            [voiceChannelId, serverId, 'Голосовой', 'voice', 1]
        );

        console.log(`✓ Создан сервер: ${name}`);

        res.status(201).json({
            server: { id: serverId, name, icon: icon || null, description: description || null, owner_id: req.user.id }
        });
    } catch (error) {
        console.error('Create server error:', error);
        res.status(500).json({ error: true, message: 'Ошибка создания сервера' });
    }
});

app.get('/api/servers/:serverId', authenticate, async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM servers WHERE id = ?', [req.params.serverId]);
    if (!rows.length) return res.status(404).json({ error: true, message: 'Сервер не найден' });
    res.json({ server: rows[0] });
});

app.get('/api/servers/:serverId/members', authenticate, async (req, res) => {
    const [rows] = await pool.query(`
        SELECT u.id, u.username, u.tag, u.avatar, u.status
        FROM users u
        JOIN server_members sm ON u.id = sm.user_id
        WHERE sm.server_id = ?
    `, [req.params.serverId]);
    res.json({ members: rows });
});

app.delete('/api/servers/:serverId', authenticate, async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM servers WHERE id = ?', [req.params.serverId]);
    if (!rows.length) return res.status(404).json({ error: true, message: 'Сервер не найден' });
    if (rows[0].owner_id !== req.user.id) return res.status(403).json({ error: true, message: 'Нет прав' });
    
    await pool.query('DELETE FROM servers WHERE id = ?', [req.params.serverId]);
    res.json({ success: true });
});


// ============ CHANNELS ROUTES ============
app.get('/api/channels/server/:serverId', authenticate, async (req, res) => {
    const [channels] = await pool.query('SELECT * FROM channels WHERE server_id = ? ORDER BY position', [req.params.serverId]);
    res.json({ channels, categories: [] });
});

app.post('/api/channels/server/:serverId', authenticate, async (req, res) => {
    const { name, type = 'text', topic } = req.body;
    
    const [servers] = await pool.query('SELECT * FROM servers WHERE id = ?', [req.params.serverId]);
    if (!servers.length) return res.status(404).json({ error: true, message: 'Сервер не найден' });
    if (servers[0].owner_id !== req.user.id) return res.status(403).json({ error: true, message: 'Нет прав' });

    const channelId = uuidv4();
    const [countResult] = await pool.query('SELECT COUNT(*) as cnt FROM channels WHERE server_id = ?', [req.params.serverId]);
    
    await pool.query(
        'INSERT INTO channels (id, server_id, name, type, topic, position) VALUES (?, ?, ?, ?, ?, ?)',
        [channelId, req.params.serverId, name, type, topic || null, countResult[0].cnt]
    );

    res.status(201).json({ channel: { id: channelId, server_id: req.params.serverId, name, type, topic } });
});

app.get('/api/channels/:channelId', authenticate, async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM channels WHERE id = ?', [req.params.channelId]);
    if (!rows.length) return res.status(404).json({ error: true, message: 'Канал не найден' });
    res.json({ channel: rows[0] });
});

app.delete('/api/channels/:channelId', authenticate, async (req, res) => {
    const [channels] = await pool.query('SELECT * FROM channels WHERE id = ?', [req.params.channelId]);
    if (!channels.length) return res.status(404).json({ error: true, message: 'Канал не найден' });
    
    const [servers] = await pool.query('SELECT * FROM servers WHERE id = ?', [channels[0].server_id]);
    if (servers[0]?.owner_id !== req.user.id) return res.status(403).json({ error: true, message: 'Нет прав' });

    await pool.query('DELETE FROM channels WHERE id = ?', [req.params.channelId]);
    res.json({ success: true });
});

// ============ MESSAGES ROUTES ============
app.get('/api/messages/channel/:channelId', authenticate, async (req, res) => {
    const [channels] = await pool.query('SELECT * FROM channels WHERE id = ?', [req.params.channelId]);
    if (!channels.length) return res.status(404).json({ error: true, message: 'Канал не найден' });

    const [messages] = await pool.query(`
        SELECT m.*, u.username, u.tag, u.avatar
        FROM messages m
        JOIN users u ON m.author_id = u.id
        WHERE m.channel_id = ?
        ORDER BY m.created_at ASC
        LIMIT 100
    `, [req.params.channelId]);

    const result = messages.map(m => ({
        id: m.id,
        channel_id: m.channel_id,
        author_id: m.author_id,
        content: m.content,
        edited_at: m.edited_at,
        is_pinned: m.is_pinned,
        created_at: m.created_at,
        author: { id: m.author_id, username: m.username, tag: m.tag, avatar: m.avatar },
        reactions: []
    }));

    res.json({ messages: result });
});

app.post('/api/messages/channel/:channelId', authenticate, async (req, res) => {
    const { content } = req.body;
    
    if (!content || content.length === 0) {
        return res.status(400).json({ error: true, message: 'Сообщение не может быть пустым' });
    }

    const [channels] = await pool.query('SELECT * FROM channels WHERE id = ?', [req.params.channelId]);
    if (!channels.length) return res.status(404).json({ error: true, message: 'Канал не найден' });

    const messageId = uuidv4();
    await pool.query(
        'INSERT INTO messages (id, channel_id, author_id, content) VALUES (?, ?, ?, ?)',
        [messageId, req.params.channelId, req.user.id, content]
    );

    // Update server energy
    await pool.query('UPDATE servers SET energy = energy + 1 WHERE id = ?', [channels[0].server_id]);

    const message = {
        id: messageId,
        channel_id: req.params.channelId,
        author_id: req.user.id,
        content,
        created_at: new Date().toISOString(),
        author: { id: req.user.id, username: req.user.username, tag: req.user.tag, avatar: req.user.avatar },
        reactions: []
    };

    broadcastToChannel(req.params.channelId, {
        type: 'message_create',
        payload: { channelId: req.params.channelId, message }
    }, req.user.id);

    res.status(201).json({ message });
});

app.patch('/api/messages/:messageId', authenticate, async (req, res) => {
    const { content } = req.body;
    const [messages] = await pool.query('SELECT * FROM messages WHERE id = ?', [req.params.messageId]);
    
    if (!messages.length) return res.status(404).json({ error: true, message: 'Сообщение не найдено' });
    if (messages[0].author_id !== req.user.id) return res.status(403).json({ error: true, message: 'Нет прав' });

    await pool.query('UPDATE messages SET content = ?, edited_at = NOW() WHERE id = ?', [content, req.params.messageId]);
    res.json({ message: { ...messages[0], content, edited_at: new Date().toISOString() } });
});

app.delete('/api/messages/:messageId', authenticate, async (req, res) => {
    const [messages] = await pool.query('SELECT * FROM messages WHERE id = ?', [req.params.messageId]);
    
    if (!messages.length) return res.status(404).json({ error: true, message: 'Сообщение не найдено' });
    if (messages[0].author_id !== req.user.id) return res.status(403).json({ error: true, message: 'Нет прав' });

    await pool.query('DELETE FROM messages WHERE id = ?', [req.params.messageId]);

    broadcastToChannel(messages[0].channel_id, {
        type: 'message_delete',
        payload: { channelId: messages[0].channel_id, messageId: req.params.messageId }
    });

    res.json({ success: true });
});

app.put('/api/messages/:messageId/reactions/:emoji', authenticate, async (req, res) => {
    const [messages] = await pool.query('SELECT * FROM messages WHERE id = ?', [req.params.messageId]);
    if (!messages.length) return res.status(404).json({ error: true, message: 'Сообщение не найдено' });

    const emoji = decodeURIComponent(req.params.emoji);
    const reactionId = uuidv4();

    try {
        await pool.query(
            'INSERT INTO message_reactions (id, message_id, user_id, emoji) VALUES (?, ?, ?, ?)',
            [reactionId, req.params.messageId, req.user.id, emoji]
        );
    } catch (e) {
        // Reaction already exists, ignore
    }

    res.json({ success: true });
});


// ============ USERS ROUTES ============
app.get('/api/users/:userId', authenticate, async (req, res) => {
    const [rows] = await pool.query('SELECT id, username, tag, avatar, banner, bio, status, created_at FROM users WHERE id = ?', [req.params.userId]);
    if (!rows.length) return res.status(404).json({ error: true, message: 'Пользователь не найден' });
    res.json({ user: rows[0] });
});

app.patch('/api/users/me', authenticate, async (req, res) => {
    const { username, bio, status, avatar } = req.body;
    const updates = [];
    const values = [];

    if (username) { updates.push('username = ?'); values.push(username); }
    if (bio !== undefined) { updates.push('bio = ?'); values.push(bio); }
    if (status) { updates.push('status = ?'); values.push(status); }
    if (avatar !== undefined) { updates.push('avatar = ?'); values.push(avatar); }

    if (updates.length) {
        values.push(req.user.id);
        await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, values);
    }

    const [rows] = await pool.query('SELECT id, username, tag, avatar, bio, status FROM users WHERE id = ?', [req.user.id]);
    res.json({ user: rows[0] });
});

app.get('/api/users/me/friends', authenticate, async (req, res) => {
    const [rows] = await pool.query(`
        SELECT u.id, u.username, u.tag, u.avatar, u.status, f.status as friend_status
        FROM friends f
        JOIN users u ON (f.friend_id = u.id AND f.user_id = ?) OR (f.user_id = u.id AND f.friend_id = ?)
        WHERE (f.user_id = ? OR f.friend_id = ?) AND f.status = 'accepted'
    `, [req.user.id, req.user.id, req.user.id, req.user.id]);
    res.json({ friends: rows });
});

// Search users
app.get('/api/users/search', authenticate, async (req, res) => {
    const { q } = req.query;
    if (!q || q.length < 2) return res.json({ users: [] });

    const query = q.replace('@', '').toLowerCase();
    const [rows] = await pool.query(`
        SELECT id, username, tag, avatar, status
        FROM users
        WHERE id != ? AND (LOWER(username) LIKE ? OR CONCAT(LOWER(username), tag) LIKE ?)
        LIMIT 10
    `, [req.user.id, `%${query}%`, `%${query}%`]);

    res.json({ users: rows });
});

// Find exact user
app.post('/api/users/find', authenticate, async (req, res) => {
    const { username, tag } = req.body;
    if (!username || !tag) return res.status(400).json({ error: true, message: 'Укажите username и tag' });

    const normalizedTag = tag.startsWith('#') ? tag : `#${tag}`;
    const [rows] = await pool.query(
        'SELECT id, username, tag, avatar, status FROM users WHERE LOWER(username) = LOWER(?) AND tag = ?',
        [username, normalizedTag]
    );

    if (!rows.length) return res.status(404).json({ error: true, message: 'Пользователь не найден' });
    res.json({ user: rows[0] });
});

// ============ INVITES ============
app.post('/api/servers/:serverId/invites', authenticate, async (req, res) => {
    const [servers] = await pool.query('SELECT * FROM servers WHERE id = ?', [req.params.serverId]);
    if (!servers.length) return res.status(404).json({ error: true, message: 'Сервер не найден' });

    const inviteId = uuidv4();
    const code = Math.random().toString(36).substring(2, 10).toUpperCase();

    await pool.query(
        'INSERT INTO invites (id, server_id, creator_id, code) VALUES (?, ?, ?, ?)',
        [inviteId, req.params.serverId, req.user.id, code]
    );

    res.json({ invite: { code, server_id: req.params.serverId } });
});

app.post('/api/invites/:code/join', authenticate, async (req, res) => {
    const [invites] = await pool.query('SELECT * FROM invites WHERE code = ?', [req.params.code]);
    if (!invites.length) return res.status(404).json({ error: true, message: 'Приглашение не найдено' });

    const invite = invites[0];
    
    // Check if already member
    const [existing] = await pool.query(
        'SELECT * FROM server_members WHERE server_id = ? AND user_id = ?',
        [invite.server_id, req.user.id]
    );
    if (existing.length) return res.status(400).json({ error: true, message: 'Вы уже на этом сервере' });

    const memberId = uuidv4();
    await pool.query(
        'INSERT INTO server_members (id, server_id, user_id) VALUES (?, ?, ?)',
        [memberId, invite.server_id, req.user.id]
    );

    await pool.query('UPDATE invites SET uses = uses + 1 WHERE id = ?', [invite.id]);

    const [servers] = await pool.query('SELECT * FROM servers WHERE id = ?', [invite.server_id]);
    res.json({ server: servers[0] });
});

// ============ WEBSOCKET ============
const wsClients = new Map();
const channelSubscriptions = new Map();

function broadcastToChannel(channelId, message, excludeUserId = null) {
    const subscribers = channelSubscriptions.get(channelId);
    if (!subscribers) return;

    const data = JSON.stringify(message);
    subscribers.forEach(userId => {
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

wss.on('connection', (ws) => {
    let userId = null;

    ws.on('message', async (data) => {
        try {
            const { type, payload } = JSON.parse(data);

            switch (type) {
                case 'authenticate':
                    try {
                        const decoded = jwt.verify(payload.token, JWT_SECRET);
                        userId = decoded.userId;
                        
                        if (!wsClients.has(userId)) wsClients.set(userId, new Set());
                        wsClients.get(userId).add(ws);

                        await pool.query('UPDATE users SET status = ? WHERE id = ?', ['online', userId]);
                        ws.send(JSON.stringify({ type: 'authenticated', payload: { userId } }));
                        console.log(`⚡ WebSocket: ${userId} подключён`);
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
                    }
                    break;

                case 'heartbeat':
                    ws.send(JSON.stringify({ type: 'heartbeat_ack', payload: { timestamp: Date.now() } }));
                    break;
            }
        } catch (e) {
            console.error('WS error:', e);
        }
    });

    ws.on('close', async () => {
        if (userId) {
            const clients = wsClients.get(userId);
            if (clients) {
                clients.delete(ws);
                if (clients.size === 0) {
                    wsClients.delete(userId);
                    await pool.query('UPDATE users SET status = ? WHERE id = ?', ['offline', userId]);
                }
            }
            channelSubscriptions.forEach(subscribers => subscribers.delete(userId));
        }
    });
});

// ============ HEALTH & STATIC ============
app.get('/api/health', async (req, res) => {
    const [users] = await pool.query('SELECT COUNT(*) as count FROM users');
    const [servers] = await pool.query('SELECT COUNT(*) as count FROM servers');
    res.json({ status: 'ok', database: 'mysql', users: users[0].count, servers: servers[0].count });
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ============ START SERVER ============
async function start() {
    const connected = await testConnection();
    if (!connected) {
        console.error('Не удалось подключиться к MySQL. Проверьте настройки.');
        process.exit(1);
    }

    await initDatabase();

    server.listen(PORT, () => {
        console.log('');
        console.log('  ⚡ Flash Server (MySQL)');
        console.log('  ────────────────────────────────');
        console.log(`  🌐 http://localhost:${PORT}`);
        console.log(`  🔌 WebSocket: ws://localhost:${PORT}`);
        console.log('  ────────────────────────────────');
        console.log('  Готов к работе!');
        console.log('');
    });
}

start();
