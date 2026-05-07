const ADJECTIVES = [
  'ACID', 'AGED', 'AQUA', 'ARCH', 'ARID', 'ARTY', 'ASHY', 'AVID', 'AWED', 'AWRY',
  'BARE', 'BOLD', 'BUFF', 'CALM', 'COLD', 'COOL', 'COZY', 'CYAN', 'DAMP', 'DARK',
  'DEAR', 'DEEP', 'DRAB', 'DULL', 'DUSK', 'EDGY', 'EPIC', 'EVEN', 'FAIR', 'FAST',
  'FINE', 'FIRM', 'FLAT', 'FOLK', 'FOND', 'FREE', 'FULL', 'FUME', 'GILT', 'GLAD',
  'GLUM', 'GOLD', 'GONE', 'GOOD', 'GRAY', 'GRIM', 'HAZY', 'HIGH', 'HOLY', 'HUGE',
  'IRON', 'ICED', 'INKY', 'JADE', 'JUST', 'KEEN', 'KIND', 'LAME', 'LANK', 'LAZY',
  'LEAN', 'LIMP', 'LOUD', 'LUSH', 'MILD', 'MINT', 'MIST', 'MOODY', 'MUTE', 'NEAT',
  'NEON', 'NICE', 'NOIR', 'NUDE', 'OILY', 'OKAY', 'OPEN', 'OVAL', 'PALE', 'PINE',
  'PINK', 'PURE', 'RARE', 'REAL', 'RICH', 'ROSY', 'RUBY', 'RUDE', 'RUST', 'SAGE',
  'SALT', 'SLIM', 'SLOW', 'SOFT', 'SOLE', 'TEAL', 'THIN', 'VAST', 'WILD', 'ZANY',
]

export function generateRoomCode(): string {
  const word = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)]
  const digits = String(Math.floor(Math.random() * 90) + 10)
  return `${word}-${digits}`
}

export function isValidRoomCode(code: string): boolean {
  return /^[A-Z]{4}-\d{2}$/.test(code)
}
