/**
 * Flash Utilities
 */
const Utils = {
    // DOM helper - single element
    $(selector) {
        return document.querySelector(selector);
    },

    // DOM helper - multiple elements (returns NodeList with forEach)
    $$(selector) {
        return document.querySelectorAll(selector);
    },

    // Format timestamp
    formatTime(date) {
        const d = new Date(date);
        const now = new Date();
        const diff = now - d;
        
        if (diff < 60000) return 'только что';
        if (diff < 3600000) return `${Math.floor(diff / 60000)} мин. назад`;
        if (diff < 86400000 && d.getDate() === now.getDate()) {
            return `Сегодня в ${d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' })}`;
        }
        return d.toLocaleDateString('ru', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    },

    // Format short time (for grouped messages hover)
    formatTimeShort(date) {
        const d = new Date(date);
        return d.toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
    },

    // Format full date
    formatDate(date) {
        const d = new Date(date);
        return d.toLocaleDateString('ru', { day: 'numeric', month: 'long', year: 'numeric' });
    },

    // Get initials from name
    getInitials(name) {
        return name ? name.charAt(0).toUpperCase() : '?';
    },

    // Escape HTML
    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    },

    // Parse markdown (basic)
    parseMarkdown(text) {
        return text
            .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
            .replace(/\*(.+?)\*/g, '<em>$1</em>')
            .replace(/`(.+?)`/g, '<code>$1</code>')
            .replace(/\n/g, '<br>');
    },

    // Debounce
    debounce(fn, delay) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn(...args), delay);
        };
    },

    // Author color cache for consistent colors
    _authorColors: {},
    
    // Get consistent color for author
    getAuthorColor(authorId) {
        if (!authorId) return '#6d3bd9';
        if (!this._authorColors[authorId]) {
            const colors = ['#6d3bd9', '#43b581', '#faa61a', '#7289da', '#e91e63', '#00bcd4', '#ff9800', '#9c27b0'];
            const hash = authorId.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
            this._authorColors[authorId] = colors[hash % colors.length];
        }
        return this._authorColors[authorId];
    },

    // Check if messages should be grouped (same author, within 5 minutes)
    shouldGroupMessages(prevMsg, currMsg) {
        if (!prevMsg || !currMsg) return false;
        
        // System messages should never be grouped
        if (currMsg.type === 'call_ended' || prevMsg.type === 'call_ended') return false;
        
        const prevAuthor = prevMsg.author_id || prevMsg.author?.id;
        const currAuthor = currMsg.author_id || currMsg.author?.id;
        
        if (prevAuthor !== currAuthor) return false;
        
        const prevTime = new Date(prevMsg.created_at).getTime();
        const currTime = new Date(currMsg.created_at).getTime();
        const fiveMinutes = 5 * 60 * 1000;
        
        return (currTime - prevTime) < fiveMinutes;
    },

    // Generate random color (legacy)
    randomColor() {
        const colors = ['#6d3bd9', '#43b581', '#faa61a', '#f04747', '#7289da', '#e91e63'];
        return colors[Math.floor(Math.random() * colors.length)];
    },
    
    // Get consistent color for user by ID
    getUserColor(userId) {
        return this.getAuthorColor(userId);
    },

    // Local storage helpers
    storage: {
        get(key) {
            try {
                return JSON.parse(localStorage.getItem(key));
            } catch {
                return null;
            }
        },
        set(key, value) {
            localStorage.setItem(key, JSON.stringify(value));
        },
        remove(key) {
            localStorage.removeItem(key);
        }
    }
};
