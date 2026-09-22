/**
 * Authentication & Authorization Middleware for Hotel City Park CRM
 * 
 * Provides:
 * - JWT token generation and verification
 * - bcrypt password hashing and comparison
 * - Role-based access control middleware
 * - Transparent migration of plaintext passwords to bcrypt hashes
 */
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

// JWT secret: use environment variable in production, fallback for dev
const JWT_SECRET = process.env.JWT_SECRET || 'hcp_jwt_secret_2026_city_park_crm_' + require('os').hostname();
const JWT_EXPIRY = '30d'; // 30-day sessions; force re-login monthly
const BCRYPT_ROUNDS = 10;

// ---------- Password Hashing ----------

/**
 * Hash a plaintext password using bcrypt.
 * @param {string} plaintext
 * @returns {Promise<string>} bcrypt hash
 */
async function hashPassword(plaintext) {
  return bcrypt.hash(plaintext, BCRYPT_ROUNDS);
}

/**
 * Synchronous hash for use inside SQLite transactions.
 * @param {string} plaintext
 * @returns {string} bcrypt hash
 */
function hashPasswordSync(plaintext) {
  return bcrypt.hashSync(plaintext, BCRYPT_ROUNDS);
}

/**
 * Compare a plaintext password against a stored hash.
 * Also handles transparent migration from plaintext to bcrypt.
 * 
 * @param {string} plaintext - The password the user typed
 * @param {string} storedPassword - The value from the database (could be plaintext or bcrypt hash)
 * @param {object} db - Database instance for migration
 * @param {number} userId - User ID for migration update
 * @returns {Promise<boolean>} true if password matches
 */
async function verifyPassword(plaintext, storedPassword, db, userId) {
  // Check if stored password is already a bcrypt hash
  const isBcryptHash = storedPassword && storedPassword.startsWith('$2');
  
  if (isBcryptHash) {
    // Standard bcrypt comparison
    return bcrypt.compare(plaintext, storedPassword);
  }
  
  // Legacy plaintext comparison + transparent migration
  if (plaintext.trim() === storedPassword.trim()) {
    // Password matches — migrate to bcrypt hash transparently
    try {
      const hashed = hashPasswordSync(plaintext.trim());
      db.prepare('UPDATE staff_users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(hashed, userId);
    } catch (e) {
      // Migration failure is non-fatal — login still succeeds
      console.warn('Password migration warning for user ' + userId + ':', e.message);
    }
    return true;
  }
  
  return false;
}

// ---------- JWT Token Management ----------

/**
 * Generate a JWT token for an authenticated user.
 * @param {object} user - User object with id, username, role, full_name
 * @returns {string} JWT token
 */
function generateToken(user) {
  const canAccessManager = Boolean(user.can_access_manager == 1 || user.role === 'manager');
  return jwt.sign(
    {
      id: user.id,
      username: user.username,
      role: user.role,
      full_name: user.full_name,
      can_access_manager: canAccessManager
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

/**
 * Verify and decode a JWT token.
 * @param {string} token
 * @returns {object|null} Decoded payload or null if invalid
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

// ---------- Express Middleware ----------

/**
 * Authentication middleware — verifies JWT token from Authorization header.
 * Attaches decoded user to req.user if valid.
 * 
 * Usage: app.get('/api/protected', requireAuth, handler)
 */
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ 
      success: false, 
      error: 'Authentication required. Please log in.' 
    });
  }
  
  const token = authHeader.substring(7);
  const decoded = verifyToken(token);
  
  if (!decoded) {
    return res.status(401).json({ 
      success: false, 
      error: 'Invalid or expired session. Please log in again.' 
    });
  }
  
  req.user = decoded;
  if (decoded && decoded.id) {
    try {
      const db = require('../database');
      const liveUser = db.prepare('SELECT role, can_access_manager, status FROM staff_users WHERE id = ?').get(decoded.id);
      if (liveUser) {
        // Block deactivated users
        if (liveUser.status === 'inactive' || liveUser.status === 'disabled') {
          return res.status(401).json({ 
            success: false, 
            error: 'Your account has been deactivated. Please contact the manager.' 
          });
        }
        req.user.dbRole = liveUser.role;
        if (liveUser.role === 'manager' || liveUser.can_access_manager == 1) {
          req.user.can_access_manager = true;
        }
      }
    } catch (dbErr) {
      console.warn('[Auth] Live user status check failed:', dbErr.message);
    }
  }
  next();
}

/**
 * Role-based authorization middleware factory.
 * Must be used AFTER requireAuth.
 * 
 * Usage: app.delete('/api/rooms/:id', requireAuth, requireRole('manager'), handler)
 * 
 * @param {...string} allowedRoles - Roles that are permitted (e.g., 'manager', 'hospitality')
 * @returns {Function} Express middleware
 */
function requireRole(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ 
        success: false, 
        error: 'Authentication required.' 
      });
    }
    
    const hasManagerAccess = Boolean(req.user.can_access_manager || req.user.role === 'manager');
    const isAllowed = allowedRoles.includes(req.user.role) || (allowedRoles.includes('manager') && hasManagerAccess);

    if (!isAllowed) {
      return res.status(403).json({ 
        success: false, 
        error: `Access denied. This operation requires one of: ${allowedRoles.join(', ')}` 
      });
    }
    
    next();
  };
}

/**
 * Optional auth middleware — attaches user if token present, but doesn't reject if absent.
 * Useful for endpoints that behave differently for authenticated vs anonymous users.
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const decoded = verifyToken(token);
    if (decoded) {
      req.user = decoded;
    }
  }
  
  next();
}

function migratePlaintextPasswords(db) {
  try {
    const unhashedUsers = db.prepare("SELECT id, password FROM staff_users WHERE password NOT LIKE '$2%'").all();
    if (!unhashedUsers || unhashedUsers.length === 0) return 0;
    
    const updateStmt = db.prepare('UPDATE staff_users SET password = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
    const migrateMany = db.transaction((users) => {
      for (const u of users) {
        if (u.password && !u.password.startsWith('$2')) {
          const hashed = hashPasswordSync(u.password.trim());
          updateStmt.run(hashed, u.id);
        }
      }
    });
    
    migrateMany(unhashedUsers);
    console.log(`[Security] Migrated ${unhashedUsers.length} legacy plaintext password(s) to bcrypt.`);
    return unhashedUsers.length;
  } catch (err) {
    console.warn('[Security] Password migration warning:', err.message);
    return 0;
  }
}

module.exports = {
  hashPassword,
  hashPasswordSync,
  verifyPassword,
  migratePlaintextPasswords,
  generateToken,
  verifyToken,
  requireAuth,
  requireRole,
  optionalAuth,
  BCRYPT_ROUNDS
};
