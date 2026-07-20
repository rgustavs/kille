/**
 * Kille — Grupp-operationer mot den centrala databasen.
 *
 * `Groups` innehåller login/admin-operationer som anropas direkt från UI.
 * `Outbox` är en enkel utgående kö som gör grupp-läget offline-tåligt: varje
 * ändring läggs först i en kö i localStorage och skickas sedan till servern.
 * Misslyckas nätverket ligger ändringen kvar och skickas nästa gång appen är
 * online (vid uppstart, efter en lyckad pull eller efter nästa ändring).
 */
import { rpc } from './supabase.js';
import { Session } from './session.js';

// ─── Login & admin ────────────────────────────────────────────────────────────

export const Groups = {
  create(name, adminCode, memberName, slug) {
    return rpc('kille_create_group', {
      p_name: name, p_admin_code: adminCode, p_member_name: memberName || null, p_slug: slug || null
    });
  },

  join(joinCode, memberName) {
    return rpc('kille_join_group', {
      p_join_code: joinCode, p_member_name: memberName || null
    });
  },

  getBySlug(slug, memberName) {
    return rpc('kille_get_group_by_slug', {
      p_slug: slug, p_member_name: memberName || null
    });
  },

  pull() {
    const g = Session.group;
    return rpc('kille_pull', { p_group_id: g.id, p_join_code: g.joinCode });
  },

  verifyAdmin(adminCode) {
    const g = Session.group;
    return rpc('kille_verify_admin', {
      p_group_id: g.id, p_join_code: g.joinCode, p_admin_code: adminCode
    });
  },

  rename(adminCode, name) {
    const g = Session.group;
    return rpc('kille_admin_rename_group', {
      p_group_id: g.id, p_join_code: g.joinCode, p_admin_code: adminCode, p_name: name
    });
  },

  removeMember(adminCode, memberId) {
    const g = Session.group;
    return rpc('kille_admin_remove_member', {
      p_group_id: g.id, p_join_code: g.joinCode, p_admin_code: adminCode, p_member_id: memberId
    });
  },

  setMemberRole(adminCode, memberId, role) {
    const g = Session.group;
    return rpc('kille_admin_set_member_role', {
      p_group_id: g.id, p_join_code: g.joinCode, p_admin_code: adminCode,
      p_member_id: memberId, p_role: role
    });
  },

  setAdminCode(adminCode, newCode) {
    const g = Session.group;
    return rpc('kille_admin_set_code', {
      p_group_id: g.id, p_join_code: g.joinCode, p_admin_code: adminCode, p_new_admin_code: newCode
    });
  },

  regenerateJoinCode(adminCode) {
    const g = Session.group;
    return rpc('kille_admin_regenerate_join_code', {
      p_group_id: g.id, p_join_code: g.joinCode, p_admin_code: adminCode
    });
  },

  deleteGroup(adminCode) {
    const g = Session.group;
    return rpc('kille_admin_delete_group', {
      p_group_id: g.id, p_join_code: g.joinCode, p_admin_code: adminCode
    });
  },

  leave() {
    const g = Session.group;
    if (!g || !Session.memberId) return Promise.resolve({ ok: true });
    return rpc('kille_leave_group', {
      p_group_id: g.id, p_join_code: g.joinCode, p_member_id: Session.memberId
    });
  }
};

// ─── Super-admin (global inloggning med användarnamn + lösenord) ───────────────

