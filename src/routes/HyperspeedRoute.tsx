import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { Zap } from 'lucide-react';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { CyberPortalCard } from '../components/CyberPortalCard';
import { Hyperspeed, type HyperspeedOptions } from '../components/Hyperspeed';
import { PageTransition } from '../components/PageTransition';
import { cyberPortalGroups } from '../data/cyberPortals';
import './HyperspeedRoute.css';

const hyperspeedOptions: HyperspeedOptions = {
  length: 520,
  roadWidth: 10.4,
  lanesPerRoad: 4,
  fov: 84,
  speedUp: 3.2,
  colors: {
    roadColor: 0x04050b,
    background: 0x020309,
    shoulderLines: 0xff3bbd,
    brokenLines: 0x35f2ff,
    leftCars: [0xff3bbd, 0xff476f, 0x8a5cff],
    rightCars: [0x35f2ff, 0xeaff4f, 0x386dff],
    sticks: 0x35f2ff
  }
};

const revealTransition = { duration: 0.72, ease: [0.19, 1, 0.22, 1] as const };

export function HyperspeedRoute() {
  const prefersReducedMotion = Boolean(useReducedMotion());
  const [sequenceComplete, setSequenceComplete] = useState(prefersReducedMotion);
  const [tunnelMounted, setTunnelMounted] = useState(!prefersReducedMotion);
  const directoryVisible = prefersReducedMotion || sequenceComplete;

  const finishSequence = useCallback(() => setSequenceComplete(true), []);

  useEffect(() => {
    if (!prefersReducedMotion) return;
    setSequenceComplete(true);
    setTunnelMounted(false);
  }, [prefersReducedMotion]);

  useEffect(() => {
    if (!sequenceComplete || prefersReducedMotion) return;
    const timer = window.setTimeout(() => setTunnelMounted(false), 1050);
    return () => window.clearTimeout(timer);
  }, [prefersReducedMotion, sequenceComplete]);

  return (
    <PageTransition>
      <section className="cyber-corridor" data-phase={directoryVisible ? 'directory' : 'transit'}>
        <AnimatePresence>
          {tunnelMounted ? (
            <motion.div
              className="cyber-corridor__tunnel"
              initial={{ opacity: 0 }}
              animate={{ opacity: sequenceComplete ? 0 : 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: sequenceComplete ? 0.95 : 0.45, ease: 'easeOut' }}
            >
              <Hyperspeed
                effectOptions={hyperspeedOptions}
                autoAccelerate
                sequenceDurationMs={2800}
                peakSpeed={7.8}
                onSequenceComplete={finishSequence}
              />
              <div className="cyber-corridor__tunnel-overlay" />
            </motion.div>
          ) : null}
        </AnimatePresence>

        <div className="cyber-corridor__shell">
          <motion.header
            className="cyber-corridor__header"
            initial={{ opacity: 0, y: 28, filter: 'blur(12px)' }}
            animate={{
              opacity: 1,
              y: directoryVisible ? 0 : '17vh',
              filter: 'blur(0px)'
            }}
            transition={revealTransition}
          >
            <p className="cyber-corridor__eyebrow">
              <Zap size={14} strokeWidth={1.7} />
              HYPERSPEED / EXTERNAL SIGNAL NETWORK
            </p>
            <h1>极速通道</h1>
            <motion.p
              className="cyber-corridor__subtitle"
              animate={{ opacity: directoryVisible ? 1 : 0.64 }}
              transition={{ duration: 0.5 }}
            >
              {directoryVisible
                ? '九个外部信号节点已经接入。按任务分类选择入口，在新标签页打开对应情报终端。'
                : '正在提升链路速度，穿越边界后将接入外部实时信号网络。'}
            </motion.p>
          </motion.header>

          <AnimatePresence>
            {!directoryVisible ? (
              <motion.div
                className="cyber-corridor__transit-status"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0, y: 10 }}
                transition={{ duration: 0.35 }}
              >
                <div>
                  <strong>WARP SEQUENCE ACTIVE</strong>
                  ACCELERATING EXTERNAL SIGNAL LINK
                </div>
                <div className="cyber-corridor__meter" aria-hidden="true" />
              </motion.div>
            ) : null}
          </AnimatePresence>

          {directoryVisible ? (
            <motion.div
              className="cyber-corridor__directory"
              initial={{ opacity: 0, y: 44, filter: 'blur(14px)' }}
              animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
              transition={{ ...revealTransition, delay: prefersReducedMotion ? 0 : 0.25 }}
            >
              <div className="cyber-corridor__directory-heading">
                <div>
                  <p>ACCESS DIRECTORY / 09 NODES</p>
                  <h2>选择你的情报入口</h2>
                </div>
                <span>SECURE EXTERNAL HANDOFF · NEW TAB</span>
              </div>

              {cyberPortalGroups.map((group, groupIndex) => (
                <motion.section
                  className="cyber-corridor__group"
                  key={group.id}
                  style={{ '--group-accent': group.accent } as CSSProperties}
                  initial={prefersReducedMotion ? false : { opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...revealTransition, delay: prefersReducedMotion ? 0 : 0.38 + groupIndex * 0.13 }}
                  aria-labelledby={`${group.id}-title`}
                >
                  <div className="cyber-corridor__group-heading">
                    <span className="cyber-corridor__group-index">{group.index}</span>
                    <span className="cyber-corridor__group-title">
                      <strong id={`${group.id}-title`}>{group.title}</strong>
                      <span>{group.englishTitle}</span>
                    </span>
                    <span className="cyber-corridor__group-description">{group.description}</span>
                  </div>

                  <div className="cyber-corridor__grid">
                    {group.portals.map((portal, portalIndex) => (
                      <motion.div
                        key={portal.id}
                        initial={prefersReducedMotion ? false : { opacity: 0, y: 28, scale: 0.975 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{
                          ...revealTransition,
                          delay: prefersReducedMotion ? 0 : 0.48 + groupIndex * 0.13 + portalIndex * 0.07
                        }}
                      >
                        <CyberPortalCard
                          portal={portal}
                          accent={group.accent}
                          accentRgb={group.accentRgb}
                          order={groupIndex * 3 + portalIndex}
                          reducedMotion={prefersReducedMotion}
                        />
                      </motion.div>
                    ))}
                  </div>
                </motion.section>
              ))}
            </motion.div>
          ) : null}
        </div>
      </section>
    </PageTransition>
  );
}
