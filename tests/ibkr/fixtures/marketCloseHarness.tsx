import React from 'react';
import { createRoot } from 'react-dom/client';
import { MarketCloseReading } from '../../../src/components/MarketCloseReading';
import '../../../src/routes/DailyBrief.css';
createRoot(document.getElementById('root')!).render(<div className="daily-brief-editorial" style={{ padding: 20 }}><MarketCloseReading><p>Day1 原有深度解读内容</p></MarketCloseReading></div>);
