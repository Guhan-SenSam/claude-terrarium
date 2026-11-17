import type { Era } from '../types'

/**
 * How a message box looks in each era: a frame the colour of the age over a dim, see-through
 * fill, so the valley still shows around and behind the words.
 */
export type Frame = { border: string; style: string; fill: string; mine: string }

export const FRAMES: Record<Era, Frame> = {
  // flint and firelight
  stone: { border: '#8a6a48', style: 'bold', fill: 'rgba(34, 26, 18, 0.62)', mine: 'rgba(58, 40, 24, 0.66)' },
  // parchment and timber
  village: { border: '#c9a86a', style: 'single', fill: 'rgba(48, 38, 24, 0.6)', mine: 'rgba(78, 60, 34, 0.64)' },
  // riveted brass on soot
  industrial: { border: '#b8863b', style: 'double', fill: 'rgba(32, 28, 26, 0.64)', mine: 'rgba(56, 42, 28, 0.66)' },
  // glass and steel
  modern: { border: '#9fb4c8', style: 'round', fill: 'rgba(22, 28, 36, 0.56)', mine: 'rgba(36, 50, 66, 0.6)' },
  // neon on the night
  scifi: { border: '#3ef0ff', style: 'round', fill: 'rgba(10, 12, 30, 0.6)', mine: 'rgba(30, 16, 56, 0.64)' },
}
