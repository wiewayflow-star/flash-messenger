/**
 * Flash Server - PostgreSQL Version
 * Persistent database storage
 */
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const http = require('http');
const WebSocket = require('ws');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const crypto = require('crypto');
const { Pool } = require('pg');

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'flash-secret-key';
const DATABASE_URL = process.env.DATABASE_URL;

// PostgreSQL connection
const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
});

// Password hashing
function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
    const [salt, hash] = stored.split(':');
    const verify = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex');
    return hash === verify;
}

// Initialize database tables
async function initDB() {
    const client = await pool.connect();
    try {
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id UUID PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                username VARCHAR(100) NOT NULL,
                password VARCHAR(255) NOT NULL,
                tag VARCHAR(10) NOT NULL,
                avatar TEXT,
                banner TEXT,
                bio TEXT,
                status VARCHAR(20) DEFAULT 'online',
                public_key TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            );
            
            CREATE TABLE IF NOT EXISTS servers (
                id UUID PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                owner_id UUID REFERENCES users(id),
                icon TEXT,
                energy INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT NOW()
            );
            
            CREATE TABLE IF NOT EXISTS server_members (
                id UUID PRIMARY KEY,
                server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
                user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                joined_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(server_id, user_id)
            );
            
            CREATE TABLE IF NOT EXISTS channels (
                id UUID PRIMARY KEY,
                server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
                name VARCHAR(100) NOT NULL,
                type VARCHAR(20) DEFAULT 'text',
                topic TEXT,
                position INT DEFAULT 0
            );
            
            CREATE TABLE IF NOT EXISTS messages (
                id UUID PRIMARY KEY,
                channel_id UUID,
                dm_id UUID,
                author_id UUID REFERENCES users(id),
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT NOW()
            );
            
            CREATE TABLE IF NOT EXISTS friends (
                id UUID PRIMARY KEY,
                user1_id UUID REFERENCES users(id) ON DELETE CASCADE,
                user2_id UUID REFERENCES users(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT NOW()
            );
            
            CREATE TABLE IF NOT EXISTS friend_requests (
                id UUID PRIMARY KEY,
                from_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                to_user_id UUID REFERENCES users(id) ON DELETE CASCADE,
                status VARCHAR(20) DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT NOW()
            );
            
            CREATE TABLE IF NOT EXISTS dm_channels (
                id UUID PRIMARY KEY,
                user1_id UUID REFERENCES users(id) ON DELETE CASCADE,
                user2_id UUID REFERENCES users(id) ON DELETE CASCADE,
                created_at TIMESTAMP DEFAULT NOW()
            );
            
            CREATE TABLE IF NOT EXISTS invites (
                code VARCHAR(20) PRIMARY KEY,
                server_id UUID REFERENCES servers(id) ON DELETE CASCADE,
                creator_id UUID REFERENCES users(id),
                uses INT DEFAULT 0
            );
        `);
        console.log('  ✅ Database tables initialized');
    } finally {
        client.release();
    }
}

// Middleware
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname, '../frontend')));

// Auth middleware
const authenticate = async (req, res, next) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) {
        return res.status(401).json({ error: true, message: 'Требуется авторизация' });
    }
    try {
        const decoded = jwt.verify(auth.split(' ')[1], JWT_SECRET);
        const result = await pool.query('SELECT * FROM users WHERE id = $1', [decoded.userId]);
        if (result.rows.length === 0) {
            return res.status(401).json({ error: true, message: 'Пользователь не найден' });
        }
        req.user = result.rows[0];
        next();
    } catch (e) {
        res.status(401).json({ error: true, message: 'Недействительный токен' });
    }
};

// Generate unique tag
async function generateUniqueTag() {
    for (let i = 1; i <= 9999; i++) {
        const tag = '#' + i.toString().padStart(4, '0');
        const result = await pool.query('SELECT id FROM users WHERE tag = $1', [tag]);
        if (result.rows.length === 0) return tag;
    }
    return '#' + Math.floor(Math.random() * 10000).toString().padStart(4, '0');
}

// WebSocket connections
const wsConnections = new Map();
const channelSubscriptions = new Map();

wss.on('connection', (ws) => {
    const connectionId = uuidv4();
    ws.connectionId = connectionId;
    
    ws.on('message', async (data) => {
        try {
            const msg = JSON.parse(data);
            
            if (msg.type === 'auth') {
                const decoded = jwt.verify(msg.token, JWT_SECRET);
                ws.userId = decoded.userId;
                wsConnections.set(decoded.userId, ws);
                ws.send(JSON.stringify({ type: 'auth_success' }));
            }
            
            if (msg.type === 'subscribe' && msg.channelId) {
                if (!channelSubscriptions.has(msg.channelId)) {
                    channelSubscriptions.set(msg.channelId, new Set());
                }
                channelSubscriptions.get(msg.channelId).add(ws);
            }
            
            if (msg.type === 'unsubscribe' && msg.channelId) {
                channelSubscriptions.get(msg.channelId)?.delete(ws);
            }
        } catch (e) {}
    });
    
    ws.on('close', () => {
        if (ws.userId) wsConnections.delete(ws.userId);
        for (const subs of channelSubscriptions.values()) {
            subs.delete(ws);
        }
    });
});

function notifyUser(userId, data) {
    const ws = wsConnections.get(userId);
    if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(data));
    }
}

function broadcastToChannel(channelId, data, excludeUserId = null) {
    const subs = channelSubscriptions.get(channelId);
    if (subs) {
        for (const ws of subs) {
            if (ws.readyState === WebSocket.OPEN && ws.userId !== excludeUserId) {
                ws.send(JSON.stringify(data));
            }
        }
    }
}


// ============ AUTH ROUTES ============
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, username, password } = req.body;
        if (!email || !username || !password) {
            return res.status(400).json({ error: true, message: 'Все поля обязательны' });
        }
        
        const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
        if (existing.rows.length > 0) {
            return res.status(400).json({ error: true, message: 'Email уже зарегистрирован' });
        }
        
        const userId = uuidv4();
        const tag = await generateUniqueTag();
        const hashedPassword = hashPassword(password);
        
        await pool.query(
            'INSERT INTO users (id, email, username, password, tag) VALUES ($1, $2, $3, $4, $5)',
            [userId, email.toLowerCase(), username, hashedPassword, tag]
        );
        
        const token = jwt.sign({ userId }, JWT_SECRET, { expiresIn: '30d' });
        const user = { id: userId, email: email.toLowerCase(), username, tag, status: 'online' };
        
        res.status(201).json({ user, token });
    } catch (e) {
        console.error('Register error:', e);
        res.status(500).json({ error: true, message: 'Ошибка сервера' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email.toLowerCase()]);
        
        if (result.rows.length === 0 || !verifyPassword(password, result.rows[0].password)) {
            return res.status(401).json({ error: true, message: 'Неверный email или пароль' });
        }
        
        const user = result.rows[0];
        await pool.query('UPDATE users SET status = $1 WHERE id = $2', ['online', user.id]);
        
        const token = jwt.sign({ userId: user.id }, JWT_SECRET, { expiresIn: '30d' });
        
        res.json({
            user: { id: user.id, email: user.email, username: user.username, tag: user.tag, avatar: user.avatar, banner: user.banner, bio: user.bio, status: 'online' },
            token
        });
    } catch (e) {
        console.error('Login error:', e);
        res.status(500).json({ error: true, message: 'Ошибка сервера' });
    }
});

app.post('/api/auth/change-password', authenticate, async (req, res) => {
    try {
        const { currentPassword, newPassword } = req.body;
        const result = await pool.query('SELECT password FROM users WHERE id = $1', [req.user.id]);
        
        if (!verifyPassword(currentPassword, result.rows[0].password)) {
            return res.status(400).json({ error: true, message: 'Неверный текущий пароль' });
        }
        
        const hashedPassword = hashPassword(newPassword);
        await pool.query('UPDATE users SET password = $1 WHERE id = $2', [hashedPassword, req.user.id]);
        
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: true, message: 'Ошибка сервера' });
    }
});

// ============ USER ROUTES ============
app.get('/api/users/me', authenticate, (req, res) => {
    const { password, ...user } = req.user;
    res.json({ user });
});

app.patch('/api/users/me', authenticate, async (req, res) => {
    try {
        const { username, bio, status, avatar, banner } = req.body;
        const updates = [];
        const values = [];
        let idx = 1;
        
        if (username) { updates.push(`username = $${idx++}`); values.push(username); }
        if (bio !== undefined) { updates.push(`bio = $${idx++}`); values.push(bio); }
        if (status) { updates.push(`status = $${idx++}`); values.push(status); }
        if (avatar !== undefined) { updates.push(`avatar = $${idx++}`); values.push(avatar); }
        if (banner !== undefined) { updates.push(`banner = $${idx++}`); values.push(banner); }
        
        if (updates.length > 0) {
            values.push(req.user.id);
            await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = $${idx}`, values);
        }
        
        const result = await pool.query('SELECT * FROM users WHERE id = $1', [req.user.id]);
        const { password, ...user } = result.rows[0];
        res.json({ user });
    } catch (e) {
        res.status(500).json({ error: true, message: 'Ошибка сервера' });
    }
});

