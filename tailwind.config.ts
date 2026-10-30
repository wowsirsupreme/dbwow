import type { Config } from 'tailwindcss';
const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './src/**/*.{ts,tsx}', './portable/**/*.html'],
  theme: { extend: {} },
  plugins: [],
};
export default config;
