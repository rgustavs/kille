/**
 * Kille Card Definitions
 * All cards in the classic Swedish card game Kille with their point values.
 */

export const CARDS = [
  // === Picture Cards (Bildkort) ===
  { id: 'harlekin', name: 'Harlekin', type: 'picture', points: 100, image: 'assets/cards/harlekin.png' },
  { id: 'kuku', name: 'Kuku', type: 'picture', points: 90, image: 'assets/cards/kuku.png' },
  { id: 'husar', name: 'Husar', type: 'picture', points: 80, image: 'assets/cards/husar.png' },
  { id: 'kavall', name: 'Kavall', type: 'picture', points: 70, image: 'assets/cards/kavall.png' },
  { id: 'husu', name: 'Husu', type: 'picture', points: 75, image: 'assets/cards/husu.png' },
  { id: 'vardshus', name: 'Värdshus', type: 'picture', points: 65, image: 'assets/cards/vardshus.png' },

  // === Number Cards (Sifferkort / Liljor) — points = number × 5 ===
  { id: 'num_12', name: '12', type: 'number', points: 60, number: 12 },
  { id: 'num_11', name: '11', type: 'number', points: 55, number: 11 },
  { id: 'num_10', name: '10', type: 'number', points: 50, number: 10 },
  { id: 'num_9', name: '9', type: 'number', points: 45, number: 9 },
  { id: 'num_8', name: '8', type: 'number', points: 40, number: 8 },
  { id: 'num_7', name: '7', type: 'number', points: 35, number: 7 },
  { id: 'num_6', name: '6', type: 'number', points: 30, number: 6 },
  { id: 'num_5', name: '5', type: 'number', points: 25, number: 5 },
  { id: 'num_4', name: '4', type: 'number', points: 20, number: 4 },
  { id: 'num_3', name: '3', type: 'number', points: 15, number: 3 },
  { id: 'num_2', name: '2', type: 'number', points: 10, number: 2 },
  { id: 'num_1', name: '1', type: 'number', points: 5, number: 1 },

  // === Zero Cards (Nollkort) ===
  { id: 'kransen', name: 'Kransen', type: 'zero', points: 0, image: 'assets/cards/kransen.png' },
  { id: 'blompotten', name: 'Blompotten', type: 'zero', points: 0, image: 'assets/cards/blompotten.png' },
  { id: 'blaren', name: 'Blaren', type: 'zero', points: 0, image: 'assets/cards/blaren.png' },
];

/** Get a card definition by its ID */
export function getCardById(id) {
  return CARDS.find(c => c.id === id) || null;
}

/** Get cards filtered by type */
export function getCardsByType(type) {
  return CARDS.filter(c => c.type === type);
}

/** Generate a fleur-de-lis pattern string for a number card */
export function getLiljaPattern(number) {
  return '⚜'.repeat(number);
}