app.get('/api/users/:userId', authenticate, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, tag, avatar, banner, bio, status, created_at FROM users WHERE id = $1', [req.params.userId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: true, message: 'Пользователь не найден' });
        }
        res.json({ user: result.rows[0] });
    } catch (e) {
        res.status(500).json({ error: true, message: 'Ошибка сервера' });
    }
});

// ВАЖНО: /search должен быть ПЕРЕД /:userId
app.get('/api/users/search', authenticate, async (req, res) => {
    try {
        const { q } = req.query;
        if (!q || q.length < 2) return res.json({ users: [] });
        
        const query = q.toLowerCase().replace('@', '');
        const result = await pool.query(
            `SELECT id, username, tag, avatar, status FROM users 
             WHERE (LOWER(username) LIKE $1 OR LOWER(username || tag) LIKE $1) AND id != $2 LIMIT 20`,
            [`%${query}%`, req.user.id]
        );
        res.json({ users: result.rows });
    } catch (e) {
        console.error('Search error:', e);
        res.status(500).json({ error: true, message: 'Ошибка сервера' });
    }
});

app.get('/api/users/:userId', authenticate, async (req, res) => {
    try {
        const result = await pool.query('SELECT id, username, tag, avatar, banner, bio, status, created_at FROM users WHERE id = $1', [req.params.userId]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: true, message: 'Пользователь не найден' });
        }
        res.json({ user: result.rows[0] });
    } catch (e) {
        res.status(500).json({ error: true, message: 'Ошибка сервера' });
    }
});

