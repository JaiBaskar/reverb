/**
 * Colour of each product in the 3D preview and its legend: one clearly different hue per type,
 * avoiding green / amber / red (those mean good / so-so / bad).
 */
export const ITEM_COLORS: Record<string, string> = {
  panel_50: '#2563eb', // blue: 5 cm wall panel
  panel_100: '#7c3aed', // violet: 10 cm wall panel
  panel_50_square: '#06b6d4', // cyan: 5 cm square panel
  bass_trap: '#ea580c', // orange: corner bass trap
  cloud_100: '#db2777', // pink: ceiling cloud
  diffuser_qrd: '#8b5a2b', // wood brown: diffuser
}
