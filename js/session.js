/**
 * Kille — Session / lägeshantering.
 *
 * Håller reda på om appen körs i "lokalt läge" (allt i localStorage på enheten)
 * eller "grupp-läge" (delad central databas i Supabase). Tillståndet sparas i
 * localStorage så att valet kommer ihåg mellan besök.
 */
const SESSION_KEY = 'kille_session';

function load() {
  if (typeof localStorage === 'undefined') return {};
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || '{}') || {};
  } catch {
    return {};
  }
}

export const Session = {
  _state: load(),

  save() {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SESSION_KEY, JSON.stringify(this._state));
    }
  },

  /** Har användaren gjort sitt initiala val (lokalt/grupp) ännu? */
  hasChosen() {
    return this._state.mode === 'local' || this._state.mode === 'group';
  },

  get mode() {
    return this._state.mode || 'local';
  },

  isGroup() {
    return this._state.mode === 'group' && !!this._state.group;
  },

  /** Aktuell grupp: { id, name, joinCode, role } eller null. */
  get group() {
    return this.isGroup() ? this._state.group : null;
  },

  get memberId() {
    return this._state.memberId || null;
  },

  get memberName() {
    return this._state.memberName || null;
  },

  /** True om admin-koden verifierats på den här enheten den här sessionen. */
  get adminUnlocked() {
    return !!this._state.adminUnlocked;
  },

  /** True om aktuell medlem är admin i gruppen. */
  isAdmin() {
    return this.isGroup() && this._state.group.role === 'admin';
  },

  /** Byt till lokalt läge. */
  setLocal() {
    this._state = { mode: 'local' };
    this.save();
  },

  /**
   * Gå in i grupp-läge från en snapshot (retur från join/create).
   * @param {object} snapshot - { group, role, members, ... }
   * @param {string} memberName - namnet man loggade in med
   * @param {boolean} adminUnlocked - om admin redan är upplåst (t.ex. vid skapande)
   */
  setGroup(snapshot, memberName, adminUnlocked = false) {
    const g = snapshot.group;
    const members = Array.isArray(snapshot.members) ? snapshot.members : [];
    const me = memberName
      ? members.find(m => m.name.toLowerCase() === memberName.toLowerCase())
      : null;
    this._state = {
      mode: 'group',
      group: { id: g.id, name: g.name, slug: g.slug || null, joinCode: g.joinCode, role: (me?.role) || snapshot.role || 'member' },
      memberId: me?.id || null,
      memberName: memberName || null,
      adminUnlocked: !!adminUnlocked
    };
    this.save();
  },

  /** Uppdatera fält på aktuell grupp (t.ex. efter namnbyte / ny join-kod). */
  updateGroup(partial) {
    if (!this.isGroup()) return;
    this._state.group = { ...this._state.group, ...partial };
    this.save();
  },

  setAdminUnlocked(value) {
    this._state.adminUnlocked = !!value;
    this.save();
  },

  /** Nollställ valet helt (visar startskärmen igen). */
  reset() {
    this._state = {};
    this.save();
  }
};