app.put('/api/users/me/public-key', authenticate, async (req, res) => {
    try {
        await pool.query('UPDATE users SET public_key = $1 WHERE id = $2', [req.body.publicKey, req.user.id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: true, message: 'Ошибка сервера' });
    }
});

app.get('/api/users/:userId/public-key', authenticate, async (req, res) => {
    try {
        const result = await pool.query('SELECT public_key FROM users WHERE id = $1', [req.params.userId]);
        res.json({ publicKey: result.rows[0]?.public_key || null });
    } catch (e) {
        res.status(500).json({ error: true, message: 'Ошибка сервера' });
    }
});


// ============ SERVERS ROUTES ============
app.get('/api/servers', authenticate, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT s.* FROM servers s
            JOIN server_members sm ON s.id = sm.server_id
            WHERE sm.user_id = $1
        `, [req.user.id]);
        res.json({ servers: result.rows });
    } catch (e) {
        res.status(500).json({ error: true, message: 'Ошибка сервера' });
    }
});

app.post('/api/servers', authenticate, async (req, res) => {
    try {
        const { name } = req.body;
        const serverId = uuidv4();
        const channelId = uuidv4();
        
        await pool.query('INSERT INTO servers (id, name, owner_id) VALUES ($1, $2, $3)', [serverId, name, req.user.id]);
        await pool.query('INSERT INTO server_members (id, server_id, user_id) VALUES ($1, $2, $3)', [uuidv4(), serverId, req.user.id]);
        await pool.query('INSERT INTO channels (id, server_id, name, type) VALUES ($1, $2, $3, $4)', [channelId, serverId, 'общий', 'text']);
        
        const result = await pool.query('SELECT * FROM servers WHERE id = $1', [serverId]);
        res.status(201).json({ server: result.rows[0] });
    } catch (e) {
        res.status(500).json({ error: true, message: 'Ошибка сервера' });
    }
});

app.get('/api/servers/:serverId/members', authenticate, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT u.id, u.username, u.tag, u.avatar, u.status FROM users u
            JOIN server_members sm ON u.id = sm.user_id
            WHERE sm.server_id = $1
        `, [req.params.serverId]);
        res.json({ members: result.rows });
    } catch (e) {
        res.status(500).json({ error: true, message: 'Ошибка сервера' });
    }
});

// ============ CHANNELS ROUTES ============
app.get('/api/channels/server/:serverId', authenticate, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM channels WHERE server_id = $1 ORDER BY position', [req.params.serverId]);
        res.json({ channels: result.rows });
    } catch (e) {
        res.status(500).json({ error: true, message: 'Ошибка сервера' });
    }
});

app.post('/api/channels/server/:serverId', authenticate, async (req, res) => {
    try {
        const { name, type } = req.body;
        const channelId = uuidv4();
        await pool.query('INSERT INTO channels (id, server_id, name, type) VALUES ($1, $2, $3, $4)', [channelId, req.params.serverId, name, type || 'text']);
        const result = await pool.query('SELECT * FROM channels WHERE id = $1', [channelId]);
        res.status(201).json({ channel: result.rows[0] });
    } catch (e) {
        res.status(500).json({ error: true, message: 'Ошибка сервера' });
    }
});

