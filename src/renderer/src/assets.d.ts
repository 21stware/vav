/** Vite resolves image imports to a URL string. Kept module-free so the
    wildcard declaration stays ambient rather than becoming an augmentation. */
declare module '*.png' {
  const src: string
  export default src
}
