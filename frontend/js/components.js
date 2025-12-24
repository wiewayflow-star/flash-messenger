/**
 * Flash UI Components
 */
const Components = {
    // Server icon
    serverIcon(server, isActive = false, hasUnread = false, isMuted = false) {
        const initial = Utils.getInitials(server.name);
        const classes = ['server-icon'];
        if (isActive) classes.push('active');
        if (hasUnread) classes.push('has-unread');
        if (isMuted) classes.push('muted');
        
        return `
            <div class="${classes.join(' ')}" data-server="${server.id}" title="${Utils.escapeHtml(server.name)}">
                ${server.icon 
                    ? `<img src="${server.icon}" alt="${Utils.escapeHtml(server.name)}">`
                    : `<span class="server-initial">${initial}</span>`
                }
            </div>
        `;
    },

    // Channel item
    channelItem(channel, isActive = false, voiceUsers = []) {
        const icon = channel.type === 'voice' 
            ? '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5.91-3c-.49 0-.9.36-.98.85C16.52 14.2 14.47 16 12 16s-4.52-1.8-4.93-4.15c-.08-.49-.49-.85-.98-.85-.61 0-1.09.54-1 1.14.49 3 2.89 5.35 5.91 5.78V20c0 .55.45 1 1s1-.45 1-1v-2.08c3.02-.43 5.42-2.78 5.91-5.78.1-.6-.39-1.14-1-1.14z"/></svg>'
            : '<svg viewBox="0 0 24 24" width="20" height="20"><path fill="currentColor" d="M5.88 4.12L13.76 12l-7.88 7.88L8 22l10-10L8 2z"/></svg>';
        
        // Muted indicator
        const mutedIcon = channel.muted ? '<svg class="channel-muted-icon" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>' : '';
        
        // Voice channel timer
        let timerHtml = '';
        if (channel.type === 'voice' && voiceUsers && voiceUsers.length > 0) {
            timerHtml = `<span class="voice-channel-timer" data-channel-timer="${channel.id}">00:00</span>`;
        }
        
        let usersHtml = '';
        if (channel.type === 'voice' && voiceUsers && voiceUsers.length > 0) {
            if (channel.hideNames) {
                // Compact mode - only avatars in a row
                const maxVisible = 5;
                const visibleUsers = voiceUsers.slice(0, maxVisible);
                const remainingCount = voiceUsers.length - maxVisible;
                
                usersHtml = `
                    <div class="voice-channel-users compact">
                        ${visibleUsers.map(user => `
                            <div class="voice-user-avatar-compact ${user.speaking ? 'speaking' : ''}" style="background: ${Utils.getUserColor(user.id)}" title="${Utils.escapeHtml(user.username)}" data-voice-user="${user.id}">
                                ${Utils.getInitials(user.username)}
                            </div>
                        `).join('')}
                        ${remainingCount > 0 ? `
                            <div class="voice-user-avatar-compact more" title="${remainingCount} ещё">
                                +${remainingCount}
                            </div>
                        ` : ''}
                    </div>
                `;
            } else {
                // Normal mode - full user list
                usersHtml = `
                    <div class="voice-channel-users">
                        ${voiceUsers.map(user => `
                            <div class="voice-user ${user.speaking ? 'speaking' : ''}" data-voice-user="${user.id}">
                                <div class="voice-user-avatar" style="background: ${Utils.getUserColor(user.id)}">
                                    ${Utils.getInitials(user.username)}
                                </div>
                                <span class="voice-user-name">${Utils.escapeHtml(user.username)}</span>
                                ${user.muted ? '<svg class="voice-user-icon muted" viewBox="0 0 24 24" width="14" height="14"><path fill="currentColor" d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3L3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/></svg>' : ''}
                            </div>
                        `).join('')}
                    </div>
                `;
            }
        }
        
        return `
            <div class="channel-item ${isActive ? 'active' : ''} ${channel.muted ? 'muted' : ''}" data-channel="${channel.id}" data-type="${channel.type}">
                ${icon}
                <span class="channel-name">${Utils.escapeHtml(channel.name)}</span>
                ${mutedIcon}
                ${timerHtml}
            </div>
            ${usersHtml}
        `;
    },

    // Message (with grouping support)
    message(msg, isGrouped = false) {
        // Check if this is a call ended system message
        if (msg.type === 'call_ended') {
            return this.callEndedMessage(msg);
        }
        
        let content = Utils.parseMarkdown(Utils.escapeHtml(msg.content));
        // Parse mentions (@username, @everyone, @here)
        if (window.App) {
            content = App.parseMentions(content);
        }
        
        const encryptedIcon = msg.encrypted ? '<svg class="encrypted-icon" viewBox="0 0 24 24" width="12" height="12" title="Зашифровано"><path fill="currentColor" d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2z"/></svg>' : '';
        
        // Check if current user is mentioned
        const isMentioned = window.App && App.isUserMentioned(msg.content);
        const mentionedClass = isMentioned ? ' mentioned' : '';
        
        if (isGrouped) {
            // Continuation message - no avatar/name, just content
            return `
                <div class="message message-grouped${mentionedClass}" data-message="${msg.id}">
                    <div class="message-timestamp-hover">${Utils.formatTimeShort(msg.created_at)}</div>
                    <div class="message-content">
                        <div class="message-text">${content}</div>
                        ${msg.reactions?.length ? this.reactions(msg.reactions) : ''}
                    </div>
                </div>
            `;
        }
        
        const initial = Utils.getInitials(msg.author?.username || 'U');
        const time = Utils.formatTime(msg.created_at);
        const authorColor = Utils.getAuthorColor(msg.author_id || msg.author?.id);
        const avatarStyle = msg.author?.avatar 
            ? `background-image: url(${msg.author.avatar}); background-size: cover; background-position: center;`
            : `background: ${authorColor}`;
        const avatarContent = msg.author?.avatar ? '' : initial;
        
        return `
            <div class="message message-first${mentionedClass}" data-message="${msg.id}">
                <div class="message-avatar" style="${avatarStyle}">${avatarContent}</div>
                <div class="message-content">
                    <div class="message-header">
                        <span class="message-author" style="color: ${authorColor}">${Utils.escapeHtml(msg.author?.username || 'Unknown')}</span>
                        ${encryptedIcon}
                        <span class="message-timestamp">${time}</span>
                    </div>
                    <div class="message-text">${content}</div>
                    ${msg.reactions?.length ? this.reactions(msg.reactions) : ''}
                </div>
            </div>
        `;
    },

    // Reactions
    reactions(reactions) {
        return `
            <div class="message-reactions">
                ${reactions.map(r => `
                    <div class="reaction" data-emoji="${r.emoji}">
                        <span>${r.emoji}</span>
                        <span class="reaction-count">${r.count || 1}</span>
                    </div>
                `).join('')}
            </div>
        `;
    },

    // Member item
    memberItem(member) {
        const initial = Utils.getInitials(member.username);
        const avatarStyle = member.avatar 
            ? `background-image: url(${member.avatar}); background-size: cover; background-position: center;`
            : `background: ${Utils.getUserColor(member.id)}`;
        const avatarContent = member.avatar ? '' : initial;
        
        return `
            <div class="member-item" data-user="${member.id}">
                <div class="member-avatar" style="${avatarStyle}">
                    ${avatarContent}
                    <span class="status-dot ${member.status || 'offline'}"></span>
                </div>
                <span class="member-name">${Utils.escapeHtml(member.username)}</span>
            </div>
        `;
    },

    // Search result
    searchResult(user) {
        const initial = Utils.getInitials(user.username);
        const avatarStyle = user.avatar 
            ? `background-image: url(${user.avatar}); background-size: cover;`
            : `background: ${Utils.getUserColor(user.id)}`;
        return `
            <div class="search-result-wrapper" data-user="${user.id}">
                <div class="search-result search-result-item">
                    <div class="search-result-avatar" style="${avatarStyle}">${user.avatar ? '' : initial}</div>
                    <div class="search-result-info">
                        <div class="search-result-name">${Utils.escapeHtml(user.username)}</div>
                        <div class="search-result-tag">${user.tag}</div>
                    </div>
                </div>
            </div>
        `;
    },

    // Empty state
    emptyState(icon, title, description) {
        return `
            <div class="empty-state">
                <div class="empty-icon">${icon}</div>
                <h3>${title}</h3>
                <p>${description}</p>
            </div>
        `;
    },

    // Call ended system message (Discord-style)
    callEndedMessage(msg) {
        const duration = msg.call_duration || 0;
        const durationText = this.formatCallDuration(duration);
        const starterUsername = Utils.escapeHtml(msg.call_starter_username || msg.author?.username || 'Пользователь');
        const starterId = msg.call_starter_id || msg.author_id || msg.author?.id;
        const time = Utils.formatTime(msg.created_at);
        
        return `
            <div class="message message-system call-ended-message" data-message="${msg.id}">
                <div class="call-ended-icon">
                    <svg viewBox="0 0 24 24" width="20" height="20">
                        <path fill="currentColor" d="M20.01 15.38c-1.23 0-2.42-.2-3.53-.56-.35-.12-.74-.03-1.01.24l-1.57 1.97c-2.83-1.35-5.48-3.9-6.89-6.83l1.95-1.66c.27-.28.35-.67.24-1.02-.37-1.11-.56-2.3-.56-3.53 0-.54-.45-.99-.99-.99H4.19C3.65 3 3 3.24 3 3.99 3 13.28 10.73 21 20.01 21c.71 0 .99-.63.99-1.18v-3.45c0-.54-.45-.99-.99-.99z"/>
                    </svg>
                </div>
                <div class="call-ended-content">
                    <span class="call-ended-text">
                        <span class="call-starter-name" data-user-id="${starterId}" onclick="App.showUserProfile('${starterId}')">${starterUsername}</span> начал звонок, который продлился ${durationText}
                    </span>
                    <span class="call-ended-timestamp">${time}</span>
                </div>
            </div>
        `;
    },

    // Format call duration like Discord
    formatCallDuration(durationMs) {
        const totalSeconds = Math.floor(durationMs / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        
        // Less than 1 minute - show seconds
        if (totalSeconds < 60) {
            if (totalSeconds < 5) {
                return 'несколько секунд';
            }
            return `${totalSeconds} ${this.pluralize(totalSeconds, 'секунду', 'секунды', 'секунд')}`;
        }
        
        // 1-59 minutes - show only minutes
        if (hours === 0) {
            return `${minutes} ${this.pluralize(minutes, 'минуту', 'минуты', 'минут')}`;
        }
        
        // 1+ hours - show hours and minutes
        let result = `${hours} ${this.pluralize(hours, 'час', 'часа', 'часов')}`;
        if (minutes > 0) {
            result += ` ${minutes} ${this.pluralize(minutes, 'минуту', 'минуты', 'минут')}`;
        }
        return result;
    },

    // Russian pluralization helper
    pluralize(n, one, few, many) {
        const mod10 = n % 10;
        const mod100 = n % 100;
        
        if (mod100 >= 11 && mod100 <= 19) {
            return many;
        }
        if (mod10 === 1) {
            return one;
        }
        if (mod10 >= 2 && mod10 <= 4) {
            return few;
        }
        return many;
    }
};