// ============ MESSAGES ROUTES ============
app.get('/api/messages/channel/:channelId', authenticate, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT m.*, u.id as author_id, u.username, u.tag, u.avatar
            FROM messages m
            JOIN users u ON m.author_id = u.id
            WHERE m.channel_id = $1
            ORDER BY m.created_at ASC
            LIMIT 100
        `, [req.params.channelId]);
        
        const messages = result.rows.map(m => ({
            id: m.id,
            channel_id: m.channel_id,
            content: m.content,
            created_at: m.created_at,
            author: { id: m.author_id, username: m.username, tag: m.tag, avatar: m.avatar }
        }));
        
        res.json({ messages });
    } catch (e) {
        res.status(500).json({ error: true, message: 'Ошибка сервера' });
    }
});

app.post('/api/messages/channel/:channelId', authenticate, async (req, res) => {
    try {
        const { content } = req.body;
        const messageId = uuidv4();
        
        await pool.query(
            'INSERT INTO messages (id, channel_id, author_id, content) VALUES ($1, $2, $3, $4)',
            [messageId, req.params.channelId, req.user.id, content]
        );
        
        const message = {
            id: messageId,
            channel_id: req.params.channelId,
            content,
            created_at: new Date().toISOString(),
            author: { id: req.user.id, username: req.user.username, tag: req.user.tag, avatar: req.user.avatar }
        };
        
        broadcastToChannel(req.params.channelId, { type: 'message_create', payload: { channelId: req.params.channelId, message } }, req.user.id);
        res.status(201).json({ message });
    } catch (e) {
        res.status(500).json({ error: true, message: 'Ошибка сервера' });
    }
});

// ============ FRIENDS ROUTES ============
app.post('/api/friends/request/:userId', authenticate, async (req, res) => {
    try {
        const targetId = req.params.userId;
        
        // Check if already friends
        const friendCheck = await pool.query(
            'SELECT id FROM friends WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)',
            [req.user.id, targetId]
        );
        if (friendCheck.rows.length > 0) {
            return res.status(400).json({ error: true, message: 'Уже в друзьях' });
        }
        
        // Check existing request
        const requestCheck = await pool.query(
            'SELECT id FROM friend_requests WHERE from_user_id = $1 AND to_user_id = $2 AND status = $3',
            [req.user.id, targetId, 'pending']
        );
        if (requestCheck.rows.length > 0) {
            return res.status(400).json({ error: true, message: 'Запрос уже отправлен' });
        }
        
        const requestId = uuidv4();
        await pool.query(
            'INSERT INTO friend_requests (id, from_user_id, to_user_id) VALUES ($1, $2, $3)',
            [requestId, req.user.id, targetId]
        );
        
        notifyUser(targetId, {
            type: 'friend_request',
            payload: { request: { id: requestId, user: { id: req.user.id, username: req.user.username, tag: req.user.tag } } }
        });
        
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: true, message: 'Ошибка сервера' });
    }
});

app.get('/api/friends/requests', authenticate, async (req, res) => {
    try {
        const incoming = await pool.query(`
            SELECT fr.id, u.id as user_id, u.username, u.tag, u.avatar
            FROM friend_requests fr
            JOIN users u ON fr.from_user_id = u.id
            WHERE fr.to_user_id = $1 AND fr.status = 'pending'
        `, [req.user.id]);
        
        const outgoing = await pool.query(`
            SELECT fr.id, u.id as user_id, u.username, u.tag, u.avatar
            FROM friend_requests fr
            JOIN users u ON fr.to_user_id = u.id
            WHERE fr.from_user_id = $1 AND fr.status = 'pending'
        `, [req.user.id]);
        
        res.json({
            incoming: incoming.rows.map(r => ({ id: r.id, user: { id: r.user_id, username: r.username, tag: r.tag, avatar: r.avatar } })),
            outgoing: outgoing.rows.map(r => ({ id: r.id, user: { id: r.user_id, username: r.username, tag: r.tag, avatar: r.avatar } }))
        });
    } catch (e) {
        res.status(500).json({ error: true, message: 'Ошибка сервера' });
    }
});

app.post('/api/friends/requests/:requestId/accept', authenticate, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM friend_requests WHERE id = $1 AND to_user_id = $2', [req.params.requestId, req.user.id]);
        if (result.rows.length === 0) {
            return res.status(404).json({ error: true, message: 'Запрос не найден' });
        }
        
        const request = result.rows[0];
        await pool.query('UPDATE friend_requests SET status = $1 WHERE id = $2', ['accepted', req.params.requestId]);
        await pool.query('INSERT INTO friends (id, user1_id, user2_id) VALUES ($1, $2, $3)', [uuidv4(), request.from_user_id, request.to_user_id]);
        
        notifyUser(request.from_user_id, {
            type: 'friend_request_accepted',
            payload: { user: { id: req.user.id, username: req.user.username } }
        });
        
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: true, message: 'Ошибка сервера' });
    }
});

app.post('/api/friends/requests/:requestId/reject', authenticate, async (req, res) => {
    try {
        await pool.query('UPDATE friend_requests SET status = $1 WHERE id = $2 AND to_user_id = $3', ['rejected', req.params.requestId, req.user.id]);
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: true, message: 'Ошибка сервера' });
    }
});

app.get('/api/users/me/friends', authenticate, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT u.id, u.username, u.tag, u.avatar, u.status FROM users u
            JOIN friends f ON (f.user1_id = u.id OR f.user2_id = u.id)
            WHERE (f.user1_id = $1 OR f.user2_id = $1) AND u.id != $1
        `, [req.user.id]);
        res.json({ friends: result.rows });
    } catch (e) {
        res.status(500).json({ error: true, message: 'Ошибка сервера' });
    }
});

