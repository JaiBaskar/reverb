/**
 * Colour of each product in the 3D preview and its legend: one clearly different hue per type,
 * toned down toward fabric, avoiding green / amber / red (those mean good / so-so / bad).
 */
export const ITEM_COLORS: Record<string, string> = {
  panel_50: '#4170c0', // blue: 5 cm wall panel
  panel_100: '#7457b5', // violet: 10 cm wall panel
  panel_50_square: '#3497ab', // cyan: 5 cm square panel
  bass_trap: '#c66a3f', // orange: corner bass trap
  cloud_100: '#b5507f', // pink: ceiling cloud
  diffuser_qrd: '#8b5a2b', // wood brown: diffuser
}
