// Minimal ambient declaration for canvas-confetti.
// Replace with @types/canvas-confetti once the package is installed.
declare module 'canvas-confetti' {
  interface Options {
    particleCount?: number
    spread?: number
    origin?: { x?: number; y?: number }
    colors?: string[]
    angle?: number
    startVelocity?: number
    decay?: number
    gravity?: number
    scalar?: number
    ticks?: number
    shapes?: string[]
    zIndex?: number
    disableForReducedMotion?: boolean
  }
  function confetti(options?: Options): Promise<null> | null
  export default confetti
}