app.delete('/api/friends/:userId', authenticate, async (req, res) => {
    try {
        await pool.query(
            'DELETE FROM friends WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)',
            [req.user.id, req.params.userId]
        );
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: true, message: 'Ошибка сервера' });
    }
});

// ============ DM CHANNELS ============
app.post('/api/dm/create/:userId', authenticate, async (req, res) => {
    try {
        const targetUserId = req.params.userId;
        
        const targetCheck = await pool.query('SELECT id FROM users WHERE id = $1', [targetUserId]);
        if (targetCheck.rows.length === 0) {
            return res.status(404).json({ error: true, message: 'Пользователь не найден' });
        }
        
        if (targetUserId === req.user.id) {
            return res.status(400).json({ error: true, message: 'Нельзя создать DM с самим собой' });
        }
        
        const existing = await pool.query(
            'SELECT * FROM dm_channels WHERE (user1_id = $1 AND user2_id = $2) OR (user1_id = $2 AND user2_id = $1)',
            [req.user.id, targetUserId]
        );
        
        if (existing.rows.length > 0) {
            return res.json({ dmChannel: existing.rows[0] });
        }
        
        const dmId = uuidv4();
        await pool.query('INSERT INTO dm_channels (id, user1_id, user2_id) VALUES ($1, $2, $3)', [dmId, req.user.id, targetUserId]);
        
        res.status(201).json({ dmChannel: { id: dmId, user1_id: req.user.id, user2_id: targetUserId, created_at: new Date().toISOString() } });
    } catch (e) {
        res.status(500).json({ error: true, message: 'Ошибка сервера' });
    }
});

app.get('/api/dm/:dmId', authenticate, async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM dm_channels WHERE id = $1', [req.params.dmId]);
        if (result.rows.length === 0) return res.status(404).json({ error: true, message: 'DM канал не найден' });
        
        const dm = result.rows[0];
        if (dm.user1_id !== req.user.id && dm.user2_id !== req.user.id) {
            return res.status(403).json({ error: true, message: 'Нет доступа' });
        }
        
        const otherUserId = dm.user1_id === req.user.id ? dm.user2_id : dm.user1_id;
        const otherUser = await pool.query('SELECT id, username, tag, avatar, status FROM users WHERE id = $1', [otherUserId]);
        
        res.json({ dmChannel: dm, otherUser: otherUser.rows[0] || null });
    } catch (e) {
        res.status(500).json({ error: true, message: 'Ошибка сервера' });
    }
});

app.get('/api/dm/:dmId/messages', authenticate, async (req, res) => {
    try {
        const dmCheck = await pool.query('SELECT * FROM dm_channels WHERE id = $1', [req.params.dmId]);
        if (dmCheck.rows.length === 0) return res.status(404).json({ error: true, message: 'DM канал не найден' });
        
        const dm = dmCheck.rows[0];
        if (dm.user1_id !== req.user.id && dm.user2_id !== req.user.id) {
            return res.status(403).json({ error: true, message: 'Нет доступа' });
        }
        
        const result = await pool.query(`
            SELECT m.*, u.username, u.tag, u.avatar FROM messages m
            JOIN users u ON m.author_id = u.id WHERE m.dm_id = $1 ORDER BY m.created_at ASC LIMIT 100
        `, [req.params.dmId]);
        
        const messages = result.rows.map(m => ({
            id: m.id, dm_id: m.dm_id, content: m.content, created_at: m.created_at,
            author: { id: m.author_id, username: m.username, tag: m.tag, avatar: m.avatar }
        }));
        
        res.json({ messages });
    } catch (e) {
        res.status(500).json({ error: true, message: 'Ошибка сервера' });
    }
});