export const SuperAdmin = {
  exists() {
    return rpc('kille_sa_exists');
  },
  bootstrap(username, password) {
    return rpc('kille_sa_bootstrap', { p_username: username, p_password: password });
  },
  login(username, password) {
    return rpc('kille_sa_login', { p_username: username, p_password: password });
  },
  addAdmin(cred, newUsername, newPassword) {
    return rpc('kille_sa_add_admin', {
      p_username: cred.username, p_password: cred.password,
      p_new_username: newUsername, p_new_password: newPassword
    });
  },
  listGroups(cred) {
    return rpc('kille_sa_list_groups', { p_username: cred.username, p_password: cred.password });
  },
  createGroup(cred, name, adminCode, slug) {
    return rpc('kille_sa_create_group', {
      p_username: cred.username, p_password: cred.password,
      p_name: name, p_admin_code: adminCode, p_slug: slug || null
    });
  },
  renameGroup(cred, groupId, name) {
    return rpc('kille_sa_rename_group', {
      p_username: cred.username, p_password: cred.password, p_group_id: groupId, p_name: name
    });
  },
  setSlug(cred, groupId, slug) {
    return rpc('kille_sa_set_slug', {
      p_username: cred.username, p_password: cred.password, p_group_id: groupId, p_slug: slug
    });
  },
  regenCode(cred, groupId) {
    return rpc('kille_sa_regen_code', {
      p_username: cred.username, p_password: cred.password, p_group_id: groupId
    });
  },
  deleteGroup(cred, groupId) {
    return rpc('kille_sa_delete_group', {
      p_username: cred.username, p_password: cred.password, p_group_id: groupId
    });
  },
  listUsers(cred, groupId) {
    return rpc('kille_sa_list_users', {
      p_username: cred.username, p_password: cred.password, p_group_id: groupId
    });
  },
  removeMember(cred, groupId, memberId) {
    return rpc('kille_sa_remove_member', {
      p_username: cred.username, p_password: cred.password, p_group_id: groupId, p_member_id: memberId
    });
  },
  removePlayer(cred, groupId, playerId) {
    return rpc('kille_sa_remove_player', {
      p_username: cred.username, p_password: cred.password, p_group_id: groupId, p_player_id: playerId
    });
  }
};

// ─── Utgående synk-kö (offline-tålig) ──────────────────────────────────────────

let flushing = false;
let syncStatusHandler = null;

/** Registrera en callback som får synkstatus: 'syncing' | 'synced' | 'error'. */
export function onSyncStatus(fn) {
  syncStatusHandler = fn;
}

function emit(status, detail) {
  if (syncStatusHandler) syncStatusHandler(status, detail);
}

function outboxKey() {
  const g = Session.group;
  return g ? `kille_g_${g.id}_outbox` : null;
}

function readOutbox() {
  const key = outboxKey();
  if (!key || typeof localStorage === 'undefined') return [];
  try {
    const v = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function writeOutbox(ops) {
  const key = outboxKey();
  if (!key || typeof localStorage === 'undefined') return;
  localStorage.setItem(key, JSON.stringify(ops));
}

function sendOp(op) {
  const g = Session.group;
  const base = { p_group_id: g.id, p_join_code: g.joinCode };
  switch (op.type) {
    case 'savePlayer':
      return rpc('kille_save_player', { ...base, p_id: op.id, p_name: op.name });
    case 'deletePlayer':
      return rpc('kille_delete_player', { ...base, p_id: op.id });
    case 'saveGame':
      return rpc('kille_save_game', { ...base, p_game: op.game });
    case 'deleteGame':
      return rpc('kille_delete_game', { ...base, p_id: op.id });
    default:
      return Promise.resolve();
  }
}

export const Outbox = {
  /** Antal ännu ej skickade ändringar. */
  pending() {
    return readOutbox().length;
  },

  /**
   * Lägg en operation i kön. Nya spara-operationer för samma entitet ersätter
   * äldre för att hålla kön kort.
   */
  enqueue(op) {
    if (!Session.isGroup()) return;
    const ops = readOutbox();
    if (op.type === 'savePlayer' || op.type === 'saveGame') {
      const entId = op.id || op.game?.id;
      const idx = ops.findIndex(o => o.type === op.type && (o.id || o.game?.id) === entId);
      if (idx >= 0) ops.splice(idx, 1);
    }
    ops.push(op);
    writeOutbox(ops);
    this.flush();
  },

  /** Skicka alla köade operationer i ordning. */
  async flush() {
    if (flushing || !Session.isGroup()) return;
    let ops = readOutbox();
    if (ops.length === 0) return;
    flushing = true;
    emit('syncing', ops.length);
    try {
      while (ops.length > 0) {
        await sendOp(ops[0]);
        ops = readOutbox();
        ops.shift();
        writeOutbox(ops);
      }
      emit('synced');
    } catch (err) {
      emit('error', err);
    } finally {
      flushing = false;
    }
  }
};
