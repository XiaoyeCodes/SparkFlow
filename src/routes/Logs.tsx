import { ModuleFrame } from '../components/ModuleFrame';
import { logEntries } from '../data/content';

export function Logs() {
  return (
    <ModuleFrame title="个人随笔" kicker="Logs">
      <article className="mx-auto max-w-3xl">
        {logEntries.map((entry) => (
          <p key={entry} className="mb-10 font-serif text-[clamp(1.75rem,4vw,3.7rem)] leading-[1.22] text-white/82">
            {entry}
          </p>
        ))}
      </article>
    </ModuleFrame>
  );
}