app.post('/api/dm/:dmId/messages', authenticate, async (req, res) => {
    try {
        const { content } = req.body;
        if (!content) return res.status(400).json({ error: true, message: 'Сообщение не может быть пустым' });
        
        const dmCheck = await pool.query('SELECT * FROM dm_channels WHERE id = $1', [req.params.dmId]);
        if (dmCheck.rows.length === 0) return res.status(404).json({ error: true, message: 'DM канал не найден' });
        
        const dm = dmCheck.rows[0];
        if (dm.user1_id !== req.user.id && dm.user2_id !== req.user.id) {
            return res.status(403).json({ error: true, message: 'Нет доступа' });
        }
        
        const messageId = uuidv4();
        await pool.query('INSERT INTO messages (id, dm_id, author_id, content) VALUES ($1, $2, $3, $4)', [messageId, req.params.dmId, req.user.id, content]);
        
        const message = {
            id: messageId, dm_id: req.params.dmId, content, created_at: new Date().toISOString(),
            author: { id: req.user.id, username: req.user.username, tag: req.user.tag, avatar: req.user.avatar }
        };
        
        const otherUserId = dm.user1_id === req.user.id ? dm.user2_id : dm.user1_id;
        notifyUser(otherUserId, { type: 'dm_message', payload: { dmId: req.params.dmId, message } });
        
        res.status(201).json({ message });
    } catch (e) {
        res.status(500).json({ error: true, message: 'Ошибка сервера' });
    }
});

// ============ INVITES ============
app.post('/api/servers/:serverId/invites', authenticate, async (req, res) => {
    try {
        const serverCheck = await pool.query('SELECT id FROM servers WHERE id = $1', [req.params.serverId]);
        if (serverCheck.rows.length === 0) return res.status(404).json({ error: true, message: 'Сервер не найден' });
        
        const code = Math.random().toString(36).substring(2, 10).toUpperCase();
        await pool.query('INSERT INTO invites (code, server_id, creator_id) VALUES ($1, $2, $3)', [code, req.params.serverId, req.user.id]);
        
        res.json({ invite: { code, server_id: req.params.serverId } });
    } catch (e) {
        res.status(500).json({ error: true, message: 'Ошибка сервера' });
    }
});

app.post('/api/invites/:code/join', authenticate, async (req, res) => {
    try {
        const inviteResult = await pool.query('SELECT * FROM invites WHERE code = $1', [req.params.code]);
        if (inviteResult.rows.length === 0) return res.status(404).json({ error: true, message: 'Приглашение не найдено' });
        
        const invite = inviteResult.rows[0];
        
        const memberCheck = await pool.query('SELECT id FROM server_members WHERE server_id = $1 AND user_id = $2', [invite.server_id, req.user.id]);
        if (memberCheck.rows.length > 0) return res.status(400).json({ error: true, message: 'Вы уже на этом сервере' });
        
        await pool.query('INSERT INTO server_members (id, server_id, user_id) VALUES ($1, $2, $3)', [uuidv4(), invite.server_id, req.user.id]);
        await pool.query('UPDATE invites SET uses = uses + 1 WHERE code = $1', [req.params.code]);
        
        const serverResult = await pool.query('SELECT * FROM servers WHERE id = $1', [invite.server_id]);
        
        notifyServerMembers(invite.server_id, 'server_member_join', {
            serverId: invite.server_id,
            member: { id: req.user.id, username: req.user.username, tag: req.user.tag, avatar: req.user.avatar, status: req.user.status }
        }, req.user.id);
        
        res.json({ server: serverResult.rows[0] });
    } catch (e) {
        res.status(500).json({ error: true, message: 'Ошибка сервера' });
    }
});

// ============ VOICE CHANNEL USERS ============
const voiceChannelUsers = new Map();

app.get('/api/voice/:channelId/users', authenticate, (req, res) => {
    const users = voiceChannelUsers.get(req.params.channelId);
    res.json({ users: users ? Array.from(users.values()) : [] });
});

// ============ HELPER FUNCTIONS ============
async function notifyServerMembers(serverId, type, payload, excludeUserId = null) {
    try {
        const result = await pool.query('SELECT user_id FROM server_members WHERE server_id = $1', [serverId]);
        result.rows.forEach(row => {
            if (row.user_id !== excludeUserId) notifyUser(row.user_id, { type, payload });
        });
    } catch (e) { console.error('notifyServerMembers error:', e); }
}

async function broadcastStatusUpdate(userId, status) {
    try {
        const friendsResult = await pool.query(`
            SELECT CASE WHEN user1_id = $1 THEN user2_id ELSE user1_id END as friend_id
            FROM friends WHERE user1_id = $1 OR user2_id = $1
        `, [userId]);
        friendsResult.rows.forEach(row => notifyUser(row.friend_id, { type: 'user_status_update', payload: { userId, status } }));
        
        const serversResult = await pool.query('SELECT server_id FROM server_members WHERE user_id = $1', [userId]);
        for (const server of serversResult.rows) {
            const membersResult = await pool.query('SELECT user_id FROM server_members WHERE server_id = $1 AND user_id != $2', [server.server_id, userId]);
            membersResult.rows.forEach(row => notifyUser(row.user_id, { type: 'user_status_update', payload: { userId, status } }));
        }
    } catch (e) { console.error('broadcastStatusUpdate error:', e); }
}

