# Cyber Portal Corridor

## Goal

Turn the existing Hyperspeed route into a short, deliberate cyberpunk transition that resolves into a useful, categorized directory of external intelligence tools.

## Experience

1. On route entry, the Three.js road starts at cruise speed and accelerates along an eased curve.
2. At peak speed the tunnel blooms and fades; its WebGL canvas is then unmounted to release GPU resources.
3. The portal directory appears in three staggered rows: global awareness, markets and research, and live intelligence.
4. Each portal is a semantic external link with pointer-tracked tilt, glow, grid distortion, and a restrained scan-line treatment inspired by the supplied ProfileCard reference.
5. Reduced-motion users skip the tunnel and receive the directory immediately without 3D pointer motion.

## Visual system

- Canvas: ink black and deep navy.
- Primary energy: electric cyan.
- Secondary energy: hot magenta and ultraviolet.
- Alert accent: signal red.
- Research accent: acid yellow.
- Typography: existing product sans for Chinese copy, monospaced technical labels for metadata.
- Card variations come from category color, pattern, index marker, and per-card accent placement rather than random runtime layout, so the page remains stable and polished.

## Content architecture

- **全球态势**: 全球态势监控, CRUCIX 情报终端, 全球卫星气象.
- **市场研究**: 纳指 100 热力图, Day1 全球晨报, 长期趋势图谱.
- **实时情报**: 全球航班雷达, 全网热榜雷达, AI 热点情报.

The duplicate LongtermTrends URL is intentionally represented once.

## Interaction and accessibility

- Cards are native anchors and open in a new tab with `noopener noreferrer`.
- The full card is clickable and has a visible keyboard focus state.
- Pointer effects are cosmetic and never required for navigation.
- Motion is disabled through `prefers-reduced-motion`.
- Responsive layout is three columns on wide screens, two on medium screens, and one on mobile.

## Verification

- TypeScript and production build.
- Static checks for nine unique links, category grouping, external-link safety, and reduced-motion behavior.
- Browser smoke test and screenshots at desktop and mobile widths.
