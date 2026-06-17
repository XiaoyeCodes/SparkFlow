import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#f7f7f2',
        night: '#0b0b0c',
        graphite: '#151518',
        frost: 'rgba(255,255,255,0.72)',
        voltage: '#8ad7ff',
        pulse: '#b9ffdc'
      },
      fontFamily: {
        display: ['Inter', 'SF Pro Display', 'Segoe UI', 'Arial', 'sans-serif'],
        serif: ['Georgia', 'Times New Roman', 'serif']
      },
      boxShadow: {
        glow: '0 0 42px rgba(138, 215, 255, 0.18)'
      }
    }
  },
  plugins: []
} satisfies Config;
