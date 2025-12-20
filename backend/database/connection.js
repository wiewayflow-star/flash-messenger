/**
 * MySQL Database Connection
 */
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'flash123',
    database: process.env.DB_NAME || 'flash',
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4'
});

// Test connection
async function testConnection() {
    try {
        const conn = await pool.getConnection();
        console.log('✓ MySQL подключён');
        conn.release();
        return true;
    } catch (error) {
        console.error('✗ MySQL ошибка:', error.message);
        return false;
    }
}

// Initialize database tables
async function initDatabase() {
    const conn = await pool.getConnection();
    try {
        // Users
        await conn.query(`
            CREATE TABLE IF NOT EXISTS users (
                id VARCHAR(36) PRIMARY KEY,
                email VARCHAR(255) UNIQUE NOT NULL,
                username VARCHAR(32) NOT NULL,
                tag VARCHAR(5) NOT NULL,
                password_hash VARCHAR(255) NOT NULL,
                avatar VARCHAR(500) DEFAULT NULL,
                banner VARCHAR(500) DEFAULT NULL,
                bio TEXT DEFAULT NULL,
                status ENUM('online', 'idle', 'dnd', 'offline') DEFAULT 'offline',
                custom_status VARCHAR(128) DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY unique_username_tag (username, tag),
                INDEX idx_email (email),
                INDEX idx_username (username)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        // Servers
        await conn.query(`
            CREATE TABLE IF NOT EXISTS servers (
                id VARCHAR(36) PRIMARY KEY,
                name VARCHAR(100) NOT NULL,
                icon VARCHAR(500) DEFAULT NULL,
                banner VARCHAR(500) DEFAULT NULL,
                description TEXT DEFAULT NULL,
                owner_id VARCHAR(36) NOT NULL,
                is_public BOOLEAN DEFAULT FALSE,
                energy INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_owner (owner_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        // Server members
        await conn.query(`
            CREATE TABLE IF NOT EXISTS server_members (
                id VARCHAR(36) PRIMARY KEY,
                server_id VARCHAR(36) NOT NULL,
                user_id VARCHAR(36) NOT NULL,
                nickname VARCHAR(32) DEFAULT NULL,
                joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_member (server_id, user_id),
                INDEX idx_server (server_id),
                INDEX idx_user (user_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        // Channels
        await conn.query(`
            CREATE TABLE IF NOT EXISTS channels (
                id VARCHAR(36) PRIMARY KEY,
                server_id VARCHAR(36) NOT NULL,
                name VARCHAR(100) NOT NULL,
                type ENUM('text', 'voice', 'media', 'system') DEFAULT 'text',
                topic VARCHAR(1024) DEFAULT NULL,
                position INT DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_server (server_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        // Messages
        await conn.query(`
            CREATE TABLE IF NOT EXISTS messages (
                id VARCHAR(36) PRIMARY KEY,
                channel_id VARCHAR(36) NOT NULL,
                author_id VARCHAR(36) NOT NULL,
                content TEXT NOT NULL,
                reply_to VARCHAR(36) DEFAULT NULL,
                edited_at TIMESTAMP NULL,
                is_pinned BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_channel (channel_id),
                INDEX idx_author (author_id),
                INDEX idx_created (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        // Message reactions
        await conn.query(`
            CREATE TABLE IF NOT EXISTS message_reactions (
                id VARCHAR(36) PRIMARY KEY,
                message_id VARCHAR(36) NOT NULL,
                user_id VARCHAR(36) NOT NULL,
                emoji VARCHAR(64) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_reaction (message_id, user_id, emoji),
                INDEX idx_message (message_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        // Friends
        await conn.query(`
            CREATE TABLE IF NOT EXISTS friends (
                id VARCHAR(36) PRIMARY KEY,
                user_id VARCHAR(36) NOT NULL,
                friend_id VARCHAR(36) NOT NULL,
                status ENUM('pending', 'accepted', 'blocked') DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_friendship (user_id, friend_id),
                INDEX idx_user (user_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        // Invites
        await conn.query(`
            CREATE TABLE IF NOT EXISTS invites (
                id VARCHAR(36) PRIMARY KEY,
                server_id VARCHAR(36) NOT NULL,
                creator_id VARCHAR(36) NOT NULL,
                code VARCHAR(10) UNIQUE NOT NULL,
                max_uses INT DEFAULT NULL,
                uses INT DEFAULT 0,
                expires_at TIMESTAMP NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_code (code)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
        `);

        console.log('✓ Таблицы инициализированы');
    } finally {
        conn.release();
    }
}

module.exports = { pool, testConnection, initDatabase };
