-- Flash Database Schema
-- MySQL 8.0+

CREATE DATABASE IF NOT EXISTS flash CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE flash;

-- Users table
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
) ENGINE=InnoDB;

-- Servers (guilds)
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
    FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_owner (owner_id)
) ENGINE=InnoDB;

-- Server members
CREATE TABLE IF NOT EXISTS server_members (
    id VARCHAR(36) PRIMARY KEY,
    server_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    nickname VARCHAR(32) DEFAULT NULL,
    joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_member (server_id, user_id),
    INDEX idx_server (server_id),
    INDEX idx_user (user_id)
) ENGINE=InnoDB;


-- Roles
CREATE TABLE IF NOT EXISTS roles (
    id VARCHAR(36) PRIMARY KEY,
    server_id VARCHAR(36) NOT NULL,
    name VARCHAR(100) NOT NULL,
    color VARCHAR(7) DEFAULT '#99AAB5',
    position INT DEFAULT 0,
    permissions BIGINT DEFAULT 0,
    is_default BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
    INDEX idx_server (server_id)
) ENGINE=InnoDB;

-- Member roles
CREATE TABLE IF NOT EXISTS member_roles (
    member_id VARCHAR(36) NOT NULL,
    role_id VARCHAR(36) NOT NULL,
    PRIMARY KEY (member_id, role_id),
    FOREIGN KEY (member_id) REFERENCES server_members(id) ON DELETE CASCADE,
    FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Channels
CREATE TABLE IF NOT EXISTS channels (
    id VARCHAR(36) PRIMARY KEY,
    server_id VARCHAR(36) NOT NULL,
    category_id VARCHAR(36) DEFAULT NULL,
    name VARCHAR(100) NOT NULL,
    type ENUM('text', 'voice', 'media', 'system') DEFAULT 'text',
    topic VARCHAR(1024) DEFAULT NULL,
    position INT DEFAULT 0,
    is_nsfw BOOLEAN DEFAULT FALSE,
    slowmode INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
    INDEX idx_server (server_id)
) ENGINE=InnoDB;

-- Messages
CREATE TABLE IF NOT EXISTS messages (
    id VARCHAR(36) PRIMARY KEY,
    channel_id VARCHAR(36) NOT NULL,
    author_id VARCHAR(36) NOT NULL,
    content TEXT NOT NULL,
    reply_to VARCHAR(36) DEFAULT NULL,
    edited_at TIMESTAMP NULL,
    is_pinned BOOLEAN DEFAULT FALSE,
    attachments JSON DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (channel_id) REFERENCES channels(id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_channel (channel_id),
    INDEX idx_author (author_id),
    INDEX idx_created (created_at)
) ENGINE=InnoDB;

-- Message reactions
CREATE TABLE IF NOT EXISTS message_reactions (
    id VARCHAR(36) PRIMARY KEY,
    message_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    emoji VARCHAR(64) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_reaction (message_id, user_id, emoji),
    INDEX idx_message (message_id)
) ENGINE=InnoDB;

-- Friends
CREATE TABLE IF NOT EXISTS friends (
    id VARCHAR(36) PRIMARY KEY,
    user_id VARCHAR(36) NOT NULL,
    friend_id VARCHAR(36) NOT NULL,
    status ENUM('pending', 'accepted', 'blocked') DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (friend_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_friendship (user_id, friend_id),
    INDEX idx_user (user_id),
    INDEX idx_friend (friend_id)
) ENGINE=InnoDB;

-- Direct messages
CREATE TABLE IF NOT EXISTS dm_channels (
    id VARCHAR(36) PRIMARY KEY,
    user1_id VARCHAR(36) NOT NULL,
    user2_id VARCHAR(36) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user1_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (user2_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY unique_dm (user1_id, user2_id)
) ENGINE=InnoDB;

-- DM messages
CREATE TABLE IF NOT EXISTS dm_messages (
    id VARCHAR(36) PRIMARY KEY,
    dm_channel_id VARCHAR(36) NOT NULL,
    author_id VARCHAR(36) NOT NULL,
    content TEXT NOT NULL,
    edited_at TIMESTAMP NULL,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (dm_channel_id) REFERENCES dm_channels(id) ON DELETE CASCADE,
    FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_dm_channel (dm_channel_id)
) ENGINE=InnoDB;

-- Server invites
CREATE TABLE IF NOT EXISTS invites (
    id VARCHAR(36) PRIMARY KEY,
    server_id VARCHAR(36) NOT NULL,
    creator_id VARCHAR(36) NOT NULL,
    code VARCHAR(10) UNIQUE NOT NULL,
    max_uses INT DEFAULT NULL,
    uses INT DEFAULT 0,
    expires_at TIMESTAMP NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
    FOREIGN KEY (creator_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX idx_code (code)
) ENGINE=InnoDB;

-- Audit logs
CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR(36) PRIMARY KEY,
    server_id VARCHAR(36) NOT NULL,
    user_id VARCHAR(36) NOT NULL,
    action VARCHAR(50) NOT NULL,
    target_type VARCHAR(50) DEFAULT NULL,
    target_id VARCHAR(36) DEFAULT NULL,
    changes JSON DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (server_id) REFERENCES servers(id) ON DELETE CASCADE,
    INDEX idx_server (server_id),
    INDEX idx_created (created_at)
) ENGINE=InnoDB;