function broadcastToVoiceChannel(channelId, message, excludeUserId = null) {
    const users = voiceChannelUsers.get(channelId);
    if (!users) return;
    const data = JSON.stringify(message);
    users.forEach((userData, odUserId) => {
        if (odUserId !== excludeUserId) {
            const ws = wsConnections.get(odUserId);
            if (ws?.readyState === WebSocket.OPEN) ws.send(data);
        }
    });
}

// ============ WEBSOCKET HANDLERS ============
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
                        wsConnections.set(userId, ws);
                        ws.userId = userId;
                        
                        await pool.query('UPDATE users SET status = $1 WHERE id = $2', ['online', userId]);
                        broadcastStatusUpdate(userId, 'online');
                        
                        ws.send(JSON.stringify({ type: 'authenticated', payload: { userId } }));
                        console.log(`⚡ WebSocket: ${userId} подключён`);
                    } catch (e) {
                        ws.send(JSON.stringify({ type: 'error', payload: { message: 'Auth failed' } }));
                    }
                    break;

                case 'subscribe':
                    if (userId && payload.channelId) {
                        if (!channelSubscriptions.has(payload.channelId)) channelSubscriptions.set(payload.channelId, new Set());
                        channelSubscriptions.get(payload.channelId).add(ws);
                    }
                    break;

                case 'unsubscribe':
                    if (userId && payload.channelId) channelSubscriptions.get(payload.channelId)?.delete(ws);
                    break;

                case 'typing':
                    if (userId && payload.channelId) {
                        broadcastToChannel(payload.channelId, { type: 'typing_start', payload: { channelId: payload.channelId, userId } }, userId);
                    }
                    break;

                case 'heartbeat':
                    ws.send(JSON.stringify({ type: 'heartbeat_ack', payload: { timestamp: Date.now() } }));
                    break;

                case 'voice_join':
                    if (userId && payload.channelId) {
                        if (!voiceChannelUsers.has(payload.channelId)) voiceChannelUsers.set(payload.channelId, new Map());
                        const userResult = await pool.query('SELECT username, avatar FROM users WHERE id = $1', [userId]);
                        const user = userResult.rows[0];
                        voiceChannelUsers.get(payload.channelId).set(userId, { id: userId, username: user?.username, avatar: user?.avatar, muted: false, deafened: false });
                        
                        const currentUsers = Array.from(voiceChannelUsers.get(payload.channelId).values());
                        ws.send(JSON.stringify({ type: 'voice_channel_users', payload: { channelId: payload.channelId, users: currentUsers } }));
                        
                        const channelResult = await pool.query('SELECT server_id FROM channels WHERE id = $1', [payload.channelId]);
                        if (channelResult.rows[0]?.server_id) {
                            notifyServerMembers(channelResult.rows[0].server_id, 'voice_user_joined', {
                                channelId: payload.channelId, userId, user: { id: userId, username: user?.username, avatar: user?.avatar }
                            }, null);
                        }
                    }
                    break;

                case 'voice_leave':
                    if (userId && payload.channelId) {
                        const channelUsers = voiceChannelUsers.get(payload.channelId);
                        if (channelUsers) {
                            channelUsers.delete(userId);
                            if (channelUsers.size === 0) voiceChannelUsers.delete(payload.channelId);
                        }
                        
                        const channelResult = await pool.query('SELECT server_id FROM channels WHERE id = $1', [payload.channelId]);
                        if (channelResult.rows[0]?.server_id) {
                            notifyServerMembers(channelResult.rows[0].server_id, 'voice_user_left', { channelId: payload.channelId, userId }, null);
                        }
                    }
                    break;

                case 'voice_offer':
                    if (userId && payload.targetUserId && payload.offer) {
                        notifyUser(payload.targetUserId, { type: 'voice_offer', payload: { fromUserId: userId, offer: payload.offer } });
                    }
                    break;

                case 'voice_answer':
                    if (userId && payload.targetUserId && payload.answer) {
                        notifyUser(payload.targetUserId, { type: 'voice_answer', payload: { fromUserId: userId, answer: payload.answer } });
                    }
                    break;

                case 'voice_ice_candidate':
                    if (userId && payload.targetUserId && payload.candidate) {
                        notifyUser(payload.targetUserId, { type: 'voice_ice_candidate', payload: { fromUserId: userId, candidate: payload.candidate } });
                    }
                    break;

                case 'voice_speaking':
                    if (userId && payload.channelId) {
                        broadcastToVoiceChannel(payload.channelId, { type: 'voice_speaking', payload: { channelId: payload.channelId, userId, speaking: payload.speaking } }, userId);
                    }
                    break;

                case 'voice_mute':
                    if (userId && payload.channelId) {
                        const channelUsers = voiceChannelUsers.get(payload.channelId);
                        if (channelUsers?.has(userId)) channelUsers.get(userId).muted = payload.muted;
                        broadcastToVoiceChannel(payload.channelId, { type: 'voice_muted', payload: { channelId: payload.channelId, userId, muted: payload.muted } }, userId);
                    }
                    break;

                case 'dm_call_start':
                    if (userId && payload.dmId && payload.targetUserId) {
                        const userResult = await pool.query('SELECT username, avatar FROM users WHERE id = $1', [userId]);
                        notifyUser(payload.targetUserId, {
                            type: 'dm_call_incoming',
                            payload: { dmId: payload.dmId, callerId: userId, caller: { id: userId, username: userResult.rows[0]?.username, avatar: userResult.rows[0]?.avatar } }
                        });
                    }
                    break;

                case 'dm_call_accept':
                    if (userId && payload.dmId && payload.callerId) {
                        notifyUser(payload.callerId, { type: 'dm_call_accepted', payload: { dmId: payload.dmId, userId } });
                    }
                    break;

                case 'dm_call_reject':
                    if (userId && payload.dmId && payload.callerId) {
                        notifyUser(payload.callerId, { type: 'dm_call_rejected', payload: { dmId: payload.dmId, userId } });
                    }
                    break;

                case 'dm_call_end':
                    if (userId && payload.dmId) {
                        const dmResult = await pool.query('SELECT * FROM dm_channels WHERE id = $1', [payload.dmId]);
                        if (dmResult.rows[0]) {
                            const dm = dmResult.rows[0];
                            const otherUserId = dm.user1_id === userId ? dm.user2_id : dm.user1_id;
                            notifyUser(otherUserId, { type: 'dm_call_ended', payload: { dmId: payload.dmId, userId } });
                        }
                    }
                    break;

                case 'dm_call_cancel':
                    if (userId && payload.dmId) {
                        let targetUserId = payload.targetUserId;
                        if (!targetUserId) {
                            const dmResult = await pool.query('SELECT * FROM dm_channels WHERE id = $1', [payload.dmId]);
                            if (dmResult.rows[0]) {
                                const dm = dmResult.rows[0];
                                targetUserId = dm.user1_id === userId ? dm.user2_id : dm.user1_id;
                            }
                        }
                        if (targetUserId) notifyUser(targetUserId, { type: 'dm_call_cancelled', payload: { dmId: payload.dmId, callerId: userId } });
                    }
                    break;
            }
        } catch (e) { console.error('WS error:', e); }
    });

    ws.on('close', async () => {
        if (userId) {
            wsConnections.delete(userId);
            await pool.query('UPDATE users SET status = $1 WHERE id = $2', ['offline', userId]);
            broadcastStatusUpdate(userId, 'offline');
            
            for (const [channelId, users] of voiceChannelUsers.entries()) {
                if (users.has(userId)) {
                    users.delete(userId);
                    const channelResult = await pool.query('SELECT server_id FROM channels WHERE id = $1', [channelId]);
                    if (channelResult.rows[0]?.server_id) {
                        notifyServerMembers(channelResult.rows[0].server_id, 'voice_user_left', { channelId, userId }, null);
                    }
                    if (users.size === 0) voiceChannelUsers.delete(channelId);
                }
            }
            
            channelSubscriptions.forEach(subs => subs.delete(ws));
        }
    });
});

// ============ HEALTH & STATIC ============
app.get('/api/health', async (req, res) => {
    try {
        const result = await pool.query('SELECT COUNT(*) as count FROM users');
        res.json({ status: 'ok', database: 'postgresql', users: parseInt(result.rows[0].count) });
    } catch (e) {
        res.json({ status: 'error', database: 'postgresql', error: e.message });
    }
});

app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../frontend/index.html'));
});

// ============ START SERVER ============
(async () => {
    try {
        await initDB();
        console.log('  ✅ PostgreSQL connected');
    } catch (e) {
        console.error('  ❌ Database error:', e.message);
        process.exit(1);
    }

    server.listen(PORT, '0.0.0.0', () => {
        console.log('');
        console.log('  ⚡ Flash Server (PostgreSQL)');
        console.log('  ────────────────────────────────');
        console.log(`  🌐 Port: ${PORT}`);
        console.log('  💾 База данных: PostgreSQL');
        console.log('  ────────────────────────────────');
        console.log('  Готов к работе!');
        console.log('');
    });
})();
